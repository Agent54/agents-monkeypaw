const encoder = new TextEncoder()
const events = []
const clients = new Set()

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Monkeypaw permissions</title>
    <script type="module" src="/permissions/ui.js"></script>
    <style>
      :root {
        color-scheme: dark;
        --bg: #000;
        --card: #080808;
        --ink: #f2f2f2;
        --muted: #8b8b8b;
        --line: #242424;
        --accent: #7dd3fc;
        --warn: #fbbf24;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background: var(--bg);
        color: var(--ink);
        font: 15px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }

      main {
        width: min(960px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 44px 0;
      }

      header {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 18px;
      }

      h1 {
        margin: 0 0 8px;
        font-size: clamp(28px, 5vw, 52px);
        line-height: 0.95;
        letter-spacing: -0.06em;
      }

      p {
        margin: 0;
        color: var(--muted);
      }

      #status {
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--card);
        color: var(--muted);
        padding: 8px 12px;
        white-space: nowrap;
      }

      #status[data-connected="true"] {
        color: var(--accent);
      }

      #log {
        display: grid;
        gap: 12px;
      }

      .empty,
      .event {
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--card);
        padding: 16px;
      }

      .event {
        animation: rise 180ms ease-out;
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 14px;
        margin-bottom: 10px;
        color: var(--muted);
        font-size: 12px;
      }

      .pill {
        color: var(--warn);
      }

      pre {
        display: none;
        border-top: 1px solid var(--line);
        margin: 12px 0 0;
        padding-top: 12px;
        color: var(--ink);
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .event[open] pre {
        display: block;
      }

      summary {
        cursor: pointer;
        list-style: none;
      }

      summary::-webkit-details-marker {
        display: none;
      }

      .value {
        color: var(--ink);
        white-space: pre-wrap;
      }

      @keyframes rise {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <section>
          <h1>Monkeypaw permissions</h1>
          <p>Live permission requests observed by the proxy.</p>
        </section>
        <div id="status">connecting</div>
      </header>
      <section id="log">
        <article class="empty">Waiting for permission requests...</article>
      </section>
    </main>
  </body>
</html>`

const script = `const status = document.querySelector("#status")
const log = document.querySelector("#log")

function render(event) {
  document.querySelector(".empty")?.remove()
  const item = document.createElement("details")
  item.className = "event"
  item.innerHTML = \`<summary>
    <div class="meta">
      <span class="pill">\${escapeHtml(event.permission ?? "permission")}</span>
      <span>\${escapeHtml(event.id ?? "-")}</span>
      <span>\${escapeHtml(event.datetime ?? event.receivedAt ?? "-")}</span>
    </div>
    <div class="value">\${escapeHtml(event.summary)}</div>
  </summary>
  <pre>\${escapeHtml(JSON.stringify(event.request, null, 2))}</pre>\`
  log.prepend(item)
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character])
}

function connect() {
  const source = new EventSource("/permissions/events")

  source.addEventListener("open", () => {
    status.textContent = "connected"
    status.dataset.connected = "true"
  })
  source.addEventListener("permission", (message) => render(JSON.parse(message.data)))
  source.addEventListener("error", () => {
    status.textContent = "reconnecting"
    status.dataset.connected = "false"
  })
}

connect()
`

function sse(event, data) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function headers(contentType) {
  return {
    "cache-control": "no-store",
    "content-type": contentType,
  }
}

function permissionEvent(request) {
  return {
    datetime: request.datetime,
    id: request.id,
    permission: request.permission,
    receivedAt: new Date().toISOString(),
    request,
    summary: permissionSummary(request),
  }
}

function permissionSummary(request) {
  if (typeof request.value === "string") return request.value
  if (request.value === undefined) return "-"
  return JSON.stringify(request.value, null, 2)
}

export function recordPermissionRequest(request) {
  const event = permissionEvent(request)
  events.push(event)
  if (events.length > 100) events.shift()
  clients.forEach((client) => {
    if (!client.active) return
    client.controller.enqueue(sse("permission", event))
  })
}

function eventStream() {
  let client
  const stream = new ReadableStream({
    start(controller) {
      client = { active: true, controller }
      clients.add(client)
      controller.enqueue(sse("ready", { ok: true }))
      events.forEach((event) => controller.enqueue(sse("permission", event)))
      client.heartbeat = setInterval(() => {
        if (!client.active) return
        controller.enqueue(encoder.encode(": ping\n\n"))
      }, 15000)
    },

    cancel() {
      if (!client) return
      client.active = false
      clearInterval(client.heartbeat)
      clients.delete(client)
    },
  })

  return new Response(stream, {
    headers: {
      "cache-control": "no-store",
      "connection": "keep-alive",
      "content-type": "text/event-stream",
    },
  })
}

export function servePermissionUi(request) {
  const url = new URL(request.url)
  if (request.method !== "GET") return
  if (url.pathname === "/permissions" || url.pathname === "/permissions/") {
    return new Response(html, { headers: headers("text/html; charset=utf-8") })
  }
  if (url.pathname === "/permissions/ui.js") {
    return new Response(script, { headers: headers("text/javascript; charset=utf-8") })
  }
  if (url.pathname === "/permissions/events") return eventStream()
}
