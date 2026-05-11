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
        --card: #030303;
        --card-elevated: #0a0a0a;
        --ink: #f2f2f2;
        --muted: #8b8b8b;
        --line: #1d1d1d;
        --line-strong: #333;
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
        border-radius: 21px;
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

      button:disabled,
      input:disabled {
        opacity: 0.55;
      }

      input {
        border: 1px solid var(--line);
        border-radius: 21px;
        background: var(--bg);
        color: var(--ink);
        font: inherit;
        padding: 8px 12px;
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
        border-radius: 14px;
        background: var(--card);
        max-width: 100%;
        min-width: 0;
        overflow: hidden;
        padding: 16px;
      }

      .resource {
        position: relative;
      }

      .resource:hover,
      .resource:focus-within {
        background: var(--card-elevated);
        border-color: var(--line-strong);
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

      .pill-read {
        color: #67e8f9;
      }

      .resource[data-permission="read"] .pill {
        color: #67e8f9;
      }

      .pill-write {
        color: #fb7185;
      }

      .resource[data-permission="write"] .pill {
        color: #fb7185;
      }

      .pill-net {
        color: #a78bfa;
      }

      .resource[data-permission="net"] .pill {
        color: #a78bfa;
      }

      .pill-env {
        color: #86efac;
      }

      .resource[data-permission="env"] .pill {
        color: #86efac;
      }

      .pill-run {
        color: #fbbf24;
      }

      .resource[data-permission="run"] .pill {
        color: #fbbf24;
      }

      .pill-sys,
      .resource[data-permission="sys"] .pill {
        color: #34d399;
      }

      .pill-ffi,
      .resource[data-permission="ffi"] .pill {
        color: #f97316;
      }

      .pill-import,
      .resource[data-permission="import"] .pill {
        color: #22d3ee;
      }

      .pill-proxy-connect {
        color: #f472b6;
      }

      .resource[data-proxy-method="connect"] .pill {
        color: #f472b6;
      }

      .pill-proxy-get {
        color: #60a5fa;
      }

      .resource[data-proxy-method="get"] .pill {
        color: #60a5fa;
      }

      .pill-proxy-post {
        color: #c084fc;
      }

      .resource[data-proxy-method="post"] .pill {
        color: #c084fc;
      }

      .pill-proxy-other {
        color: #facc15;
      }

      .resource[data-permission="net"][data-proxy-method]:not([data-proxy-method=""]):not([data-proxy-method="connect"]):not([data-proxy-method="get"]):not([data-proxy-method="post"]) .pill {
        color: #facc15;
      }

      .pending {
        color: var(--muted);
      }

      .pending-alert {
        align-items: center;
        border: 1px solid #7f1d1d;
        border-radius: 999px;
        color: #f87171;
        display: inline-flex;
        font-weight: 700;
        height: 18px;
        justify-content: center;
        line-height: 1;
        width: 18px;
      }

      .pending-alert[hidden] {
        display: none;
      }

      .row-actions {
        display: none;
        flex-wrap: wrap;
        gap: 8px;
        position: absolute;
        right: 12px;
        top: 12px;
        z-index: 2;
        max-width: min(520px, calc(100% - 24px));
        padding: 8px;
        border: 1px solid var(--line);
        border-radius: 21px;
        background: #050505;
      }

      .custom-rule {
        display: none;
        gap: 8px;
        position: absolute;
        left: 12px;
        right: 12px;
        top: 56px;
        z-index: 3;
        padding: 8px;
        border: 1px solid var(--line);
        border-radius: 21px;
        background: #050505;
      }

      .resource[data-custom="true"] .custom-rule {
        display: flex;
      }

      .custom-rule input {
        flex: 1;
        min-width: 0;
      }

      .spinner {
        display: none;
      }

      .resource[data-busy="true"] .spinner {
        display: inline;
      }

      .resource:hover .row-actions,
      .resource:focus-within .row-actions {
        display: flex;
      }

      .rules {
        color: var(--muted);
        margin-top: 10px;
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
  const countIncrement = request.countIncrement ?? 1
  return {
    app,
    count: (existing?.count ?? 0) + countIncrement,
    firstSeen: existing?.firstSeen ?? seenAt,
    id: permissionResourceId(app, request),
    kind: "resource",
    lastRequest: request,
    lastSeen: seenAt,
    pending: request.pending ?? false,
    permission: request.permission ?? "permission",
    rule: request.rule,
    rules: request.rules ?? [],
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

function globMatch(pattern, value) {
  const regex = new RegExp(`^${String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`)
  return regex.test(String(value))
}

function matchingRule(rules, request) {
  const app = request.app ?? "monkeypaw"
  const permission = request.permission ?? "permission"
  const value = permissionSummary(request)
  return rules.find((rule) =>
    (rule.app === "*" || rule.app === app) &&
    (rule.permission === "*" || rule.permission === permission) &&
    globMatch(rule.pattern, value)
  )
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
  if (request.method === "POST" && url.pathname === "/permissions/rules") {
    if (!env?.EVENT_BUS) return new Response("event bus binding missing\n", { status: 500 })
    return eventBus(env).fetch("http://event-bus/rules", request)
  }
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
    this.nextRuleId = 1
    this.pending = new Map()
    this.resources = new Map()
    this.rules = []
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === "POST" && url.pathname === "/permission") {
      const permission = await request.json()
      return this.decide(permission)
    }
    if (request.method === "POST" && url.pathname === "/publish") {
      const payload = await request.json()
      if (payload.event?.permission) {
        this.upsertResource(payload.event)
      }
      return new Response(null, { status: 204 })
    }
    if (request.method === "POST" && url.pathname === "/rules") return this.addRule(await request.json())
    if (request.method === "GET" && url.pathname === "/events") return this.eventStream(request)
    return new Response("not found", { status: 404 })
  }

  addRule(input) {
    const rule = {
      action: "allow",
      app: input.app ?? "monkeypaw",
      createdAt: new Date().toISOString(),
      id: this.nextRuleId++,
      pattern: input.pattern ?? "*",
      permission: input.permission ?? "*",
    }
    this.rules.push(rule)
    this.resolvePending(rule)
    this.resources.forEach((resource) => {
      if (!this.ruleAppliesToResource(rule, resource)) return
      resource.pending = false
      resource.rule = rule
      this.attachRules(resource)
      this.broadcast("resource", resource)
    })
    return Response.json({ rule, rules: this.rules })
  }

  ruleAppliesToResource(rule, resource) {
    return matchingRule([rule], resource.lastRequest ?? resource) === rule
  }

  attachRules(resource) {
    resource.rules = this.rules.filter((rule) => this.ruleAppliesToResource(rule, resource))
    return resource
  }

  decide(permission) {
    const rule = matchingRule(this.rules, permission)
    if (rule || (permission.permission === "run" && permission.value === null)) {
      permission.pending = false
      permission.rule = rule
      const resource = this.upsertResource(permission)
      return Response.json(permissionResponse({ ...permission, rule: resource.rule }))
    }

    permission.pending = true
    const resource = this.upsertResource(permission)
    return new Promise((resolve) => {
      const pending = this.pending.get(resource.id) ?? []
      pending.push({ permission, resolve })
      this.pending.set(resource.id, pending)
    })
  }

  resolvePending(rule) {
    this.pending.forEach((pending, resourceId) => {
      const remaining = pending.filter((item) => {
        if (matchingRule([rule], item.permission) !== rule) return true
        item.permission.pending = false
        item.permission.countIncrement = 0
        item.permission.rule = rule
        this.upsertResource(item.permission)
        item.resolve(Response.json(permissionResponse(item.permission)))
        return false
      })
      if (remaining.length) {
        this.pending.set(resourceId, remaining)
        return
      }
      this.pending.delete(resourceId)
    })
  }

  upsertResource(request) {
    request.rules = []
    const resource = permissionResource(request, this.resources.get(permissionResourceId(request.app ?? "monkeypaw", request)))
    this.attachRules(resource)
    this.resources.set(resource.id, resource)
    this.broadcast("resource", resource)
    return resource
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
