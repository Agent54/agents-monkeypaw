import { DurableObject } from "cloudflare:workers"

const encoder = new TextEncoder()
const maxClients = 4
const streamTtl = 5 * 60 * 1000

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
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        align-items: end;
        justify-content: end;
        gap: 24px;
        margin-bottom: 18px;
        background: var(--bg);
        padding: 12px 0;
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

      .actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      button {
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--card);
        color: var(--ink);
        cursor: pointer;
        font: inherit;
        padding: 8px 12px;
      }

      button:hover {
        border-color: var(--muted);
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
        max-width: 100%;
        min-width: 0;
        overflow: hidden;
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

      .event[data-kind="proxy"] .pill {
        color: var(--accent);
      }

      pre {
        display: none;
        border-top: 1px solid var(--line);
        margin: 12px 0 0;
        padding-top: 12px;
        color: var(--ink);
        overflow-x: auto;
        white-space: pre;
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
        overflow-x: auto;
        white-space: pre;
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
        <div class="actions">
          <button id="clear" type="button">clear</button>
          <div id="status">connecting</div>
        </div>
      </header>
      <section id="log">
        <article class="empty">Waiting for permission or proxy events...</article>
      </section>
    </main>
  </body>
</html>`

const script = `const status = document.querySelector("#status")
const log = document.querySelector("#log")
const clear = document.querySelector("#clear")

function render(event) {
  document.querySelector(".empty")?.remove()
  const item = document.createElement("details")
  item.className = "event"
  item.dataset.kind = event.kind ?? "event"
  item.innerHTML = \`<summary>
    <div class="meta">
      <span class="pill">\${escapeHtml(eventLabel(event))}</span>
    </div>
    <div class="value">\${escapeHtml(event.summary)}</div>
  </summary>
  <pre>\${escapeHtml(JSON.stringify(event.details ?? event.request ?? event, null, 2))}</pre>\`
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

function eventLabel(event) {
  if (event.kind === "permission") return event.permission ?? "permission"
  return event.kind ?? "event"
}

function connect() {
  const source = new EventSource("/permissions/events")

  source.addEventListener("open", () => {
    status.textContent = "connected"
    status.dataset.connected = "true"
  })
  source.addEventListener("permission", (message) => render(JSON.parse(message.data)))
  source.addEventListener("proxy", (message) => render(JSON.parse(message.data)))
  source.addEventListener("error", () => {
    status.textContent = "reconnecting"
    status.dataset.connected = "false"
  })
}

clear.addEventListener("click", () => {
  log.replaceChildren(emptyState())
})

function emptyState() {
  const item = document.createElement("article")
  item.className = "empty"
  item.textContent = "Waiting for permission or proxy events..."
  return item
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
    kind: "permission",
    permission: request.permission,
    receivedAt: new Date().toISOString(),
    request,
    summary: permissionSummary(request),
  }
}

function permissionResponse(request) {
  if (request.permission === "run" && request.value === null) {
    return { id: request.id, result: "deny" }
  }
  return { id: request.id, result: "allow" }
}

function permissionSummary(request) {
  if (typeof request.value === "string") return request.value
  if (request.value === null) return "-"
  if (request.value === undefined) return "-"
  return JSON.stringify(request.value, null, 2)
}

export function recordPermissionRequest(request) {
  return permissionEvent(request)
}

function proxySummary(details) {
  const status = details.status ? ` -> ${details.status}${details.statusText ? ` ${details.statusText}` : ""}` : ""
  const duration = details.duration === undefined ? "" : ` (${details.duration}ms)`
  return `${details.method} ${details.url ?? details.target}${status}${duration}`
}

export function recordProxyEvent(details) {
  return {
    details,
    id: details.id,
    kind: "proxy",
    receivedAt: new Date().toISOString(),
    summary: proxySummary(details),
  }
}

function eventBus(env) {
  return env.EVENT_BUS.get(env.EVENT_BUS.idFromName("monkeypaw-proxy-events"))
}

export async function publishEvent(env, type, event) {
  if (!env?.EVENT_BUS) return
  await eventBus(env).fetch("http://event-bus/publish", {
    method: "POST",
    body: JSON.stringify({ event, type }),
  })
}

export async function decidePermission(env, request) {
  if (!env?.EVENT_BUS) return permissionResponse(request)
  const response = await eventBus(env).fetch("http://event-bus/permission", {
    method: "POST",
    body: JSON.stringify(request),
  })
  return response.json()
}

export function servePermissionUi(request, env) {
  const url = new URL(request.url)
  if (request.method !== "GET") return
  if (url.pathname === "/permissions" || url.pathname === "/permissions/") {
    return new Response(html, { headers: headers("text/html; charset=utf-8") })
  }
  if (url.pathname === "/permissions/ui.js") {
    return new Response(script, { headers: headers("text/javascript; charset=utf-8") })
  }
  if (!env?.EVENT_BUS && url.pathname === "/permissions/events") {
    return new Response("event bus binding missing\n", { status: 500 })
  }
  if (url.pathname === "/permissions/events") return eventBus(env).fetch("http://event-bus/events", request)
}

export class EventBus extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.events = []
    this.clients = new Set()
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === "POST" && url.pathname === "/permission") {
      const permission = await request.json()
      this.broadcast("permission", permissionEvent(permission))
      return Response.json(permissionResponse(permission))
    }
    if (request.method === "POST" && url.pathname === "/publish") {
      const payload = await request.json()
      this.broadcast(payload.type, payload.event)
      return new Response(null, { status: 204 })
    }
    if (request.method === "GET" && url.pathname === "/events") return this.eventStream(request)
    return new Response("not found", { status: 404 })
  }

  broadcast(type, event) {
    const chunk = sse(type, event)
    this.events.push({ type, event })
    if (this.events.length > 100) this.events.shift()
    this.clients.forEach((client) => this.sendClient(client, chunk))
  }

  closeClient(client) {
    if (!client?.active) return
    client.active = false
    clearInterval(client.heartbeat)
    clearTimeout(client.timeout)
    client.request.signal.removeEventListener("abort", client.abort)
    this.clients.delete(client)

    try {
      client.controller.close()
    } catch {}
  }

  sendClient(client, chunk) {
    if (!client.active) return
    try {
      client.controller.enqueue(chunk)
    } catch {
      this.closeClient(client)
    }
  }

  pruneClients() {
    Array.from(this.clients)
      .slice(0, Math.max(0, this.clients.size - maxClients))
      .forEach((client) => this.closeClient(client))
  }

  eventStream(request) {
    let client
    const stream = new ReadableStream({
      start: (controller) => {
        client = {
          abort: undefined,
          active: true,
          controller,
          heartbeat: undefined,
          request,
          timeout: undefined,
        }
        client.abort = () => this.closeClient(client)
        this.clients.add(client)
        this.pruneClients()
        request.signal.addEventListener("abort", client.abort, { once: true })
        this.sendClient(client, encoder.encode("retry: 5000\n\n"))
        this.sendClient(client, sse("ready", { ok: true }))
        this.events.forEach((entry) => this.sendClient(client, sse(entry.type, entry.event)))
        client.heartbeat = setInterval(() => {
          this.sendClient(client, encoder.encode(": ping\n\n"))
        }, 15000)
        client.timeout = setTimeout(() => this.closeClient(client), streamTtl)
      },

      cancel: () => {
        this.closeClient(client)
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
}
