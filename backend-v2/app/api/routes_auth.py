import secrets
from urllib.parse import quote, urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select

from app.core.config import settings
from app.core.db import engine, users
from app.core.logging import get_logger
from app.schemas.auth import UserResponse
from app.services.auth import (
    GITHUB_AUTHORIZE_URL,
    CurrentUser,
    create_access_token,
    exchange_code_for_token,
    fetch_github_user,
    get_current_user,
    upsert_user,
)
from app.services.repo_registry import claim_legacy_collections

logger = get_logger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

STATE_COOKIE = "ghgpt_oauth"


def _safe_frontend(url: str | None) -> str:
    """Only ever redirect back to a frontend we trust (one of CORS_ORIGINS)."""
    allowed = settings.cors_origin_list
    url = (url or "").rstrip("/")
    return url if url in allowed else allowed[0]


@router.get("/github/login")
def github_login(request: Request, redirect_to: str | None = None):
    """
    Step 1: send the browser to GitHub's consent page.
    `redirect_to` is the frontend origin to come back to afterwards (must be in CORS_ORIGINS).
    """
    state = secrets.token_urlsafe(24)
    params = {
        "client_id": settings.github_client_id,
        "redirect_uri": str(request.url_for("github_callback")),
        "state": state,
        "allow_signup": "true",
    }
    res = RedirectResponse(f"{GITHUB_AUTHORIZE_URL}?{urlencode(params)}")
    # The random state is remembered in a short-lived cookie and checked in the callback,
    # so nobody can finish a sign-in that this browser didn't start (CSRF protection).
    res.set_cookie(
        STATE_COOKIE,
        f"{state}|{_safe_frontend(redirect_to)}",
        max_age=600,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
        path="/auth",
    )
    return res


@router.get("/github/callback", name="github_callback")
def github_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    """
    Step 2: GitHub sends the browser back here with a one-time code.
    We turn it into a GitHub profile, create/update the user, and redirect to the
    frontend with our own token in the URL fragment (#token=...) — fragments are
    never sent to servers, so the token doesn't end up in any access log.
    """
    saved_state, _, frontend = (request.cookies.get(STATE_COOKIE) or "").partition("|")
    frontend = _safe_frontend(frontend)

    def back(fragment: dict) -> RedirectResponse:
        res = RedirectResponse(f"{frontend}/#{urlencode(fragment, quote_via=quote)}")
        res.delete_cookie(STATE_COOKIE, path="/auth")
        return res

    if error:
        return back({"auth_error": "GitHub sign-in was cancelled."})
    if not code or not state or not saved_state or not secrets.compare_digest(state, saved_state):
        return back({"auth_error": "Sign-in expired or was started in another browser. Please try again."})

    try:
        gh_token = exchange_code_for_token(code, str(request.url_for("github_callback")))
        gh = fetch_github_user(gh_token)
        user_id = upsert_user(gh)
    except Exception:
        logger.exception("GitHub sign-in failed")
        return back({"auth_error": "Could not sign in with GitHub. Please try again."})

    if settings.admin_github_login and gh["login"].lower() == settings.admin_github_login.lower():
        claim_legacy_collections(user_id)

    logger.info(f"User {gh['login']} (id {user_id}) signed in")
    return back({"token": create_access_token(user_id, gh)})


@router.get("/me", response_model=UserResponse)
def me(user: CurrentUser = Depends(get_current_user)):
    """The signed-in user's profile."""
    with engine.connect() as conn:
        row = conn.execute(select(users.c.login, users.c.name, users.c.avatar_url).where(users.c.id == user.id)).first()
    if row is None:
        raise HTTPException(status_code=401, detail="Your account no longer exists. Please sign in again.")
    return UserResponse(login=row.login, name=row.name, avatar_url=row.avatar_url)
