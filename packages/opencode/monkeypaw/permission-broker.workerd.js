const encoder = new TextEncoder()

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

function summarize(request) {
  return [
    `[permission-broker] allow`,
    `permission=${String(request.permission)}`,
    `pid=${String(request.pid)}`,
    `id=${String(request.id)}`,
    `value=${JSON.stringify(request.value ?? null)}`,
  ].join(" ")
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

export async function handlePermissionBrokerSession(socket) {
  const writer = socket.writable.getWriter()

  try {
    for await (const line of readLines(socket.readable)) {
      const request = JSON.parse(line)
      const response = { id: request.id, result: "allow" }

      console.log(summarize(request))
      console.log("[permission-broker] request payload:\n" + formatJson(request))
      console.log("[permission-broker] response payload:\n" + formatJson(response))

      await writeLine(writer, response)
    }
  } finally {
    writer.releaseLock()
  }
}

export default {
  async fetch() {
    return new Response(
      "permission-broker is a raw socket service; use the tcp socket binding, not fetch().",
      { status: 404 },
    )
  },

  async connect(socket) {
    await handlePermissionBrokerSession(socket)
  },
}
