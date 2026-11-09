from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.core.apple import get_apple_verifier
from app.core.deps import DB, ip_key
from app.core.ratelimit import hit
from app.schemas import (
    AppleSignInIn,
    RefreshIn,
    RequestCodeIn,
    RequestCodeOut,
    TokenPair,
    VerifyCodeIn,
)
from app.services import auth as svc

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/request-code", response_model=RequestCodeOut)
def request_code(body: RequestCodeIn, request: Request, db: DB) -> RequestCodeOut:
    hit("code_request_ip", ip_key(request))
    hit("code_request_phone", svc.phone_hash(body.phone))
    return svc.request_code(db, body.phone)


@router.post(
    "/verify-code",
    response_model=TokenPair,
    responses={400: {"description": "invalid_code"}, 403: {"description": "age_gate"}},
)
def verify_code(body: VerifyCodeIn, request: Request, db: DB) -> TokenPair:
    hit("code_verify_ip", ip_key(request))
    return svc.verify_code(db, body.phone, body.code, body.age_attested, body.platform)


@router.post("/apple", response_model=TokenPair, responses={403: {"description": "age_gate"}})
def apple(body: AppleSignInIn, request: Request, db: DB) -> TokenPair:
    hit("apple_ip", ip_key(request))
    try:
        sub = get_apple_verifier().verify(body.identity_token)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid_apple_token") from None
    return svc.apple_sign_in(db, sub, body.age_attested, body.platform)


@router.post("/refresh", response_model=TokenPair)
def refresh(body: RefreshIn, request: Request, db: DB) -> TokenPair:
    hit("refresh_ip", ip_key(request))
    return svc.refresh(db, body.refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(body: RefreshIn, db: DB) -> Response:
    svc.logout(db, body.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
