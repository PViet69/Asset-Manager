from unittest.mock import ANY, Mock, patch

import pytest
from celery.exceptions import Retry

from backend.app.config import Settings
from backend.app.exceptions import QdrantStorageError
from backend.app.tasks.celery_app import create_celery_app
from backend.app.tasks.sync_tasks import sync_provider


@pytest.mark.unit
def test_celery_app_includes_provider_sync_task_module() -> None:
    application = create_celery_app(Settings())

    assert "backend.app.tasks.sync_tasks" in application.conf.include


@pytest.mark.unit
def test_sync_task_retries_classified_transient_qdrant_error() -> None:
    task = sync_provider
    task.retry = Mock(side_effect=Retry())
    store = Mock()
    store.is_cancellation_requested.return_value = False
    store.read_progress.return_value = None
    with (
        patch("backend.app.tasks.sync_tasks.build_job_store", return_value=store),
        patch("backend.app.tasks.sync_tasks.build_runtime_dependencies"),
        patch(
            "backend.app.tasks.sync_tasks.run_provider_sync",
            side_effect=QdrantStorageError("temporary unavailable"),
        ),
        pytest.raises(Retry),
    ):
        task.run("dropbox")

    task.retry.assert_called_once()


@pytest.mark.unit
def test_sync_task_marks_running_cancelled_job_revoked_and_releases_lock() -> None:
    store = Mock()
    store.is_cancellation_requested.return_value = True
    with patch("backend.app.tasks.sync_tasks.build_job_store", return_value=store):
        result = sync_provider.run("dropbox")

    assert result["state"] == "REVOKED"
    store.release_provider_job.assert_called_once_with("dropbox", ANY)


@pytest.mark.unit
def test_sync_task_preserves_embedded_delta_on_success() -> None:
    store = Mock()
    store.is_cancellation_requested.return_value = False
    store.read_progress.side_effect = [
        {"embedded_delta": 2, "activity": ()},
        {"embedded_delta": 4, "activity": ()},
        {"state": "SUCCESS"},
    ]
    with (
        patch("backend.app.tasks.sync_tasks.build_job_store", return_value=store),
        patch("backend.app.tasks.sync_tasks.build_runtime_dependencies"),
        patch(
            "backend.app.tasks.sync_tasks.run_provider_sync",
            return_value={"upserted": 2, "deleted": 0, "unchanged": 0, "failed": 0},
        ),
    ):
        result = sync_provider.run("dropbox")

    assert result["state"] == "SUCCESS"
    assert result["embedded_delta"] == 4
    started_call = store.write_progress.call_args_list[0]
    assert started_call.args[1]["state"] == "STARTED"
    assert started_call.args[1]["embedded_delta"] == 2
