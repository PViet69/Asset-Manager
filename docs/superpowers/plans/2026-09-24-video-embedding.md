# Video Embedding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Index provider-synced MP4, MOV, and WebM assets as one structured whole-video description, one text embedding, and one stable Qdrant point per asset.

**Architecture:** Keep image ingestion on renamed `InstructorAssetDescriptionClient`; add independent Google Gen AI SDK video client that owns temporary Files API upload, readiness wait, structured generation, and cleanup. Extend provider discovery and ingestion routing by supported MIME type while reusing existing embedding, Qdrant payload, stable point-ID, retry, and per-item-failure behavior.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic v2, Google Gen AI SDK (`google-genai`), OpenAI-compatible embedding client, Qdrant, pytest, Ruff.

**Spec:** `docs/superpowers/specs/2026-09-24-video-embedding-design.md`

## Global Constraints

- Provider sync only; manual upload endpoint is outside feature scope.
- Supported video types: `video/mp4`, `video/quicktime`, `video/webm`.
- Reject provider video exceeding `200 * 1024 * 1024` bytes before download.
- No default `VIDEO_MODEL`; require both `VIDEO_MODEL` and `VIDEO_MODEL_API_KEY` before video analysis.
- No local video files. Downloaded provider bytes exist only during processing; Files API object is deleted in `finally`.
- Use `InstructorAssetDescriptionClient` as image-client name.
- Google Gen AI output must validate as existing `ImageDescription`.
- Do not commit unless user explicitly asks.

---

## File Structure

| File | Responsibility |
|---|---|
| `pyproject.toml` | Add Google Gen AI SDK runtime dependency. |
| `.env.example` | Document empty video-model settings. |
| `backend/app/config.py` | Validate paired video model configuration and expose capability state. |
| `backend/app/model/prompts.py` | Add factual whole-video structured-output prompt. |
| `backend/app/model/description_client.py` | Rename image protocol/client to asset names without behavior change. |
| `backend/app/model/video_description_client.py` | Encapsulate Gen AI upload, readiness polling, structured generation, error conversion, cleanup. |
| `backend/app/file_embeddings/ingestion_service.py` | Route provider images to asset client and provider videos to video client; retain existing Qdrant write path. |
| `backend/app/storage/client.py` | Recognize supported video types in Drive metadata and Dropbox extension mapping. |
| `backend/app/storage/scheduler.py` | Reject oversized provider videos before download. |
| `backend/app/main.py` | Build and inject both description clients from settings. |
| `backend/tests/unit/test_*.py` | Unit coverage for each boundary. |
| `backend/tests/integration/test_e2e_ingestion.py` | Verify stable provider-backed video point and retrieval payload. |

## Task 1: Add Video Configuration and SDK Dependency

**Files:**
- Modify: `pyproject.toml:4-19`
- Modify: `.env.example:3-11`
- Modify: `backend/app/config.py:52-93`
- Test: `backend/tests/unit/test_config.py`

**Interfaces:**
- Produces: `Settings.VIDEO_MODEL: NonBlankSetting | None`, `Settings.VIDEO_MODEL_API_KEY: str | None`, and `Settings.has_video_model: bool`.
- Consumed by: `VideoModelDescriptionClient.from_settings(settings)` and `create_app()`.

- [ ] **Step 1: Write failing paired-config tests**

```python
@pytest.mark.unit
@pytest.mark.parametrize(
    "overrides",
    (
        {"VIDEO_MODEL": "gemini-3.8-flash"},
        {"VIDEO_MODEL_API_KEY": "video-key"},
    ),
)
def test_settings_reject_partial_video_model_configuration(
    overrides: dict[str, str],
) -> None:
    with pytest.raises(ValidationError, match="VIDEO_MODEL and VIDEO_MODEL_API_KEY"):
        Settings(_env_file=None, **BASE_SETTINGS, **overrides)


@pytest.mark.unit
def test_settings_reports_video_model_capability_when_pair_is_configured() -> None:
    settings = Settings(
        _env_file=None,
        **BASE_SETTINGS,
        VIDEO_MODEL="gemini-3.8-flash",
        VIDEO_MODEL_API_KEY="video-key",
    )

    assert settings.has_video_model is True
```

- [ ] **Step 2: Run config tests and verify RED**

Run: `uv run pytest backend/tests/unit/test_config.py -v`

Expected: FAIL because video settings and capability property do not exist.

- [ ] **Step 3: Add dependency and empty env placeholders**

```toml
# pyproject.toml dependencies
"google-genai>=1.0.0",
```

```dotenv
# .env.example
VIDEO_MODEL=
VIDEO_MODEL_API_KEY=
```

- [ ] **Step 4: Implement paired optional settings validation**

Add optional fields and property to `Settings`; validation must accept both fields absent, reject exactly one present, and never log either value.

```python
VIDEO_MODEL: NonBlankSetting | None = None
VIDEO_MODEL_API_KEY: str | None = None

@property
def has_video_model(self) -> bool:
    return self.VIDEO_MODEL is not None and self.VIDEO_MODEL_API_KEY is not None
```

Extend existing model validator with a second missing-pair check:

```python
video_values = (self.VIDEO_MODEL, self.VIDEO_MODEL_API_KEY)
if any(value is not None for value in video_values) and not all(video_values):
    raise ValueError("VIDEO_MODEL and VIDEO_MODEL_API_KEY must be set together")
```

- [ ] **Step 5: Run config tests and verify GREEN**

Run: `uv run pytest backend/tests/unit/test_config.py -v`

Expected: PASS.

- [ ] **Step 6: Refresh lockfile and validate dependency metadata**

Run: `uv lock && uv sync --all-extras && uv run python -c 'from google import genai; print(genai.__name__)'`

Expected: command exits 0 and prints `google.genai`.

## Task 2: Rename Image Description Boundary to Asset Description Boundary

**Files:**
- Modify: `backend/app/model/description_client.py:27-177`
- Modify: `backend/app/file_embeddings/ingestion_service.py:32,70-80,273-275`
- Modify: `backend/app/main.py:30,80-95`
- Modify: all backend imports and mocks referring to old names
- Test: `backend/tests/unit/test_description_client.py`
- Test: `backend/tests/integration/test_e2e_ingestion.py`

**Interfaces:**
- Produces: `AssetDescriptionClient` protocol and `InstructorAssetDescriptionClient` implementation, both retaining `describe(image_bytes: bytes) -> ImageDescription`.
- Consumed by: `FileIngestionService` image path and health dependencies.

- [ ] **Step 1: Write failing rename-import test**

Replace one unit-test import and construction with:

```python
from backend.app.model.description_client import InstructorAssetDescriptionClient

client = InstructorAssetDescriptionClient.from_client(
    sdk,
    description_model="vision-model",
)
```

- [ ] **Step 2: Run targeted test and verify RED**

Run: `uv run pytest backend/tests/unit/test_description_client.py -v`

Expected: FAIL because `InstructorAssetDescriptionClient` is absent.

- [ ] **Step 3: Rename protocol and class consistently**

Rename `ImageDescriptionClient` to `AssetDescriptionClient` and `InstructorImageDescriptionClient` to `InstructorAssetDescriptionClient`. Update imports, type annotations, construction, mocks, and test names where naming asserts image-specific client identity. Preserve OpenAI/instructor request behavior exactly.

- [ ] **Step 4: Run affected unit and integration tests**

Run: `uv run pytest backend/tests/unit/test_description_client.py backend/tests/unit/test_ingestion_service.py backend/tests/integration/test_e2e_ingestion.py -v`

Expected: PASS. Existing image behavior unchanged.

## Task 3: Build Google Gen AI Video Description Client

**Files:**
- Create: `backend/app/model/video_description_client.py`
- Test: `backend/tests/unit/test_video_description_client.py`

**Interfaces:**
- Consumes: `model_name: str`, `api_key: str`, `content: bytes`, `mime_type: str`.
- Produces: `VideoDescriptionClient` protocol with `describe(content: bytes, mime_type: str) -> ImageDescription`; `VideoModelDescriptionClient` implementation.
- Errors: raise `ModelEndpointError` with only safe messages: `Video model is not configured`, `Unsupported video format`, or `Video model request failed`.

- [ ] **Step 1: Write failing success cleanup test**

```python
@pytest.mark.unit
def test_describe_returns_validated_video_and_deletes_uploaded_file() -> None:
    sdk = Mock()
    uploaded = SimpleNamespace(name="files/video-1", state="ACTIVE")
    sdk.files.upload.return_value = uploaded
    sdk.files.get.return_value = uploaded
    sdk.models.generate_content.return_value = SimpleNamespace(
        parsed=ImageDescription(
            subjects=(Subject.HUMAN, Subject.ELECTRONICS),
            actions=(Action.SPEAKING,),
            setting=(Setting.OFFICE,),
            colors=(Color.BLUE,),
            style=(Style.REAL_LIFE,),
        )
    )
    client = VideoModelDescriptionClient.from_client(
        sdk, model_name="gemini-test"
    )

    result = client.describe(b"video-bytes", "video/mp4")

    assert result.subjects == (Subject.HUMAN, Subject.ELECTRONICS)
    sdk.files.delete.assert_called_once_with(name="files/video-1")
```

- [ ] **Step 2: Write failing failure-cleanup test**

```python
@pytest.mark.unit
def test_describe_deletes_uploaded_file_when_generation_fails() -> None:
    sdk = Mock()
    sdk.files.upload.return_value = SimpleNamespace(name="files/video-1", state="ACTIVE")
    sdk.files.get.return_value = sdk.files.upload.return_value
    sdk.models.generate_content.side_effect = RuntimeError("provider response")
    client = VideoModelDescriptionClient.from_client(sdk, model_name="gemini-test")

    with pytest.raises(ModelEndpointError, match="Video model request failed"):
        client.describe(b"video-bytes", "video/mp4")

    sdk.files.delete.assert_called_once_with(name="files/video-1")
```

- [ ] **Step 3: Run client tests and verify RED**

Run: `uv run pytest backend/tests/unit/test_video_description_client.py -v`

Expected: FAIL because module and client do not exist.

- [ ] **Step 4: Implement narrow client boundary**

Implement supported MIME constant and Pydantic structured response config. Client sequence:

```python
def describe(self, content: bytes, mime_type: str) -> ImageDescription:
    if mime_type not in SUPPORTED_VIDEO_MIME_TYPES:
        raise ModelEndpointError("Unsupported video format")
    uploaded = None
    try:
        uploaded = self._client.files.upload(
            file=io.BytesIO(content),
            config=types.UploadFileConfig(mime_type=mime_type),
        )
        active_file = self._wait_until_active(uploaded.name)
        response = self._client.models.generate_content(
            model=self._model_name,
            contents=[VIDEO_CAPTIONING_PROMPT, active_file],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=ImageDescription,
            ),
        )
        return ImageDescription.model_validate(response.parsed)
    except ModelEndpointError:
        raise
    except Exception as exc:
        logger.error("Video model analysis failed: %s", type(exc).__name__)
        raise ModelEndpointError("Video model request failed", exc) from exc
    finally:
        if uploaded is not None:
            self._delete_uploaded_file(uploaded.name)
```

`_wait_until_active` polls Files API until active; terminal failed state raises safe `ModelEndpointError`. `_delete_uploaded_file` catches/logs deletion errors and never raises. Do not log input bytes, API key, URI, or provider response body.

- [ ] **Step 5: Run client tests and verify GREEN**

Run: `uv run pytest backend/tests/unit/test_video_description_client.py -v`

Expected: PASS.

## Task 4: Detect Provider Videos and Reject Oversized Assets Before Download

**Files:**
- Modify: `backend/app/storage/client.py:17-27,167-187,345-366`
- Modify: `backend/app/storage/scheduler.py:147-214`
- Test: `backend/tests/unit/test_storage_client.py`
- Test: `backend/tests/unit/test_storage_scheduler.py`

**Interfaces:**
- Produces: `SUPPORTED_VIDEO_MIME_TYPES`, `MAX_PROVIDER_VIDEO_SIZE_BYTES = 200 * 1024 * 1024`, and `is_oversized_video(file: StorageFile) -> bool`.
- Consumed by: provider listing and `StorageSyncScheduler._upsert`.

- [ ] **Step 1: Write failing provider recognition tests**

```python
@pytest.mark.unit
@pytest.mark.parametrize(
    ("name", "expected_mime"),
    (("clip.mp4", "video/mp4"), ("clip.mov", "video/quicktime"), ("clip.webm", "video/webm")),
)
def test_dropbox_maps_supported_video_extensions(name: str, expected_mime: str) -> None:
    entry = SimpleNamespace(id="id", path_display=f"/team/{name}", name=name, size=9,
                            client_modified=datetime(2026, 8, 1, tzinfo=timezone.utc))

    assert _to_dropbox_file(entry).mime_type == expected_mime
```

Add Google Drive listing fixture containing `video/mp4` and assert it appears alongside supported images. Add unsupported `video/x-msvideo` assertion that it remains excluded.

- [ ] **Step 2: Write failing scheduler no-download test**

```python
@pytest.mark.unit
@pytest.mark.asyncio
async def test_sync_rejects_oversized_video_before_provider_download() -> None:
    video = StorageFile(StorageProvider.DROPBOX, "video", "clip.mp4", "video/mp4",
                        TEST_TIME, 200 * 1024 * 1024 + 1, "https://example.test/video")
    client = _Client([video])
    result = await StorageSyncScheduler(
        StorageProvider.DROPBOX, client, "/root", _Ingestion([]), _Qdrant([], [])
    ).tick_once()

    assert result.upserted == 0
    assert client.download_calls == []
    assert any(trace.detail == "Video exceeds 200 MiB limit" for trace in result.traces)
```

- [ ] **Step 3: Run storage tests and verify RED**

Run: `uv run pytest backend/tests/unit/test_storage_client.py backend/tests/unit/test_storage_scheduler.py -v`

Expected: FAIL because providers filter out video and scheduler downloads oversized video.

- [ ] **Step 4: Extend supported MIME/extension mapping**

```python
SUPPORTED_IMAGE_MIME_TYPES = frozenset({"image/png", "image/jpeg", "image/webp"})
SUPPORTED_VIDEO_MIME_TYPES = frozenset({"video/mp4", "video/quicktime", "video/webm"})
SUPPORTED_STORAGE_MIME_TYPES = SUPPORTED_IMAGE_MIME_TYPES | SUPPORTED_VIDEO_MIME_TYPES
MAX_PROVIDER_VIDEO_SIZE_BYTES = 200 * 1024 * 1024

_EXTENSION_MIMES = {
    # existing image mappings
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
}
```

Use `SUPPORTED_STORAGE_MIME_TYPES` only for listing. Keep `_THUMBNAIL_MIME_TYPES` image-only.

- [ ] **Step 5: Add pre-download scheduler guard**

At start of `_upsert`, after `file_prepare` trace and before `self._client.download`:

```python
if (
    file.mime_type in SUPPORTED_VIDEO_MIME_TYPES
    and file.size > MAX_PROVIDER_VIDEO_SIZE_BYTES
):
    trace("file_ingestion", "failed", "Video exceeds 200 MiB limit", file)
    return 0
```

- [ ] **Step 6: Run storage tests and verify GREEN**

Run: `uv run pytest backend/tests/unit/test_storage_client.py backend/tests/unit/test_storage_scheduler.py -v`

Expected: PASS.

## Task 5: Route Provider Video Through Video Client

**Files:**
- Modify: `backend/app/file_embeddings/ingestion_service.py:24-32,70-80,212-275`
- Modify: `backend/app/main.py:27-31,78-101`
- Test: `backend/tests/unit/test_ingestion_service.py`
- Test: `backend/tests/integration/test_e2e_ingestion.py`

**Interfaces:**
- Consumes: `AssetDescriptionClient.describe(image_bytes: bytes) -> ImageDescription`; `VideoDescriptionClient.describe(content: bytes, mime_type: str) -> ImageDescription`.
- Produces: `FileIngestionService(..., asset_description_client, video_description_client: VideoDescriptionClient | None, ...)` and provider-sync video routing.

- [ ] **Step 1: Write failing video routing test**

```python
@pytest.mark.unit
def test_provider_video_uses_video_client_and_stores_stable_point() -> None:
    service, asset_client, video_client, model_client, qdrant_store = make_service()
    video_client.describe.return_value = make_description()
    model_client.embed_text.return_value = [0.4]
    upload = make_storage_upload("demo.mp4", "video/mp4", b"video", "demo.mp4")

    response = service.process_files((upload,))

    assert response.data[0].status == "success"
    asset_client.describe.assert_not_called()
    video_client.describe.assert_called_once_with(b"video", "video/mp4")
    qdrant_store.store_embedding.assert_called_once_with(
        [0.4], payload=ANY, point_id=stable_point_id(StorageProvider.GOOGLE_DRIVE, "drive-id-1")
    )
```

- [ ] **Step 2: Run ingestion tests and verify RED**

Run: `uv run pytest backend/tests/unit/test_ingestion_service.py -v`

Expected: FAIL because service lacks video client and routes all content through image processing.

- [ ] **Step 3: Preserve manual image processing boundary**

Introduce provider-sync route selection in `FileIngestionService`:

```python
def _to_embedding_text(self, file: FileUpload) -> str:
    if file.content_type in SUPPORTED_VIDEO_MIME_TYPES:
        if self._video_description_client is None:
            raise ModelEndpointError("Video analysis model is not configured")
        return self._video_description_client.describe(
            file.content, file.content_type
        ).to_embedding_text()
    processed = process_file(file.content, file.filename, file.content_type)
    return self._asset_description_client.describe(processed.value).to_embedding_text()
```

Call this method from `_process_one`; retain same embedding call, tags, payload, stable point-ID, and safe error mapping. Rename private image-client field to `_asset_description_client`.

- [ ] **Step 4: Wire app dependencies**

In `create_app()`, always construct `InstructorAssetDescriptionClient`. Construct `VideoModelDescriptionClient` only when `settings.has_video_model`; pass `None` otherwise. Do not expose video model in existing image model health surface unless product requirements add it later.

- [ ] **Step 5: Run routing and regression tests**

Run: `uv run pytest backend/tests/unit/test_ingestion_service.py backend/tests/integration/test_e2e_ingestion.py backend/tests/integration/test_routes.py -v`

Expected: PASS. Existing image ingestion remains unchanged; manual upload endpoint is not modified or tested.

## Task 6: Verify Provider-Backed Video Point and Full Quality Gate

**Files:**
- Modify: `backend/tests/integration/test_e2e_ingestion.py:40-139`
- Modify as required: `backend/tests/unit/test_config.py`, `backend/tests/unit/test_description_client.py`, and imports renamed by Task 3

**Interfaces:**
- Verifies: provider-backed video uses stable Qdrant ID, structured retrieval content, source metadata, and existing vector collection.

- [ ] **Step 1: Write failing provider-video integration test**

```python
@pytest.mark.integration
def test_provider_video_stores_stable_vector_and_structured_payload() -> None:
    asset_client = Mock(spec=AssetDescriptionClient)
    video_client = Mock(spec=VideoDescriptionClient)
    video_client.describe.return_value = ImageDescription(
        subjects=(Subject.HUMAN, Subject.ELECTRONICS),
        actions=(Action.SPEAKING,),
        setting=(Setting.OFFICE,),
        colors=(Color.BLUE,),
        style=(Style.REAL_LIFE,),
    )
    model_client = Mock(spec=ModelClient)
    model_client.model_name = "deterministic-embedding"
    model_client.embed_text.return_value = [0.11, 0.22, 0.33]
    store = QdrantEmbeddingStore.from_client(QdrantClient(":memory:"), 3, "e2e-video")
    service = FileIngestionService(asset_client, model_client, store, video_client)
    service.startup()

    result = service.process_files((FileUpload(
        filename="demo.mp4", content_type="video/mp4", content=b"video-bytes",
        file_path="demo.mp4", modified_time=datetime(2026, 9, 24, tzinfo=timezone.utc),
        provider=StorageProvider.GOOGLE_DRIVE, storage_file_id="video-1",
        source_url="https://drive.google.com/file/d/video-1/view",
    ),))

    assert result.data[0].status == "success"
    points, _ = qdrant_client.scroll(
        collection_name="e2e-video", limit=10, with_vectors=False
    )
    assert len(points) == 1
    assert points[0].id == stable_point_id(StorageProvider.GOOGLE_DRIVE, "video-1")
    assert points[0].payload == {
        "filename": "demo.mp4",
        "file_path": "demo.mp4",
        "file_type": "video/mp4",
        "content": video_client.describe.return_value.to_embedding_text(),
        "tags": list(parse_content_tags(video_client.describe.return_value.to_embedding_text())),
        "modified_time": "2026-09-24T00:00:00+00:00",
        "provider": StorageProvider.GOOGLE_DRIVE,
        "storage_file_id": "video-1",
        "source_url": "https://drive.google.com/file/d/video-1/view",
    }
    asset_client.describe.assert_not_called()
    video_client.describe.assert_called_once_with(b"video-bytes", "video/mp4")
```

- [ ] **Step 2: Run integration test and verify RED**

Run: `uv run pytest backend/tests/integration/test_e2e_ingestion.py::test_provider_video_stores_stable_vector_and_structured_payload -v`

Expected: FAIL before Task 6 wiring is complete; after Task 6, correct any actual assertion mismatch only.

- [ ] **Step 3: Complete test assertions without changing production behavior**

Assert exact stable UUID with `stable_point_id(StorageProvider.GOOGLE_DRIVE, "video-1")`, payload `file_type == "video/mp4"`, provider/source fields, `content == video_description.to_embedding_text()`, and tags derived through existing parser. Assert asset client is not called and video client receives raw bytes and MIME.

- [ ] **Step 4: Run focused complete video suite**

Run: `uv run pytest backend/tests/unit/test_config.py backend/tests/unit/test_prompt_model.py backend/tests/unit/test_video_description_client.py backend/tests/unit/test_storage_client.py backend/tests/unit/test_storage_scheduler.py backend/tests/unit/test_ingestion_service.py backend/tests/integration/test_e2e_ingestion.py -v`

Expected: PASS.

- [ ] **Step 5: Run formatting, lint, full tests, and coverage**

Run:

```bash
uv run ruff format --check backend
uv run ruff check backend
uv run pytest --cov=backend --cov-report=term-missing
```

Expected: all commands exit 0; total coverage remains at least 80%.

- [ ] **Step 6: Inspect working tree without committing**

Run: `git status --short`

Expected: only plan-scoped dependency, configuration, backend source, and test changes appear. Do not commit unless user explicitly asks.

## Plan Self-Review

- Spec coverage: Task 1 covers paired no-default configuration; Task 2 required asset-client rename; Task 3 temporary Files API lifecycle and safe failures; Task 5 provider detection and 200 MiB pre-download rejection; Task 6 provider-only routing and unchanged manual images; Task 7 stable Qdrant integration and verification.
- Placeholder scan: no implementation placeholders remain; code snippets define every new named interface.
- Type consistency: `VideoDescriptionClient.describe(content: bytes, mime_type: str) -> ImageDescription` is introduced in Task 3 and used consistently in Tasks 5–6. `AssetDescriptionClient` is created in Task 2 before later consumers.
