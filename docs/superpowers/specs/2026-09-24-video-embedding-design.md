# Video Embedding Design

## Goal

Index provider-synced videos for semantic search without changing image ingestion. Each supported video produces one structured description, one text embedding, and one stable Qdrant point.

## Scope

Only provider synchronization handles videos. Manual upload is outside this feature scope. Supported video MIME types are `video/mp4`, `video/quicktime`, and `video/webm`. Videos larger than 200 MiB are rejected before provider download.

## Configuration

Add required video-model settings loaded from `.env`:

```dotenv
VIDEO_MODEL=
VIDEO_MODEL_API_KEY=
```

There is no default model or fallback. A video item fails with a safe configuration error when either value is absent. Image synchronization continues normally.

## Architecture

Add a dedicated Google Gen AI SDK-backed video description client. It owns temporary Files API upload, readiness polling, structured generation, and cleanup. It returns the existing validated `ImageDescription` Pydantic model.

Images and videos share `ImageDescription`, including its searchable fields and retrieval-text formatter. Only asset MIME routing and description-model client differ.

File ingestion routes by validated content type:

- Images use renamed `InstructorAssetDescriptionClient` flow unchanged.
- Supported videos use video description client.
- Other types return existing safe unsupported-file behavior.

## Provider Sync Flow

1. Provider clients detect supported videos during listing by provider MIME type (Google Drive) or known video extension mapped to MIME type (Dropbox). Listed video metadata includes byte size.
2. Scheduler rejects a video whose metadata size exceeds 200 MiB. It does not call provider download or video model.
3. Scheduler downloads eligible private video bytes into process memory. It does not write a local file.
4. Video client uploads bytes to Google Gen AI Files API with validated MIME type.
5. Client waits until uploaded file reaches active state.
6. Client requests structured whole-video description using `VIDEO_MODEL` and `VIDEO_MODEL_API_KEY`.
7. Client deletes temporary temporary video-model file in `finally`.
8. Ingestion converts validated description to retrieval text, calls existing embedding model, and upserts existing stable provider/storage-file Qdrant point.

## Failure Handling

- Oversized video: per-item sync failure before download.
- Missing video model configuration: per-item safe failure before video-model upload.
- video-model upload, readiness, generation, validation, or endpoint errors: per-item safe failure; later files continue.
- Temporary-file deletion failure: log diagnostic detail; never replace successful analysis result.
- Existing scheduler retry and cancellation behavior remains.

## Testing

Write tests before implementation:

1. Settings require `VIDEO_MODEL` and `VIDEO_MODEL_API_KEY` for video capability.
2. Provider clients recognize MP4, MOV, and WebM; unsupported video remains excluded.
3. Scheduler does not download video exceeding 200 MiB.
4. Video client returns validated descriptions and cleans temporary Files API objects after success and failure.
5. Ingestion preserves image routing and routes supported video to video client.
6. Provider-sync integration writes one stable Qdrant point with structured video retrieval content.
