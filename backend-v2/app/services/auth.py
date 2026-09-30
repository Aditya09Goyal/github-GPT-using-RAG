from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.dialects.postgresql import insert

from app.core.config import settings
from app.core.db import engine, users
from app.core.logging import get_logger

logger = get_logger(__name__)

GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"
JWT_ALGORITHM = "HS256"


@dataclass
class CurrentUser:
    id: int
    login: str


# --------------------------------------------------------------------------- GitHub OAuth


def exchange_code_for_token(code: str, redirect_uri: str) -> str:
    """Step 2 of GitHub OAuth: trade the one-time ?code= for an access token."""
    res = httpx.post(
        GITHUB_TOKEN_URL,
        data={
            "client_id": settings.github_client_id,
            "client_secret": settings.github_client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
        },
        headers={"Accept": "application/json"},
        timeout=15,
    )
    res.raise_for_status()
    data = res.json()
    if "access_token" not in data:
        # GitHub answers 200 with {"error": "bad_verification_code", ...} on failure
        raise ValueError(data.get("error_description") or data.get("error") or "GitHub did not return a token")
    return data["access_token"]


def fetch_github_user(access_token: str) -> dict:
    res = httpx.get(
        GITHUB_USER_URL,
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"},
        timeout=15,
    )
    res.raise_for_status()
    return res.json()


def upsert_user(gh: dict) -> int:
    """Creates the user on first sign-in, refreshes their profile on later ones. Returns our user id."""
    values = {
        "github_id": gh["id"],
        "login": gh["login"],
        "name": gh.get("name"),
        "avatar_url": gh.get("avatar_url"),
    }
    stmt = (
        insert(users)
        .values(**values)
        .on_conflict_do_update(
            index_elements=[users.c.github_id],
            set_={k: v for k, v in values.items() if k != "github_id"},
        )
        .returning(users.c.id)
    )
    with engine.begin() as conn:
        return conn.execute(stmt).scalar_one()


# --------------------------------------------------------------------------- our own tokens


def create_access_token(user_id: int, gh: dict) -> str:
    """
    Signed token the frontend sends as `Authorization: Bearer ...`.
    It carries the public profile so the frontend can show it without an extra request.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "login": gh["login"],
        "name": gh.get("name"),
        "avatar_url": gh.get("avatar_url"),
        "iat": now,
        "exp": now + timedelta(days=settings.jwt_expire_days),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)


_bearer = HTTPBearer(auto_error=False)


def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> CurrentUser:
    """FastAPI dependency: rejects the request with 401 unless it has a valid, unexpired token."""
    if creds is None:
        raise HTTPException(status_code=401, detail="Please sign in.", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(creds.credentials, settings.jwt_secret, algorithms=[JWT_ALGORITHM])
        return CurrentUser(id=int(payload["sub"]), login=payload["login"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(
            status_code=401,
            detail="Your session has expired. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
