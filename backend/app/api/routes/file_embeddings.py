"""File embedding API routes."""

from datetime import datetime, timezone

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.params import Param

from backend.app.api.dependencies import get_file_ingestion_service
from backend.app.api.schemas.file_embeddings import FileEmbeddingResponse
from backend.app.exceptions import ModelNotFoundError
from backend.app.file_embeddings.ingestion_service import (
    FileIngestionService,
    FileUpload,
)
from backend.app.file_processing.service import MAX_FILE_SIZE
from backend.app.security import (
    MAX_REQUEST_SIZE,
    reject_oversized_request,
    require_upload_access,
)

MAX_FILES = 10
MAX_AGGREGATE_UPLOAD_SIZE = MAX_REQUEST_SIZE

router = APIRouter()


def authorize_upload(request: Request) -> None:
    """Apply request-size, authentication, and rate-limit controls."""
    reject_oversized_request(request)
    require_upload_access(request)


def _is_field_info(value: object) -> bool:
    """Detect FastAPI's placeholder when a Form param isn't supplied."""
    return isinstance(value, Param)


def _parse_modified_time(raw: object) -> datetime:
    """Parse ISO-8601 modified_time; fall back to now() when absent or invalid.

    Direct (non-HTTP) callers may pass a Form ``Param`` placeholder instead of
    a real string. Treat anything that isn't a real string as missing.
    """
    if _is_field_info(raw) or not isinstance(raw, str) or not raw:
        return datetime.now(timezone.utc)
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail=f"Invalid modified_time: {raw}"
        ) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _as_list(value: object) -> list[object]:
    """Coerce a repeated form value to a list. None / FieldInfo → []."""
    if value is None or _is_field_info(value):
        return []
    if isinstance(value, list):
        return value
    return [value]


@router.post(
    "/v1/file-embeddings",
    response_model=FileEmbeddingResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(authorize_upload)],
)
def create_file_embeddings(
    files: list[UploadFile] | None = File(default=None),
    file_path: list[str] | None = Form(default=None),
    drive_id: list[str] | None = Form(default=None),
    modified_time: list[str] | None = Form(default=None),
    service: FileIngestionService = Depends(get_file_ingestion_service),
) -> FileEmbeddingResponse:
    """Create embeddings for uploaded files. Each file must carry a drive_id."""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    try:
        if len(files) > MAX_FILES:
            raise HTTPException(
                status_code=400,
                detail=f"A maximum of {MAX_FILES} files is allowed",
            )

        paths: list[str] = [
            str(p) for p in _as_list(file_path) if not _is_field_info(p)
        ]
        if len(paths) > len(files):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"`file_path` has more entries than `files` "
                    f"({len(paths)} paths for {len(files)} files)"
                ),
            )
        while len(paths) < len(files):
            paths.append("")

        ids: list[str] = [str(d) for d in _as_list(drive_id) if not _is_field_info(d)]
        if len(ids) < len(files):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"`drive_id` is required for every file "
                    f"(got {len(ids)} ids for {len(files)} files)"
                ),
            )
        while len(ids) > len(files):
            ids.pop()

        times: list[object] = [
            t for t in _as_list(modified_time) if not _is_field_info(t)
        ]
        while len(times) < len(files):
            times.append(None)

        uploads: list[FileUpload] = []
        aggregate_size = 0
        for index, file in enumerate(files):
            remaining = MAX_AGGREGATE_UPLOAD_SIZE - aggregate_size
            content = file.file.read(min(MAX_FILE_SIZE + 1, remaining + 1))
            aggregate_size += len(content)
            uploads.append(
                FileUpload(
                    filename=file.filename or "",
                    content_type=file.content_type or "",
                    content=content,
                    file_path=paths[index],
                    drive_id=ids[index],
                    modified_time=_parse_modified_time(times[index]),
                )
            )
            if aggregate_size > MAX_AGGREGATE_UPLOAD_SIZE:
                raise HTTPException(
                    status_code=413,
                    detail="Request exceeds 250 MB limit",
                )

        try:
            return service.process_files(tuple(uploads))
        except ModelNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=exc.safe_message,
            ) from exc
    finally:
        for file in files:
            file.file.close()
