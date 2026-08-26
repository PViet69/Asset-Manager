from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Awaitable, Callable

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.responses import Response

from backend.app.admin_auth import AdminAuthConfig
from backend.app.admin_dashboard.status_service import AdminDashboardStatusService
from backend.app.api.dependencies import get_file_ingestion_service
from backend.app.api.routes.admin.sync import router as admin_sync_router
from backend.app.api.routes.auth import router as auth_router
from backend.app.api.routes.file_embeddings import router as file_embeddings_router
from backend.app.api.routes.health import (
    HealthDependencies,
    get_health_dependencies,
)
from backend.app.api.routes.health import (
    router as health_router,
)
from backend.app.api.routes.thumbnails import router as thumbnails_router
from backend.app.api.routes.vector_search import (
    router as vector_search_router,
)
from backend.app.config import AdminAuthSettings, Settings
from backend.app.file_embeddings.ingestion_service import FileIngestionService
from backend.app.integrations.model_client import OpenAICompatibleModelClient
from backend.app.integrations.qdrant_store import QdrantEmbeddingStore
from backend.app.model.description_client import InstructorImageDescriptionClient
from backend.app.security import (
    AdminLoginRateLimiter,
    InMemoryRateLimiter,
    reject_oversized_request,
)
from backend.app.storage.registry import ProviderRegistry, build_provider_registry


@dataclass(frozen=True)
class _UnavailableHealthDependency:
    @property
    def model_name(self) -> str:
        return "Unavailable"

    def check_health(self) -> str:
        return "unavailable"


def create_app(
    service: FileIngestionService | None = None,
    health_dependencies: HealthDependencies | None = None,
    admin_auth_config: AdminAuthConfig | None = None,
    provider_registry: ProviderRegistry | None = None,
) -> FastAPI:
    """Create and configure the FastAPI application."""

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        effective_service = service
        effective_health_dependencies = health_dependencies
        effective_admin_auth_config = admin_auth_config
        effective_provider_registry = provider_registry

        settings = Settings() if effective_service is None else None
        if effective_admin_auth_config is None:
            auth_settings = AdminAuthSettings()
            effective_admin_auth_config = AdminAuthConfig(
                username=auth_settings.ADMIN_USERNAME,
                password_hash=auth_settings.ADMIN_PASSWORD_HASH,
                session_secret=auth_settings.ADMIN_SESSION_SECRET,
                allowed_origin=str(auth_settings.ADMIN_ALLOWED_ORIGIN).rstrip("/"),
            )

        if effective_service is None:
            assert settings is not None
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
                )
            if effective_provider_registry is None:
                effective_provider_registry = build_provider_registry(
                    settings,
                    effective_service,
                    qdrant_store,
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
        assert effective_admin_auth_config is not None
        effective_service.startup()
        application.state.file_ingestion_service = effective_service
        application.state.health_dependencies = effective_health_dependencies
        application.state.admin_auth_config = effective_admin_auth_config
        application.state.upload_rate_limiter = InMemoryRateLimiter()
        application.state.admin_login_rate_limiter = AdminLoginRateLimiter()
        application.state.provider_registry = (
            effective_provider_registry or ProviderRegistry(())
        )
        application.state.admin_dashboard_status_service = AdminDashboardStatusService(
            registry=application.state.provider_registry,
            qdrant_store=effective_health_dependencies.qdrant_store,
            embedding_client=effective_health_dependencies.model_client,
            description_client=effective_health_dependencies.description_client,
        )
        try:
            yield
        finally:
            for key in (
                "file_ingestion_service",
                "health_dependencies",
                "admin_auth_config",
                "upload_rate_limiter",
                "admin_login_rate_limiter",
                "provider_registry",
                "admin_dashboard_status_service",
            ):
                application.state._state.pop(key, None)

    app = FastAPI(
        title="OpenAI File Embeddings",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.include_router(file_embeddings_router)
    app.include_router(vector_search_router)
    app.include_router(thumbnails_router)
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(admin_sync_router)

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
