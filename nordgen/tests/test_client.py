import asyncio
import base64
import json
import socket
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

import aiohttp
import pytest
from aiohttp import web

from nord_config_generator.client import (
    CREDENTIALS_RESPONSE_LIMIT,
    USER_AGENT,
    Endpoints,
    NordClient,
    NordClientError,
    UnauthorizedError,
)


@asynccontextmanager
async def serve(
    handler: Callable[[web.Request], web.StreamResponse],
) -> AsyncIterator[str]:
    application = web.Application()
    application.router.add_route("*", "/{tail:.*}", handler)

    runner = web.AppRunner(application)
    await runner.setup()

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen()

    port = listener.getsockname()[1]
    site = web.SockSite(runner, listener)
    await site.start()

    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        await runner.cleanup()


def endpoints(root: str) -> Endpoints:
    return Endpoints(
        credentials=f"{root}/credentials",
        geo=f"{root}/geo",
        servers=f"{root}/servers",
    )


@pytest.mark.asyncio
async def test_context_manager_configures_and_closes_session() -> None:
    client = NordClient()

    async with client:
        session = client._session

        assert session is not None
        assert session.timeout.total == 25
        assert session.connector is not None
        assert session.connector.limit == 10
        assert session.connector.limit_per_host == 10

    assert session.closed
    assert client._session is None


@pytest.mark.asyncio
async def test_injected_session_is_not_closed() -> None:
    async with aiohttp.ClientSession() as session:
        client = NordClient(session=session)

        async with client:
            assert client._session is session

        assert not session.closed


@pytest.mark.asyncio
async def test_get_key_sends_headers_and_validates_response(key_factory) -> None:
    key = key_factory(7)

    async def handler(request: web.Request) -> web.StreamResponse:
        assert request.path == "/credentials"
        assert request.headers["Accept"] == "application/json"
        assert request.headers["User-Agent"] == USER_AGENT

        expected = base64.b64encode(("token:" + "a" * 64).encode()).decode()
        assert request.headers["Authorization"] == f"Basic {expected}"

        return web.json_response({"nordlynx_private_key": f"  {key}  "})

    async with serve(handler) as root:
        async with NordClient(endpoints=endpoints(root)) as client:
            assert await client.get_key("a" * 64) == key


@pytest.mark.asyncio
async def test_get_key_rejects_unauthorized_and_invalid_payloads(
    key_factory,
) -> None:
    responses = [
        web.Response(status=401),
        web.json_response([]),
        web.json_response({}),
        web.json_response({"nordlynx_private_key": "invalid"}),
    ]

    async def handler(request: web.Request) -> web.StreamResponse:
        return responses.pop(0)

    async with serve(handler) as root:
        async with NordClient(endpoints=endpoints(root)) as client:
            with pytest.raises(UnauthorizedError):
                await client.get_key("a" * 64)

            with pytest.raises(
                NordClientError,
                match="not a JSON object",
            ):
                await client.get_key("a" * 64)

            with pytest.raises(
                NordClientError,
                match="did not contain",
            ):
                await client.get_key("a" * 64)

            with pytest.raises(
                NordClientError,
                match="invalid private key",
            ):
                await client.get_key("a" * 64)


@pytest.mark.asyncio
async def test_get_geo_accepts_valid_and_rejects_invalid_coordinates() -> None:
    payloads: list[object] = [
        {"latitude": 36.75, "longitude": 3.06},
        [],
        {},
        {"latitude": True, "longitude": 0},
        {"latitude": 91, "longitude": 0},
        {"latitude": float("inf"), "longitude": 0},
    ]

    async def handler(request: web.Request) -> web.StreamResponse:
        return web.Response(
            body=json.dumps(payloads.pop(0)),
            content_type="application/json",
        )

    async with serve(handler) as root:
        async with NordClient(endpoints=endpoints(root)) as client:
            coordinates = await client.get_geo()

            assert coordinates.latitude == 36.75
            assert coordinates.longitude == 3.06

            for _ in range(5):
                with pytest.raises(
                    NordClientError,
                    match=r"invalid coordinates|JSON object",
                ):
                    await client.get_geo()


@pytest.mark.asyncio
async def test_get_servers_accepts_nonempty_array_and_rejects_other_payloads() -> None:
    payloads: list[object] = [
        [{"hostname": "us1.example.com"}],
        [],
        {},
    ]

    async def handler(request: web.Request) -> web.StreamResponse:
        return web.json_response(payloads.pop(0))

    async with serve(handler) as root:
        async with NordClient(endpoints=endpoints(root)) as client:
            assert await client.get_servers() == [{"hostname": "us1.example.com"}]

            with pytest.raises(NordClientError, match="empty"):
                await client.get_servers()

            with pytest.raises(
                NordClientError,
                match="not a JSON array",
            ):
                await client.get_servers()


@pytest.mark.asyncio
async def test_get_json_reads_fragmented_response_to_eof() -> None:
    payload = [
        {
            "hostname": "us1.example.com",
            "description": "x" * 32768,
        }
    ]
    encoded = json.dumps(payload).encode()
    split = len(encoded) // 2

    async def handler(request: web.Request) -> web.StreamResponse:
        response = web.StreamResponse(
            status=200,
            headers={"Content-Type": "application/json"},
        )
        response.enable_chunked_encoding()

        await response.prepare(request)
        await response.write(encoded[:split])
        await asyncio.sleep(0.05)
        await response.write(encoded[split:])
        await response.write_eof()

        return response

    async with serve(handler) as root:
        async with NordClient(endpoints=endpoints(root)) as client:
            assert await client.get_servers() == payload


@pytest.mark.asyncio
async def test_get_json_rejects_protocol_and_body_failures() -> None:
    responses = [
        web.Response(status=502),
        web.Response(body=b""),
        web.Response(body=b"{"),
        web.Response(body=b"{} {}"),
        web.Response(body=b"x" * 65),
        web.Response(
            body=b"{}",
            headers={"Content-Length": str(CREDENTIALS_RESPONSE_LIMIT + 1)},
        ),
    ]

    async def handler(request: web.Request) -> web.StreamResponse:
        return responses.pop(0)

    async with serve(handler) as root:
        async with NordClient(endpoints=endpoints(root)) as client:
            for limit, pattern in [
                (64, "status"),
                (64, "empty"),
                (64, "decode"),
                (64, "decode"),
                (64, "exceeded"),
                (CREDENTIALS_RESPONSE_LIMIT, "exceeded"),
            ]:
                with pytest.raises(
                    NordClientError,
                    match=pattern,
                ):
                    await client._get_json(
                        f"{root}/value",
                        None,
                        limit,
                    )


@pytest.mark.asyncio
async def test_get_json_requires_context_and_wraps_transport_failure() -> None:
    client = NordClient()

    with pytest.raises(
        RuntimeError,
        match="async context manager",
    ):
        await client._get_json(
            "https://example.com",
            None,
            64,
        )

    timeout = aiohttp.ClientTimeout(total=0.01)

    async with aiohttp.ClientSession(timeout=timeout) as session:
        client = NordClient(session=session)

        with pytest.raises(
            NordClientError,
            match="perform request",
        ):
            await client._get_json(
                "http://127.0.0.1:1",
                None,
                64,
            )


@pytest.mark.asyncio
async def test_get_json_honors_cancellation() -> None:
    started = asyncio.Event()
    release = asyncio.Event()

    async def handler(request: web.Request) -> web.StreamResponse:
        started.set()
        await release.wait()
        return web.json_response({})

    async with serve(handler) as root:
        async with NordClient(endpoints=endpoints(root)) as client:
            task = asyncio.create_task(
                client._get_json(
                    f"{root}/slow",
                    None,
                    64,
                )
            )

            await started.wait()
            task.cancel()

            with pytest.raises(asyncio.CancelledError):
                await task

            release.set()
