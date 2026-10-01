import time

import jwt
from fastapi import Header, HTTPException

from app.core.config import settings


def create_token(user: dict) -> str:
    """
    Our own login token (JWT) — signed with jwt_secret, so nobody can fake one.
    Holds only public GitHub profile info; the GitHub access token is never stored.
    """
    now = int(time.time())
    payload = {
        "sub": user["login"],
        "name": user.get("name") or user["login"],
        "avatar": user.get("avatar_url", ""),
        "iat": now,
        "exp": now + settings.jwt_expire_days * 86400,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401, detail="Your login expired — sign in again."
        )
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid login — sign in again.")


def current_user(authorization: str | None = Header(default=None)) -> dict:
    """
    FastAPI dependency: add `user: dict = Depends(current_user)` to any route to require login.
    Expects the header  Authorization: Bearer <token>
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sign in with GitHub to do this.")
    return decode_token(authorization.removeprefix("Bearer ").strip())
