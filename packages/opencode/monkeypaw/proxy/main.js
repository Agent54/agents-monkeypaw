const encoder = new TextEncoder()
let nextSessionId = 1

function log(event, value) {
  if (value === undefined) {
    console.log(`[proxy] ${event}`)
    return
  }
  console.log(`[proxy] ${event}`, value)
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

async function handlePermissionBrokerSession(socket) {
  const sessionId = nextSessionId++
  const writer = socket.writable.getWriter()

  try {
    for await (const line of readLines(socket.readable)) {
      let request
      try {
        request = JSON.parse(line)
      } catch (error) {
        log(`permission-broker session=${sessionId} parse error`, error?.stack ?? String(error))
        throw error
      }

      const response = { id: request.id, result: "allow" }
      console.log(
        `[permission-broker] session=${sessionId} request=${jsonLine(request)} response=${jsonLine(response)}`,
      )

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

function headerValue(headers, name) {
  return headers.get(name) ?? "-"
}

function logHttpExchange(kind, request, response, startedAt, extra = {}) {
  const url = new URL(request.url)
  const duration = Date.now() - startedAt
  console.log(
    `[${kind}] ${request.method} ${url.href} -> ${response.status} ${response.statusText || "-"} bytes=${headerValue(response.headers, "content-length")} type=${headerValue(response.headers, "content-type")} dur=${duration}ms extra=${compactJson(extra)}`,
  )
}

function logHttpFailure(kind, request, startedAt, error, extra = {}) {
  const duration = Date.now() - startedAt
  console.log(
    `[${kind}] ${request.method} ${request.url} !! ${clip(error?.message ?? String(error))} dur=${duration}ms extra=${compactJson(extra)}`,
  )
}

export const permissionBroker = {
  async fetch() {
    return new Response("permission-broker is a raw socket service; use connect().", { status: 404 })
  },

  async connect(socket) {
    await handlePermissionBrokerSession(socket)
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
  async fetch(request) {
    const startedAt = Date.now()
    if (request.method === "CONNECT") {
      console.log(`[egress-proxy] CONNECT ${request.url} -> 405 tunneling-disabled dur=0ms extra={}`)
      return new Response("tunneling is disabled; send absolute http:// or https:// requests to this workerd proxy.\n", {
        status: 405,
      })
    }

    const url = new URL(request.url)
    if (!["http:", "https:"].includes(url.protocol)) return new Response("unsupported proxy target\n", { status: 400 })

    try {
      const requestBody = ["GET", "HEAD"].includes(request.method) ? new Uint8Array() : new Uint8Array(await request.arrayBuffer())
      const upstream = await fetch(request.url, {
        method: request.method,
        headers: proxyHeaders(request.headers),
        body: requestBody.byteLength ? requestBody : undefined,
        redirect: "manual",
      })
      const responseBody = new Uint8Array(await upstream.arrayBuffer())
      const responseHeaders = proxyHeaders(upstream.headers)
      logHttpExchange("egress-proxy", request, upstream, startedAt, {
        request_bytes: requestBody.byteLength,
        response_bytes: responseBody.byteLength,
      })

      return new Response(responseBody, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      })
    } catch (error) {
      logHttpFailure("egress-proxy", request, startedAt, error)
      throw error
    }
  },
}

export const agent = {
  async fetch(request, env) {
    const startedAt = Date.now()

    try {
      const response = await env.AGENT.fetch(request)
      logHttpExchange("ingress-proxy", request, response, startedAt)
      return response
    } catch (error) {
      logHttpFailure("ingress-proxy", request, startedAt, error)
      throw error
    }
  },
}

export default {
  async fetch() {
    return new Response("proxy service is configured through named entrypoints", { status: 404 })
  },
}
