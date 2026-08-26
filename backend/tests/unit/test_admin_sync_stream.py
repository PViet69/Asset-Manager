"""Unit tests for provider-scoped admin sync SSE streams."""

import asyncio
import json
from collections.abc import Callable
from dataclasses import dataclass

import pytest

from backend.app.admin_dashboard.sync_stream import ProviderSyncStream
from backend.app.api.schemas.admin import ProviderDashboardStatus, SyncTraceItem
from backend.app.storage.scheduler import SyncTickResult


@dataclass
class _Scheduler:
    provider: str
    traces: tuple[SyncTraceItem, ...]

    async def tick_once(
        self, observer: Callable[[SyncTraceItem], None] | None = None
    ) -> SyncTickResult:
        for trace in self.traces:
            if observer is not None:
                observer(trace)
            await asyncio.sleep(0)
        return SyncTickResult(self.provider, 1, 0, 0, 0, self.traces)


def _trace(step: str, status: str, filename: str | None) -> SyncTraceItem:
    return SyncTraceItem(
        timestamp="2026-08-26T00:00:00+00:00",
        provider="dropbox",
        step=step,
        status=status,
        detail="internal failure" if status == "failed" else "completed",
        filename=filename,
    )


async def _snapshot(provider: str) -> ProviderDashboardStatus:
    return ProviderDashboardStatus(
        provider=provider,
        display_name="Dropbox",
        enabled=True,
        health="ok",
        detected_count=3,
        embedded_count=2,
    )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_stream_emits_ordered_safe_events_then_terminal() -> None:
    scheduler = _Scheduler(
        "dropbox",
        (
            _trace("file_download", "ok", "asset.png"),
            _trace("file_ingestion", "ok", "asset.png"),
        ),
    )

    frames = [
        frame
        async for frame in ProviderSyncStream("dropbox", scheduler, _snapshot).run()
    ]
    events = [
        json.loads(frame.removeprefix(b"data: ").removesuffix(b"\n\n"))
        for frame in frames
    ]

    assert [event["status"] for event in events[:-1]] == ["loading", "done"]
    assert events[-1]["terminal"] is True
    assert all(frame.endswith(b"\n\n") for frame in frames)
    assert "internal failure" not in json.dumps(events)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_two_provider_streams_keep_events_isolated() -> None:
    drive = ProviderSyncStream(
        "google_drive", _Scheduler("google_drive", ()), _snapshot
    )
    dropbox = ProviderSyncStream("dropbox", _Scheduler("dropbox", ()), _snapshot)

    drive_frames, dropbox_frames = await asyncio.gather(
        _collect(drive), _collect(dropbox)
    )

    assert all(b'"provider":"google_drive"' in frame for frame in drive_frames)
    assert all(b'"provider":"dropbox"' in frame for frame in dropbox_frames)


async def _collect(stream: ProviderSyncStream) -> list[bytes]:
    return [frame async for frame in stream.run()]
