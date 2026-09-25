"""Configured Celery application for provider sync work."""

from celery import Celery

from backend.app.config import Settings


def create_celery_app(settings: Settings) -> Celery:
    """Create Celery app from validated runtime settings."""
    application = Celery(
        "asset_tracker",
        include=["backend.app.tasks.sync_tasks"],
    )
    application.conf.update(
        broker_url=settings.CELERY_BROKER_URL,
        result_backend=settings.CELERY_RESULT_BACKEND,
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        result_expires=settings.CELERY_RESULT_EXPIRES_SECONDS,
        worker_send_task_events=True,
        task_send_sent_event=True,
        task_acks_late=True,
        task_soft_time_limit=settings.CELERY_TASK_SOFT_TIME_LIMIT_SECONDS,
        task_time_limit=settings.CELERY_TASK_TIME_LIMIT_SECONDS,
    )
    return application


celery_app = create_celery_app(Settings())
