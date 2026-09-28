import fakeredis
import pytest

from backend.app.tasks.job_store import RedisSyncJobStore, SyncJobProgress


@pytest.mark.unit
def test_acquire_provider_job_returns_existing_id_without_overwriting() -> None:
    store = RedisSyncJobStore(fakeredis.FakeRedis(decode_responses=True), 86_400)

    assert store.acquire_provider_job("dropbox", "job-1") is None
    assert store.acquire_provider_job("dropbox", "job-2") == "job-1"
    assert store.get_provider_job_id("dropbox") == "job-1"


@pytest.mark.unit
def test_release_only_removes_lock_owned_by_same_job() -> None:
    store = RedisSyncJobStore(fakeredis.FakeRedis(decode_responses=True), 86_400)
    store.acquire_provider_job("dropbox", "job-1")

    store.release_provider_job("dropbox", "job-2")

    assert store.get_provider_job_id("dropbox") == "job-1"


@pytest.mark.unit
def test_progress_round_trip_excludes_raw_exception_text() -> None:
    store = RedisSyncJobStore(fakeredis.FakeRedis(decode_responses=True), 86_400)
    progress: SyncJobProgress = {
        "provider": "dropbox",
        "state": "FAILURE",
        "attempt": 3,
        "phase": None,
        "upserted": 0,
        "deleted": 0,
        "unchanged": 0,
        "failed": 1,
        "cancellation_requested": False,
        "detail": "Provider sync failed",
        "embedded_delta": 0,
        "activity": (),
    }

    store.write_progress("job-1", progress)

    assert store.read_progress("job-1") == progress


@pytest.mark.unit
def test_append_activity_keeps_safe_ordered_bounded_history() -> None:
    store = RedisSyncJobStore(fakeredis.FakeRedis(decode_responses=True), 86_400)
    progress: SyncJobProgress = {
        "provider": "dropbox",
        "state": "STARTED",
        "attempt": 1,
        "phase": None,
        "upserted": 0,
        "deleted": 0,
        "unchanged": 0,
        "failed": 0,
        "cancellation_requested": False,
        "detail": None,
        "embedded_delta": 0,
        "activity": (),
    }
    store.write_progress("job-1", progress)

    for sequence in range(1, 53):
        store.append_activity(
            "job-1",
            {
                "sequence": sequence,
                "storage_file_id": f"id-{sequence}",
                "filename": f"file-{sequence}.pdf",
                "status": "indexing",
            },
        )
    store.append_activity(
        "job-1",
        {
            "sequence": 52,
            "storage_file_id": "id-52",
            "filename": "file-52.pdf",
            "status": "failed",
        },
    )

    stored = store.read_progress("job-1")

    assert stored is not None
    assert stored["activity"] == (
        *(
            {
                "sequence": sequence,
                "storage_file_id": f"id-{sequence}",
                "filename": f"file-{sequence}.pdf",
                "status": "indexing",
                "embedded_delta": 0,
            }
            for sequence in range(3, 52)
        ),
        {
            "sequence": 52,
            "storage_file_id": "id-52",
            "filename": "file-52.pdf",
            "status": "failed",
            "embedded_delta": 0,
        },
    )


@pytest.mark.unit
def test_append_activity_replaces_card_by_storage_file_id() -> None:
    store = RedisSyncJobStore(fakeredis.FakeRedis(decode_responses=True), 86_400)
    progress: SyncJobProgress = {
        "provider": "dropbox",
        "state": "STARTED",
        "attempt": 1,
        "phase": None,
        "upserted": 0,
        "deleted": 0,
        "unchanged": 0,
        "failed": 0,
        "cancellation_requested": False,
        "detail": None,
        "embedded_delta": 0,
        "activity": (),
    }
    store.write_progress("job-1", progress)

    store.append_activity(
        "job-1",
        {
            "sequence": 1,
            "storage_file_id": "file-1",
            "filename": "report.pdf",
            "status": "preparing",
        },
    )
    store.append_activity(
        "job-1",
        {
            "sequence": 2,
            "storage_file_id": "file-1",
            "filename": "report.pdf",
            "status": "indexed",
        },
    )

    stored = store.read_progress("job-1")

    assert stored is not None
    assert stored["activity"] == (
        {
            "sequence": 2,
            "storage_file_id": "file-1",
            "filename": "report.pdf",
            "status": "indexed",
            "embedded_delta": 0,
        },
    )


@pytest.mark.unit
def test_append_activity_keeps_duplicate_filenames_with_distinct_storage_ids() -> None:
    store = RedisSyncJobStore(fakeredis.FakeRedis(decode_responses=True), 86_400)
    progress: SyncJobProgress = {
        "provider": "dropbox",
        "state": "STARTED",
        "attempt": 1,
        "phase": None,
        "upserted": 0,
        "deleted": 0,
        "unchanged": 0,
        "failed": 0,
        "cancellation_requested": False,
        "detail": None,
        "embedded_delta": 0,
        "activity": (),
    }
    store.write_progress("job-1", progress)

    for sequence, storage_file_id in enumerate(("folder-a/file", "folder-b/file"), 1):
        store.append_activity(
            "job-1",
            {
                "sequence": sequence,
                "storage_file_id": storage_file_id,
                "filename": "report.pdf",
                "status": "indexing",
            },
        )

    stored = store.read_progress("job-1")

    assert stored is not None
    assert [item["storage_file_id"] for item in stored["activity"]] == [
        "folder-a/file",
        "folder-b/file",
    ]


@pytest.mark.unit
def test_append_activity_increments_embedded_delta_only_for_new_indexed_files() -> None:
    store = RedisSyncJobStore(fakeredis.FakeRedis(decode_responses=True), 86_400)
    progress: SyncJobProgress = {
        "provider": "dropbox",
        "state": "STARTED",
        "attempt": 1,
        "phase": None,
        "upserted": 0,
        "deleted": 0,
        "unchanged": 0,
        "failed": 0,
        "cancellation_requested": False,
        "detail": None,
        "embedded_delta": 0,
        "activity": (),
    }
    store.write_progress("job-1", progress)

    # 1. Preparing trace does not increment delta
    store.append_activity(
        "job-1",
        {
            "sequence": 1,
            "storage_file_id": "file-1",
            "filename": "first.pdf",
            "status": "preparing",
            "embedded_delta": 1,
        },
    )
    assert store.read_progress("job-1")["embedded_delta"] == 0

    # 2. Newly indexed file (embedded_delta=1) increments cumulative delta
    store.append_activity(
        "job-1",
        {
            "sequence": 2,
            "storage_file_id": "file-1",
            "filename": "first.pdf",
            "status": "indexed",
            "embedded_delta": 1,
        },
    )
    assert store.read_progress("job-1")["embedded_delta"] == 1

    # 3. Repeated update for already indexed file does not double-count
    store.append_activity(
        "job-1",
        {
            "sequence": 3,
            "storage_file_id": "file-1",
            "filename": "first.pdf",
            "status": "indexed",
            "embedded_delta": 1,
        },
    )
    assert store.read_progress("job-1")["embedded_delta"] == 1

    # 4. Reindexed file that was already in Qdrant (embedded_delta=0) does not increment
    store.append_activity(
        "job-1",
        {
            "sequence": 4,
            "storage_file_id": "file-2",
            "filename": "existing.pdf",
            "status": "indexed",
            "embedded_delta": 0,
        },
    )
    assert store.read_progress("job-1")["embedded_delta"] == 1

    # 5. Second newly indexed file increments to 2
    store.append_activity(
        "job-1",
        {
            "sequence": 5,
            "storage_file_id": "file-3",
            "filename": "new.pdf",
            "status": "indexed",
            "embedded_delta": 1,
        },
    )
    assert store.read_progress("job-1")["embedded_delta"] == 2


@pytest.mark.unit
def test_read_progress_discards_unsafe_activity_values() -> None:
    redis_client = fakeredis.FakeRedis(decode_responses=True)
    store = RedisSyncJobStore(redis_client, 86_400)
    redis_client.set(
        "sync-job:job-1:progress",
        '{"provider":"dropbox","state":"STARTED","attempt":1,"phase":null,"upserted":0,"deleted":0,"unchanged":0,"failed":0,"cancellation_requested":false,"detail":null,"activity":[{"sequence":1,"status":"indexed","filename":"secret.pdf"},{"sequence":2,"status":"unknown"}]}',
    )

    stored = store.read_progress("job-1")

    assert stored is not None
    assert stored["activity"] == ()


@pytest.mark.unit
def test_publish_event_broadcasts_json_to_redis_channel() -> None:
    import json

    redis_client = fakeredis.FakeRedis(decode_responses=True)
    store = RedisSyncJobStore(redis_client, 86_400)
    pubsub = redis_client.pubsub()
    channel = RedisSyncJobStore.events_channel("job-test")
    pubsub.subscribe(channel)

    # Consume subscription confirmation
    msg = pubsub.get_message(timeout=1.0)
    assert msg is not None and msg["type"] == "subscribe"

    payload = {"type": "activity", "activity": {"sequence": 1, "status": "indexed"}}
    store.publish_event("job-test", payload)

    message = pubsub.get_message(timeout=1.0)
    assert message is not None
    assert message["channel"] == channel
    assert json.loads(message["data"]) == payload

