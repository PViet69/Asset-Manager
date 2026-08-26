"""Provider-scoped safe Server-Sent Events for manual syncs."""

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass

from backend.app.api.schemas.admin import (
    ProviderDashboardStatus,
    SyncActivityEvent,
    SyncTerminalEvent,
    SyncTraceItem,
)
from backend.app.storage.scheduler import StorageSyncScheduler, SyncTickResult

ProviderSnapshot = Callable[[str], Awaitable[ProviderDashboardStatus]]


@dataclass(frozen=True)
class ProviderSyncStream:
    """Own one provider sync SSE queue for one authenticated request."""

    provider: str
    scheduler: StorageSyncScheduler
    snapshot: ProviderSnapshot

    async def run(self) -> AsyncIterator[bytes]:
        """Emit safe, ordered activity frames and one terminal frame."""
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[SyncTraceItem] = asyncio.Queue()

        def observer(trace: SyncTraceItem) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, trace)

        runner = asyncio.create_task(self.scheduler.tick_once(observer))
        sequence = 0
        try:
            last_ping = loop.time()
            while not runner.done() or not queue.empty():
                try:
                    trace = await asyncio.wait_for(queue.get(), timeout=0.5)
                except TimeoutError:
                    if loop.time() - last_ping >= 10.0:
                        yield b": keep-alive\n\n"
                        last_ping = loop.time()
                    continue
                last_ping = loop.time()
                event = _activity_event(trace, sequence + 1)
                if event is None:
                    continue
                sequence += 1
                yield _frame(event.model_dump())

            result = await runner
            status = await self.snapshot(self.provider)
            sequence += 1
            yield _frame(_terminal_event(result, status, sequence).model_dump())
        finally:
            if hasattr(self.scheduler, "stop_sync"):
                self.scheduler.stop_sync()
            if not runner.done():
                runner.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await runner


def _activity_event(trace: SyncTraceItem, sequence: int) -> SyncActivityEvent | None:
    if trace.step == "file_download" and trace.status == "ok":
        return SyncActivityEvent(
            sequence=sequence,
            provider=trace.provider,
            filename=trace.filename,
            status="loading",
            detail="Loading file",
        )
    if trace.step == "file_ingestion" and trace.status == "ok":
        return SyncActivityEvent(
            sequence=sequence,
            provider=trace.provider,
            filename=trace.filename,
            status="done",
            detail="Indexed file",
        )
    if trace.step == "file_ingestion" and trace.status == "failed":
        return SyncActivityEvent(
            sequence=sequence,
            provider=trace.provider,
            filename=trace.filename,
            status="failed",
            detail="File processing failed",
        )
    if trace.step in {"provider_traversal", "qdrant_read", "qdrant_delete"}:
        return SyncActivityEvent(
            sequence=sequence,
            provider=trace.provider,
            filename=None,
            status="failed",
            detail="Sync processing failed",
        )
    return None


def _terminal_event(
    result: SyncTickResult, status: ProviderDashboardStatus, sequence: int
) -> SyncTerminalEvent:
    return SyncTerminalEvent(
        sequence=sequence,
        provider=result.provider,
        detected_count=status.detected_count,
        embedded_count=status.embedded_count,
        upserted=result.upserted,
        deleted=result.deleted,
        unchanged=result.unchanged,
        failed=result.failed,
    )


def _frame(event: dict[str, object]) -> bytes:
    return f"data: {json.dumps(event, separators=(',', ':'))}\n\n".encode("utf-8")
