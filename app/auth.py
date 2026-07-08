import base64
import hashlib
import hmac
import time

from fastapi import Header, HTTPException, status

from .config import settings

TOKEN_TTL_SECONDS = 12 * 60 * 60


def verify_api_key(x_api_key: str = Header(...)) -> None:
    if not hmac.compare_digest(x_api_key, settings.api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")


def _signing_key() -> bytes:
    # Derived, not stored: rotating either secret invalidates all dashboard sessions.
    return hashlib.sha256(f"{settings.api_key}:{settings.dashboard_password}".encode()).digest()


def create_dashboard_token() -> tuple[str, int]:
    expires = int(time.time()) + TOKEN_TTL_SECONDS
    payload = str(expires).encode()
    sig = hmac.new(_signing_key(), payload, hashlib.sha256).hexdigest()
    token = base64.urlsafe_b64encode(payload + b"." + sig.encode()).decode()
    return token, expires


def verify_dashboard_token(authorization: str = Header(default="")) -> None:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized()
    try:
        payload, _, sig = base64.urlsafe_b64decode(token.encode()).decode().partition(".")
        expires = int(payload)
    except (ValueError, UnicodeDecodeError):
        raise _unauthorized()
    expected = hmac.new(_signing_key(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected) or time.time() > expires:
        raise _unauthorized()


def _unauthorized() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")
