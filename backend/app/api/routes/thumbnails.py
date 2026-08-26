"""Provider-backed image thumbnail API route."""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response

from backend.app.api.dependencies import get_file_ingestion_service
from backend.app.file_embeddings.ingestion_service import FileIngestionService
from backend.app.security import require_upload_access
from backend.app.storage.thumbnail_service import (
    ThumbnailProviderDisabled,
    ThumbnailProviderUnavailable,
    ThumbnailService,
    ThumbnailSourceNotFound,
    UnsupportedThumbnailSource,
)

router = APIRouter()


@router.get(
    "/v1/storage/{provider}/{storage_file_id}/thumbnail",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_upload_access)],
)
def get_thumbnail(
    provider: str,
    storage_file_id: str,
    request: Request,
    ingestion_service: FileIngestionService = Depends(get_file_ingestion_service),
) -> Response:
    """Return a validated provider thumbnail without exposing source bytes."""
    service = ThumbnailService(request.app.state.provider_registry, ingestion_service)
    try:
        thumbnail = service.get_thumbnail(provider, storage_file_id)
    except ThumbnailSourceNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except UnsupportedThumbnailSource as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc
    except ThumbnailProviderDisabled as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except ThumbnailProviderUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc
    return Response(
        content=thumbnail.content,
        media_type=thumbnail.media_type,
        headers={"Cache-Control": "private, max-age=300"},
    )
