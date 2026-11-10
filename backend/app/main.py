"""Crowded API entrypoint."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1 import activity, admin, auth, bars, me, specials, staff
from app.config import get_settings
from app.core.middleware import BodySizeLimit, SecurityHeaders

log = logging.getLogger("crowded")

API_DESCRIPTION = """
Live line wait times and crowd levels for downtown bars, plus a verdict on whether a
line-skip pass is worth it. Every number ships with its basis. All endpoints except auth
and health require a bearer access token (15 minute lifetime).
"""


def _web_dir() -> Path | None:
    s = get_settings()
    path = Path(s.web_dir) if s.web_dir else Path(__file__).resolve().parents[2] / "web"
    return path if (path / "index.html").is_file() else None


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="Crowded API",
        version="1.0.0",
        description=API_DESCRIPTION,
        docs_url="/docs" if s.is_dev else None,
        redoc_url=None,
        openapi_url="/openapi.json" if s.is_dev else None,
    )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Do not echo submitted input back (it can contain phone numbers).
        errors = [
            {"loc": list(e.get("loc", ())), "msg": e.get("msg", ""), "type": e.get("type", "")}
            for e in exc.errors()
        ]
        return JSONResponse({"detail": "validation_error", "errors": errors}, status_code=422)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error: %s", type(exc).__name__)
        return JSONResponse({"detail": "internal_error"}, status_code=500)

    @app.get("/healthz", tags=["health"])
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    for r in (
        auth.router,
        me.router,
        bars.router,
        activity.router,
        staff.router,
        admin.router,
        specials.staff_router,
        specials.admin_router,
    ):
        app.include_router(r, prefix="/v1")

    if s.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=s.cors_origins,
            allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
            allow_headers=["Authorization", "Content-Type"],
            allow_credentials=False,
            max_age=600,
        )
    app.add_middleware(SecurityHeaders, hsts=not s.is_dev)
    app.add_middleware(BodySizeLimit, max_bytes=s.max_request_bytes)

    web = _web_dir()
    if s.serve_web and web is not None:
        app.mount("/", StaticFiles(directory=web, html=True), name="web")
    return app


app = create_app()
