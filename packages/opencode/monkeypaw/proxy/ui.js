import { DurableObject } from "cloudflare:workers"
import clientScript from "./client.js"

const encoder = new TextEncoder()
const maxClients = 4
const streamTtl = 5 * 60 * 1000
let nextProxyRequestId = 1

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

      button,
      select {
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--card);
        color: var(--ink);
        cursor: pointer;
        font: inherit;
        padding: 8px 12px;
      }

      button:hover,
      select:hover {
        border-color: var(--muted);
      }

      label {
        align-items: center;
        color: var(--muted);
        display: flex;
        gap: 8px;
      }

      #status[data-connected="true"] {
        color: var(--accent);
      }

      #resources {
        display: grid;
        gap: 12px;
      }

      .empty,
      .resource {
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--card);
        max-width: 100%;
        min-width: 0;
        overflow: hidden;
        padding: 16px;
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
        white-space: pre;
      }

      .resource[open] pre {
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

    </style>
  </head>
  <body>
    <main>
      <header>
        <div class="actions">
          <label>
            sort
            <select id="sort">
              <option value="lastSeen">last used</option>
              <option value="firstSeen">first used</option>
              <option value="app">app</option>
              <option value="permission">permission</option>
              <option value="count">count</option>
            </select>
          </label>
          <button id="clear" type="button">clear</button>
          <div id="status">connecting</div>
        </div>
      </header>
      <section id="resources">
        <article class="empty">Waiting for permission resources...</article>
      </section>
    </main>
  </body>
</html>`

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
    app: request.app ?? "monkeypaw",
    datetime: request.datetime,
    id: request.id,
    kind: "permission",
    permission: request.permission,
    receivedAt: new Date().toISOString(),
    request,
    summary: permissionSummary(request),
  }
}

function resourceValueKey(value) {
  if (value === undefined) return "-"
  return JSON.stringify(stableResourceValue(value))
}

function stableResourceValue(value) {
  if (Array.isArray(value)) return value.map(stableResourceValue)
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableResourceValue(value[key])
        return result
      }, {})
  }
  return value
}

function permissionResourceId(app, request) {
  return JSON.stringify([app, request.permission ?? "permission", resourceValueKey(request.value)])
}

function permissionResource(request, existing) {
  const app = request.app ?? "monkeypaw"
  const valueText = permissionSummary(request)
  const seenAt = request.datetime ?? new Date().toISOString()
  return {
    app,
    count: (existing?.count ?? 0) + 1,
    firstSeen: existing?.firstSeen ?? seenAt,
    id: permissionResourceId(app, request),
    kind: "resource",
    lastRequest: request,
    lastSeen: seenAt,
    permission: request.permission ?? "permission",
    value: request.value,
    valueText,
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

export function recordProxyEvent(details) {
  const value = details.url ?? details.target ?? "-"
  return {
    app: "monkeypaw",
    datetime: new Date().toISOString(),
    id: details.id ?? nextProxyRequestId++,
    pid: 0,
    permission: "net",
    proxy: details,
    v: 1,
    value,
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
    return new Response(clientScript, { headers: headers("text/javascript; charset=utf-8") })
  }
  if (!env?.EVENT_BUS && url.pathname === "/permissions/events") {
    return new Response("event bus binding missing\n", { status: 500 })
  }
  if (url.pathname === "/permissions/events") return eventBus(env).fetch("http://event-bus/events", request)
}

export class EventBus extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.clients = new Set()
    this.resources = new Map()
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === "POST" && url.pathname === "/permission") {
      const permission = await request.json()
      const resource = permissionResource(permission, this.resources.get(permissionResourceId(permission.app ?? "monkeypaw", permission)))
      this.resources.set(resource.id, resource)
      this.broadcast("resource", resource)
      return Response.json(permissionResponse(permission))
    }
    if (request.method === "POST" && url.pathname === "/publish") {
      const payload = await request.json()
      if (payload.event?.permission) {
        const resource = permissionResource(payload.event, this.resources.get(permissionResourceId(payload.event.app ?? "monkeypaw", payload.event)))
        this.resources.set(resource.id, resource)
        this.broadcast("resource", resource)
      }
      return new Response(null, { status: 204 })
    }
    if (request.method === "GET" && url.pathname === "/events") return this.eventStream(request)
    return new Response("not found", { status: 404 })
  }

  broadcast(type, event) {
    const chunk = sse(type, event)
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
        this.resources.forEach((resource) => this.sendClient(client, sse("resource", resource)))
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
