import { connect } from "cloudflare:sockets"
import { EventBus, decidePermission, publishEvent, recordProxyEvent, servePermissionUi } from "./ui.js"

export { EventBus }

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const headDelimiter = new Uint8Array([13, 10, 13, 10])
let nextSessionId = 1

function log(event, value) {
  if (value === undefined) {
    console.log(`[proxy] ${event}`)
    return
  }
  console.log(`[proxy] ${event}`, value)
}

function publishUiEvent(env, type, event, ctx) {
  const promise = publishEvent(env, type, event).catch((error) => {
    log("ui event publish failed", error?.stack ?? String(error))
  })
  if (ctx?.waitUntil) {
    ctx.waitUntil(promise)
    return
  }
  return promise
}

function clip(value, max = 240) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableValue(value[key])
        return result
      }, {})
  }
  return value
}

function compactJson(value) {
  return clip(JSON.stringify(stableValue(value)))
}

function jsonLine(value) {
  return JSON.stringify(stableValue(value))
}

function appIdentity(request) {
  if (!["hello", "identity"].includes(request.type)) return
  if (typeof request.app !== "string") return
  const app = request.app.trim()
  if (!app) return
  return clip(app, 80)
}

function concatBytes(left, right) {
  if (!left.byteLength) return right
  if (!right.byteLength) return left
  const result = new Uint8Array(left.byteLength + right.byteLength)
  result.set(left)
  result.set(right, left.byteLength)
  return result
}

function findBytes(haystack, needle) {
  if (haystack.byteLength < needle.byteLength) return -1

  for (let index = 0; index <= haystack.byteLength - needle.byteLength; index++) {
    let matches = true
    for (let offset = 0; offset < needle.byteLength; offset++) {
      if (haystack[index + offset] === needle[offset]) continue
      matches = false
      break
    }
    if (matches) return index
  }

  return -1
}

async function writeLine(writer, value) {
  await writer.write(encoder.encode(`${JSON.stringify(value)}\n`))
}

async function* readLines(readable) {
  const reader = readable.pipeThrough(new TextDecoderStream()).getReader()
  let pending = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      pending += value
      const lines = pending.split("\n")
      pending = lines.pop() ?? ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) yield trimmed
      }
    }
  } finally {
    reader.releaseLock()
  }

  const trimmed = pending.trim()
  if (trimmed) yield trimmed
}

async function handlePermissionBrokerSession(socket, env) {
  const sessionId = nextSessionId++
  const writer = socket.writable.getWriter()
  let app = "monkeypaw"

  try {
    for await (const line of readLines(socket.readable)) {
      let request
      try {
        request = JSON.parse(line)
      } catch (error) {
        log(`permission-broker session=${sessionId} parse error`, error?.stack ?? String(error))
        throw error
      }

      const identity = appIdentity(request)
      if (identity) {
        app = identity
        log(`permission-broker session=${sessionId} app=${app}`)
        continue
      }

      request.app = request.app ?? app
      const waiting = setTimeout(() => {
        log(`permission-broker session=${sessionId} waiting id=${request.id ?? "-"} app=${request.app} permission=${request.permission ?? "-"} value=${clip(String(request.value ?? "-"))}`)
      }, 5000)
      const response = await decidePermission(env, request)
        .catch((error) => {
          log("permission decision failed", error?.stack ?? String(error))
          return { id: request.id, result: "allow" }
        })
        .finally(() => clearTimeout(waiting))

      try {
        await writeLine(writer, response)
      } catch (error) {
        log(`permission-broker session=${sessionId} write error`, error?.stack ?? String(error))
        throw error
      }
    }
  } catch (error) {
    log(`permission-broker session=${sessionId} failed`, error?.stack ?? String(error))
    throw error
  } finally {
    writer.releaseLock()
    try {
      socket.close()
    } catch (error) {
      log(`permission-broker session=${sessionId} close error`, error?.stack ?? String(error))
    }
  }
}

async function readBody(request) {
  try {
    return await request.text()
  } catch (error) {
    return `[body-read-error] ${error?.message ?? String(error)}`
  }
}

function normalizeHeaders(headers) {
  return Object.fromEntries([...headers.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

function proxyHeaders(headers) {
  const result = new Headers(headers)
  const hopByHop = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]
  hopByHop.map((name) => result.delete(name))
  return result
}

function isWebSocketUpgrade(request) {
  return request.headers.get("upgrade")?.toLowerCase() === "websocket"
}

function headerValue(headers, name) {
  return headers.get(name) ?? "-"
}

function logHttpExchange(kind, request, response, startedAt, extra = {}) {
  const url = new URL(request.url)
  const duration = Date.now() - startedAt
  const details = {
    bytes: headerValue(response.headers, "content-length"),
    contentType: headerValue(response.headers, "content-type"),
    duration,
    method: request.method,
    status: response.status,
    statusText: response.statusText || "-",
    url: url.href,
    ...extra,
  }
  console.log(
    `[${kind}] ${details.method} ${details.url} -> ${details.status} ${details.statusText} bytes=${details.bytes} type=${details.contentType} dur=${duration}ms extra=${compactJson(extra)}`,
  )
  return details
}

function logProxyEvent(kind, message, startedAt, extra = {}) {
  const duration = Date.now() - startedAt
  console.log(`[${kind}] ${message} dur=${duration}ms extra=${compactJson(extra)}`)
}

function logHttpFailure(kind, message, startedAt, error, extra = {}) {
  const duration = Date.now() - startedAt
  console.log(
    `[${kind}] ${message} !! ${clip(error?.message ?? String(error))} dur=${duration}ms extra=${compactJson(extra)}`,
  )
}

async function readRequestHead(socket) {
  const reader = socket.readable.getReader()
  let pending = new Uint8Array()

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      reader.releaseLock()
      throw new Error("socket closed before proxy headers completed")
    }

    pending = concatBytes(pending, value)
    const index = findBytes(pending, headDelimiter)
    if (index === -1) {
      if (pending.byteLength <= 64 * 1024) continue
      reader.releaseLock()
      throw new Error("proxy headers exceeded 64 KiB")
    }

    return {
      head: pending.slice(0, index + headDelimiter.byteLength),
      reader,
      rest: pending.slice(index + headDelimiter.byteLength),
    }
  }
}

function parseRequestHead(head) {
  const lines = decoder.decode(head).split("\r\n")
  const requestLine = lines.shift()
  if (!requestLine) throw new Error("missing request line")

  const [method, target, version] = requestLine.split(" ")
  if (!method || !target || !version) throw new Error(`invalid request line: ${requestLine}`)

  const headers = new Headers()
  for (const line of lines) {
    if (!line) continue
    const index = line.indexOf(":")
    if (index === -1) continue
    headers.append(line.slice(0, index).trim(), line.slice(index + 1).trim())
  }

  return { headers, method, target, version }
}

function streamWithPrefix(reader, prefix) {
  let pending = prefix

  return new ReadableStream({
    async pull(controller) {
      if (pending.byteLength) {
        controller.enqueue(pending)
        pending = new Uint8Array()
        return
      }

      const { done, value } = await reader.read()
      if (done) {
        reader.releaseLock()
        controller.close()
        return
      }

      controller.enqueue(value)
    },

    async cancel(reason) {
      await reader.cancel(reason)
      reader.releaseLock()
    },
  })
}

function parseAuthority(authority, defaultPort) {
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]")
    if (end === -1) throw new Error(`invalid authority: ${authority}`)
    const host = authority.slice(1, end)
    const port = authority.slice(end + 1).replace(/^:/, "")
    return { hostname: host, port: Number(port || defaultPort) }
  }

  const split = authority.split(":")
  if (split.length === 1) return { hostname: authority, port: defaultPort }
  if (split.length === 2) return { hostname: split[0], port: Number(split[1] || defaultPort) }
  throw new Error(`invalid authority: ${authority}`)
}

function requestUrl(target, headers) {
  if (target.startsWith("http://") || target.startsWith("https://")) return new URL(target)
  const host = headers.get("host")
  if (!host) throw new Error(`host header missing for target ${target}`)
  return new URL(target, `http://${host}`)
}

async function writeResponse(socket, response) {
  const writer = socket.writable.getWriter()
  const body = response.body ? new Uint8Array(await response.arrayBuffer()) : new Uint8Array()
  const headers = proxyHeaders(response.headers)
  headers.delete("transfer-encoding")
  headers.set("connection", "close")
  headers.set("content-length", String(body.byteLength))

  const statusLine = `HTTP/1.1 ${response.status} ${response.statusText || "OK"}\r\n`
  const headerBlock = [...headers.entries()].map(([name, value]) => `${name}: ${value}\r\n`).join("")

  try {
    await writer.write(encoder.encode(`${statusLine}${headerBlock}\r\n`))
    if (body.byteLength) await writer.write(body)
  } finally {
    writer.releaseLock()
  }
}

async function writeSimpleResponse(socket, status, statusText, body) {
  const writer = socket.writable.getWriter()
  const payload = encoder.encode(body)

  try {
    await writer.write(
      encoder.encode(
        `HTTP/1.1 ${status} ${statusText}\r\ncontent-length: ${payload.byteLength}\r\ncontent-type: text/plain; charset=utf-8\r\nconnection: close\r\n\r\n`,
      ),
    )
    await writer.write(payload)
  } finally {
    writer.releaseLock()
  }
}

async function handleConnectTunnel(socket, request, reader, rest, startedAt, env) {
  const authority = parseAuthority(request.target, 443)
  const upstream = connect(authority)

  try {
    await upstream.opened
  } catch (error) {
    logHttpFailure("egress-proxy", `CONNECT ${request.target}`, startedAt, error)
    publishUiEvent(env, "proxy", recordProxyEvent({
      direction: "egress",
      duration: Date.now() - startedAt,
      error: clip(error?.message ?? String(error)),
      method: "CONNECT",
      status: 502,
      statusText: "Bad Gateway",
      target: request.target,
      version: request.version,
    }))
    try {
      upstream.close()
    } catch {}
    await writeSimpleResponse(socket, 502, "Bad Gateway", "connect tunnel failed\n")
    return
  }

  const writer = socket.writable.getWriter()

  try {
    await writer.write(encoder.encode("HTTP/1.1 200 Connection Established\r\n\r\n"))
  } finally {
    writer.releaseLock()
  }

  logProxyEvent("egress-proxy", `CONNECT ${request.target} -> 200 tunnel`, startedAt)
  publishUiEvent(env, "proxy", recordProxyEvent({
    direction: "egress",
    duration: Date.now() - startedAt,
    method: "CONNECT",
    status: 200,
    statusText: "Connection Established",
    target: request.target,
    version: request.version,
  }))

  const clientToUpstream = streamWithPrefix(reader, rest).pipeTo(upstream.writable)
  const upstreamToClient = upstream.readable.pipeTo(socket.writable)
  await Promise.allSettled([clientToUpstream, upstreamToClient])

  try {
    upstream.close()
  } catch {}

  try {
    socket.close()
  } catch {}
}

async function handleForwardProxy(socket, request, reader, rest, startedAt, env) {
  const url = requestUrl(request.target, request.headers)
  const headers = proxyHeaders(request.headers)
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : streamWithPrefix(reader, rest)

  const upstream = await fetch(url, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
  })

  logHttpExchange(
    "egress-proxy",
    {
      method: request.method,
      url: url.toString(),
    },
    upstream,
    startedAt,
    {
      version: request.version,
    },
  )
  publishUiEvent(env, "proxy", recordProxyEvent({
    bytes: headerValue(upstream.headers, "content-length"),
    contentType: headerValue(upstream.headers, "content-type"),
    direction: "egress",
    duration: Date.now() - startedAt,
    method: request.method,
    status: upstream.status,
    statusText: upstream.statusText || "-",
    url: url.toString(),
    version: request.version,
  }))

  await writeResponse(socket, upstream)
}

async function handleProxySocket(socket, env) {
  const startedAt = Date.now()

  try {
    const parsed = await readRequestHead(socket)
    const request = parseRequestHead(parsed.head)

    if (request.method === "CONNECT") {
      await handleConnectTunnel(socket, request, parsed.reader, parsed.rest, startedAt, env)
      return
    }

    await handleForwardProxy(socket, request, parsed.reader, parsed.rest, startedAt, env)
    try {
      socket.close()
    } catch {}
  } catch (error) {
    logHttpFailure("egress-proxy", "proxy socket", startedAt, error)
    try {
      await writeSimpleResponse(socket, 502, "Bad Gateway", "proxy failure\n")
    } catch {}
    try {
      socket.close()
    } catch {}
  }
}

async function handleMergedSocket(socket, env) {
  const reader = socket.readable.getReader()

  try {
    const initial = await reader.read()
    if (initial.done) {
      reader.releaseLock()
      try {
        socket.close()
      } catch {}
      return
    }

    const first = initial.value.find((byte) => byte !== 9 && byte !== 10 && byte !== 13 && byte !== 32)
    const wrapped = {
      readable: streamWithPrefix(reader, initial.value),
      writable: socket.writable,
      close() {
        socket.close()
      },
    }

    if (first === 123) {
      await handlePermissionBrokerSession(wrapped, env)
      return
    }

    await handleProxySocket(wrapped, env)
  } catch (error) {
    try {
      reader.releaseLock()
    } catch {}
    throw error
  }
}

export const permissionBroker = {
  async fetch() {
    return new Response("permission-broker is a raw socket service; use connect().", { status: 404 })
  },

  async connect(socket, env) {
    await handlePermissionBrokerSession(socket, env)
  },
}

export const debugHttp = {
  async fetch(request) {
    const body = await readBody(request)
    console.log(
      `[debug-http] ${request.method} ${request.url} headers=${compactJson(normalizeHeaders(request.headers))} body=${compactJson(body)}`,
    )

    return new Response(
      JSON.stringify(
        {
          ok: true,
          pong: body || "pong",
          request: {
            body,
            headers: normalizeHeaders(request.headers),
            method: request.method,
            pathname: new URL(request.url).pathname,
            timestamp: new Date().toISOString(),
            url: request.url,
          },
        },
        null,
        2,
      ) + "\n",
      {
        headers: {
          "content-type": "application/json",
        },
      },
    )
  },
}

export const proxy = {
  async fetch(request, env, ctx) {
    return agent.fetch(request, env, ctx)
  },

  async connect(socket, env) {
    await handleMergedSocket(socket, env)
  },
}

export const permissionUi = {
  async fetch(request, env) {
    const ui = servePermissionUi(request, env)
    if (ui) return ui
    return new Response("permission UI is available under /permissions\n", { status: 404 })
  },
}

export const agent = {
  async fetch(request, env, ctx) {
    const startedAt = Date.now()
    const url = new URL(request.url)
    const upstreamUrl = new URL(url.pathname + url.search, "http://agent:4097")

    try {
      if (isWebSocketUpgrade(request)) {
        const response = await fetch(new Request(upstreamUrl, request))
        publishUiEvent(env, "proxy", recordProxyEvent({
          ...logHttpExchange("ingress-proxy", request, response, startedAt, { direction: "ingress", upgrade: "websocket" }),
        }), ctx)
        return response
      }

      const headers = proxyHeaders(request.headers)
      const body =
        request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer()
      const response = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body,
        redirect: "manual",
      })
      publishUiEvent(env, "proxy", recordProxyEvent({
        ...logHttpExchange("ingress-proxy", request, response, startedAt, { direction: "ingress" }),
      }), ctx)
      return response
    } catch (error) {
      logHttpFailure("ingress-proxy", `${request.method} ${request.url}`, startedAt, error)
      publishUiEvent(env, "proxy", recordProxyEvent({
        direction: "ingress",
        duration: Date.now() - startedAt,
        error: clip(error?.message ?? String(error)),
        method: request.method,
        status: 502,
        statusText: "Proxy Error",
        url: request.url,
      }), ctx)
      throw error
    }
  },
}

export default {
  async fetch() {
    return new Response("proxy service is configured through named entrypoints", { status: 404 })
  },
}
