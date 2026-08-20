from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Awaitable, Callable

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response

from backend.app.api.dependencies import get_file_ingestion_service
from backend.app.api.routes.admin.sync import router as admin_sync_router
from backend.app.api.routes.file_embeddings import router as file_embeddings_router
from backend.app.api.routes.health import (
    HealthDependencies,
    get_health_dependencies,
)
from backend.app.api.routes.health import (
    router as health_router,
)
from backend.app.api.routes.vector_search import (
    router as vector_search_router,
)
from backend.app.config import Settings
from backend.app.drive.client import DriveClient, build_drive_client
from backend.app.drive.scheduler import SyncScheduler, build_sync_scheduler
from backend.app.file_embeddings.ingestion_service import FileIngestionService
from backend.app.integrations.model_client import OpenAICompatibleModelClient
from backend.app.integrations.qdrant_store import QdrantEmbeddingStore
from backend.app.model.description_client import InstructorImageDescriptionClient
from backend.app.security import (
    InMemoryRateLimiter,
    reject_oversized_request,
)


@dataclass(frozen=True)
class _UnavailableHealthDependency:
    def check_health(self) -> str:
        return "unavailable"


def create_app(
    service: FileIngestionService | None = None,
    health_dependencies: HealthDependencies | None = None,
    upload_api_key: str | None = None,
    admin_api_key: str | None = None,
    drive_client: DriveClient | None = None,
    sync_scheduler: SyncScheduler | None = None,
) -> FastAPI:
    """Create and configure the FastAPI application."""

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        effective_service = service
        effective_health_dependencies = health_dependencies
        effective_upload_api_key = upload_api_key
        effective_admin_api_key = admin_api_key
        effective_drive_client = drive_client
        effective_sync_scheduler = sync_scheduler

        if effective_service is None:
            settings = Settings()
            if effective_upload_api_key is None:
                effective_upload_api_key = settings.UPLOAD_API_KEY or None
            if effective_admin_api_key is None:
                effective_admin_api_key = settings.ADMIN_API_KEY or None
            if effective_drive_client is None:
                effective_drive_client = build_drive_client(settings)

            description_client = InstructorImageDescriptionClient(
                endpoint_url=settings.DESCRIPTION_ENDPOINT_URL or "",
                endpoint_api_key=settings.DESCRIPTION_ENDPOINT_API_KEY,
                description_model=settings.DESCRIPTION_MODEL,
                timeout=settings.MODEL_REQUEST_TIMEOUT,
            )
            model_client = OpenAICompatibleModelClient(settings)
            qdrant_store = QdrantEmbeddingStore(settings)
            effective_service = FileIngestionService(
                description_client=description_client,
                model_client=model_client,
                qdrant_store=qdrant_store,
                settings=settings,
            )
            if effective_health_dependencies is None:
                effective_health_dependencies = HealthDependencies(
                    description_client=description_client,
                    model_client=model_client,
                    qdrant_store=qdrant_store,
                    drive=effective_drive_client,
                )
            if effective_sync_scheduler is None:
                effective_sync_scheduler = build_sync_scheduler(
                    settings=settings,
                    drive_client=effective_drive_client,
                    ingestion_service=effective_service,
                    qdrant_store=qdrant_store,
                )
        elif effective_health_dependencies is None:
            unavailable = _UnavailableHealthDependency()
            effective_health_dependencies = HealthDependencies(
                description_client=unavailable,
                model_client=unavailable,
                qdrant_store=unavailable,
            )

        assert effective_service is not None
        assert effective_health_dependencies is not None
        effective_service.startup()
        application.state.file_ingestion_service = effective_service
        application.state.health_dependencies = effective_health_dependencies
        application.state.upload_api_key = effective_upload_api_key
        application.state.admin_api_key = effective_admin_api_key
        application.state.upload_rate_limiter = InMemoryRateLimiter()
        application.state.drive_client = effective_drive_client
        application.state.sync_scheduler = effective_sync_scheduler
        if effective_sync_scheduler is not None:
            await effective_sync_scheduler.start()
        try:
            yield
        finally:
            if effective_sync_scheduler is not None:
                await effective_sync_scheduler.stop()
            for key in (
                "file_ingestion_service",
                "health_dependencies",
                "upload_api_key",
                "admin_api_key",
                "upload_rate_limiter",
                "drive_client",
                "sync_scheduler",
            ):
                application.state._state.pop(key, None)

    app = FastAPI(
        title="OpenAI File Embeddings",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.include_router(file_embeddings_router)
    app.include_router(vector_search_router)
    app.include_router(health_router)
    app.include_router(admin_sync_router)
    app.mount(
        "/admin/static",
        StaticFiles(directory="backend/app/static"),
        name="admin-static",
    )

    @app.get("/admin", include_in_schema=False)
    async def admin_index() -> FileResponse:
        return FileResponse("backend/app/static/admin.html")

    @app.middleware("http")
    async def protect_uploads(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        protected_paths = {"/v1/file-embeddings", "/v1/search"}
        if request.url.path in protected_paths and request.method == "POST":
            try:
                reject_oversized_request(request)
            except HTTPException as exc:
                return JSONResponse(
                    status_code=exc.status_code,
                    content={"detail": exc.detail},
                    headers=exc.headers,
                )
        return await call_next(request)

    def provide_file_ingestion_service(request: Request) -> FileIngestionService:
        return request.app.state.file_ingestion_service

    def provide_health_dependencies(request: Request) -> HealthDependencies:
        return request.app.state.health_dependencies

    app.dependency_overrides[get_file_ingestion_service] = (
        provide_file_ingestion_service
    )
    app.dependency_overrides[get_health_dependencies] = provide_health_dependencies
    return app
