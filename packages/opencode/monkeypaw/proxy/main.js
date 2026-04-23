const encoder = new TextEncoder()
let nextSessionId = 1

function log(event, value) {
  if (value === undefined) {
    console.log(`[proxy] ${event}`)
    return
  }
  console.log(`[proxy] ${event}`, value)
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

function formatJson(value) {
  return JSON.stringify(stableValue(value), null, 2)
}

async function writeLine(writer, value) {
  await writer.write(encoder.encode(`${JSON.stringify(value)}\n`))
}

async function* readLines(readable, sessionId) {
  const reader = readable.pipeThrough(new TextDecoderStream()).getReader()
  let pending = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        log(`permission-broker session=${sessionId} readable done`)
        break
      }
      log(`permission-broker session=${sessionId} chunk bytes=${value.length}`)
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
  log(`permission-broker session=${sessionId} opened`)

  try {
    for await (const line of readLines(socket.readable, sessionId)) {
      log(`permission-broker session=${sessionId} line=${line}`)

      let request
      try {
        request = JSON.parse(line)
      } catch (error) {
        log(`permission-broker session=${sessionId} parse error`, error?.stack ?? String(error))
        throw error
      }

      const response = { id: request.id, result: "allow" }
      console.log("[permission-broker] request payload:\n" + formatJson(request))
      console.log("[permission-broker] response payload:\n" + formatJson(response))

      try {
        await writeLine(writer, response)
      } catch (error) {
        log(`permission-broker session=${sessionId} write error`, error?.stack ?? String(error))
        throw error
      }
    }

    log(`permission-broker session=${sessionId} completed`)
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
    log(`permission-broker session=${sessionId} closed`)
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

export const permissionBroker = {
  async fetch() {
    return new Response("permission-broker is a raw socket service; use connect().", { status: 404 })
  },

  async connect(socket) {
    log("permission-broker connect() invoked")
    await handlePermissionBrokerSession(socket)
  },
}

export const debugHttp = {
  async fetch(request) {
    const body = await readBody(request)
    const payload = {
      body,
      headers: normalizeHeaders(request.headers),
      method: request.method,
      pathname: new URL(request.url).pathname,
      timestamp: new Date().toISOString(),
      url: request.url,
    }

    console.log("[debug-http] request payload:\n" + formatJson(payload))

    return new Response(
      JSON.stringify(
        {
          ok: true,
          pong: body || "pong",
          request: payload,
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

export default {
  async fetch() {
    return new Response("proxy service is configured through named entrypoints", { status: 404 })
  },
}
