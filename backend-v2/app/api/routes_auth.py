import secrets
import time
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse

from app.core.auth import create_token, current_user
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

CALLBACK_PATH = "/auth/github/callback"


def _make_state() -> str:
    # signed + short-lived, so we don't need a session store to stop forged callbacks (CSRF)
    return jwt.encode(
        {"n": secrets.token_urlsafe(8), "exp": int(time.time()) + 600},
        settings.jwt_secret,
        algorithm="HS256",
    )


def _check_state(state: str) -> bool:
    try:
        jwt.decode(state, settings.jwt_secret, algorithms=["HS256"])
        return True
    except jwt.InvalidTokenError:
        return False


def _to_frontend(**params) -> RedirectResponse:
    # the token goes in the #hash, which browsers never send to any server or log
    return RedirectResponse(f"{settings.frontend_url.rstrip('/')}/#{urlencode(params)}")


@router.get("/github/login")
def github_login():
    """
    Step 1: send the user to GitHub's "Authorize this app" page.
    """
    if not settings.github_client_id:
        raise HTTPException(
            status_code=500,
            detail="GitHub login isn't configured (GITHUB_CLIENT_ID missing).",
        )
    query = urlencode(
        {
            "client_id": settings.github_client_id,
            "redirect_uri": settings.backend_url.rstrip("/") + CALLBACK_PATH,
            "scope": "read:user",
            "state": _make_state(),
        }
    )
    return RedirectResponse(f"https://github.com/login/oauth/authorize?{query}")


@router.get("/github/callback")
def github_callback(
    code: str | None = None, state: str | None = None, error: str | None = None
):
    """
    Step 2: GitHub sends the user back here with a one-time ?code=.
    We swap the code for a GitHub access token, read the user's profile,
    then hand the browser OUR token and forget GitHub's.
    """
    if error or not code:
        return _to_frontend(auth_error="GitHub login was cancelled.")
    if not state or not _check_state(state):
        return _to_frontend(auth_error="Login expired — please try again.")

    try:
        with httpx.Client(timeout=10) as client:
            res = client.post(
                "https://github.com/login/oauth/access_token",
                data={
                    "client_id": settings.github_client_id,
                    "client_secret": settings.github_client_secret,
                    "code": code,
                    "redirect_uri": settings.backend_url.rstrip("/") + CALLBACK_PATH,
                },
                headers={"Accept": "application/json"},
            )
            gh_token = res.json().get("access_token")
            if not gh_token:
                raise ValueError(res.json().get("error_description", "no access token"))

            user = client.get(
                "https://api.github.com/user",
                headers={
                    "Authorization": f"Bearer {gh_token}",
                    "Accept": "application/vnd.github+json",
                },
            ).json()
    except Exception as e:
        logger.exception("GitHub login failed")
        return _to_frontend(auth_error=f"GitHub login failed: {e}")

    logger.info(f"User signed in: {user.get('login')}")
    return _to_frontend(token=create_token(user))


@router.get("/me")
def me(user: dict = Depends(current_user)):
    """
    Who is logged in (the frontend calls this on page load to check the saved token).
    """
    return {"login": user["sub"], "name": user["name"], "avatar_url": user["avatar"]}
