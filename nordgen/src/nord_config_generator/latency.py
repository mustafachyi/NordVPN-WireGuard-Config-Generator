"""TCP connect latency probing for NordVPN WireGuard endpoints.

Uses a non-privileged TCP connect to port 51820 (WireGuard UDP is not
reachable via TCP, but many Nord servers still answer the TCP handshake
on that port or reject it quickly enough to yield a useful RTT estimate).
Falls back gracefully when the port is filtered.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import replace
from typing import Sequence

from .models import Server

_WG_PORT = 51820
_DEFAULT_TIMEOUT = 2.0
_CONCURRENCY = 64


async def _probe_one(host: str, timeout: float) -> float | None:
    """Return RTT in milliseconds, or None on failure/timeout."""
    loop = asyncio.get_running_loop()
    start = time.perf_counter()
    try:
        fut = asyncio.open_connection(host, _WG_PORT)
        reader, writer = await asyncio.wait_for(fut, timeout=timeout)
        rtt_ms = (time.perf_counter() - start) * 1000.0
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return rtt_ms
    except (OSError, asyncio.TimeoutError, asyncio.CancelledError):
        return None


async def measure_latencies(
    servers: Sequence[Server],
    *,
    timeout: float = _DEFAULT_TIMEOUT,
    concurrency: int = _CONCURRENCY,
) -> list[Server]:
    """Return new Server instances with ``latency`` populated (ms).

    Servers that could not be reached keep ``latency=None`` and are sorted
    after successful probes.
    """
    if not servers:
        return []

    sem = asyncio.Semaphore(concurrency)
    results: list[float | None] = [None] * len(servers)

    async def _bounded(idx: int, host: str) -> None:
        async with sem:
            results[idx] = await _probe_one(host, timeout)

    await asyncio.gather(
        *(_bounded(i, s.station) for i, s in enumerate(servers)),
        return_exceptions=True,
    )

    updated: list[Server] = []
    for server, rtt in zip(servers, results):
        updated.append(replace(server, latency=rtt))
    return updated


def pick_lowest_latency(candidates: Sequence[Server]) -> Server:
    """Prefer the candidate with the lowest successful RTT; fall back to first."""
    reachable = [s for s in candidates if s.latency is not None]
    if not reachable:
        return candidates[0]
    return min(reachable, key=lambda s: s.latency)  # type: ignore[arg-type, return-value]
