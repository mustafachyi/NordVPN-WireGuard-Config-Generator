import { afterEach, expect, test } from 'bun:test'
import { api } from '../src/services/apiService.js'

const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout
const originalClearTimeout = globalThis.clearTimeout

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
  globalThis.clearTimeout = originalClearTimeout
})

function createRequest(contentType = 'application/json') {
  let finishBody
  let timeout
  let timeoutCleared = false
  let requestSignal

  globalThis.setTimeout = (callback, delay) => {
    expect(delay).toBe(20_000)
    timeout = callback
    return 1
  }
  globalThis.clearTimeout = () => { timeoutCleared = true }
  globalThis.fetch = async (_input, options) => {
    requestSignal = options.signal
    return new Response(new ReadableStream({
      start(controller) {
        requestSignal.addEventListener('abort', () => controller.error(requestSignal.reason), { once: true })
        finishBody = text => {
          controller.enqueue(new TextEncoder().encode(text))
          controller.close()
        }
      },
    }), { headers: { 'Content-Type': contentType } })
  }

  return {
    finish: text => finishBody(text),
    expire: () => timeout(),
    get cleared() { return timeoutCleared },
    get signal() { return requestSignal },
  }
}

for (const [contentType, text, expected] of [
  ['application/json', '["catalog"]', ['catalog']],
  ['text/plain', 'catalog', 'catalog'],
]) {
  test(`timeout remains active through ${contentType} body reading`, async () => {
    const request = createRequest(contentType)
    const result = api.getServers()
    await Promise.resolve()
    await Promise.resolve()
    expect(request.cleared).toBe(false)
    request.finish(text)
    expect(await result).toEqual(expected)
    expect(request.cleared).toBe(true)
  })
}

test('stalled body reports a request timeout', async () => {
  const request = createRequest()
  const result = api.getServers()
  await Promise.resolve()
  await Promise.resolve()
  expect(request.cleared).toBe(false)
  request.expire()
  await expect(result).rejects.toThrow('Request timeout')
  expect(request.cleared).toBe(true)
})

test('external cancellation remains active during body reading', async () => {
  const request = createRequest()
  const controller = new AbortController()
  const result = api.genKey('0'.repeat(64), controller.signal)
  await Promise.resolve()
  await Promise.resolve()
  controller.abort()
  await expect(result).rejects.toThrow('Request cancelled')
  expect(request.signal.aborted).toBe(true)
  expect(request.cleared).toBe(true)
})

test('successful requests remove the external cancellation listener', async () => {
  const request = createRequest()
  const controller = new AbortController()
  const result = api.genKey('0'.repeat(64), controller.signal)
  await Promise.resolve()
  request.finish('{"key":"test"}')
  expect(await result).toEqual({ key: 'test' })
  controller.abort()
  expect(request.signal.aborted).toBe(false)
  expect(request.cleared).toBe(true)
})

test('malformed response bodies propagate errors and release the timer', async () => {
  const request = createRequest()
  const result = api.getServers()
  await Promise.resolve()
  request.finish('invalid')
  await expect(result).rejects.toBeInstanceOf(SyntaxError)
  expect(request.cleared).toBe(true)
})
