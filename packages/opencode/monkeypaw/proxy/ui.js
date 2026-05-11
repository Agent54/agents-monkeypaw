import { DurableObject } from "cloudflare:workers"
import clientScript from "./client.js"

const encoder = new TextEncoder()
const maxClients = 4
const pendingPermissionTtl = 10 * 60 * 1000
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
        border-radius: 8px;
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
        border-radius: 8px;
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
        border-radius: 8px;
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
        border-radius: 8px;
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

      .resource[data-permission="proxy connect"] .pill,
      .resource[data-proxy-method="connect"] .pill {
        color: #f472b6;
      }

      .pill-proxy-get {
        color: #60a5fa;
      }

      .resource[data-permission="proxy get"] .pill,
      .resource[data-proxy-method="get"] .pill {
        color: #60a5fa;
      }

      .pill-proxy-post {
        color: #c084fc;
      }

      .resource[data-permission="proxy post"] .pill,
      .resource[data-proxy-method="post"] .pill {
        color: #c084fc;
      }

      .pill-proxy-other {
        color: #facc15;
      }

      .resource[data-permission^="proxy "]:not([data-permission="proxy connect"]):not([data-permission="proxy get"]):not([data-permission="proxy post"]) .pill,
      .resource[data-permission="net"][data-proxy-method]:not([data-proxy-method=""]):not([data-proxy-method="connect"]):not([data-proxy-method="get"]):not([data-proxy-method="post"]) .pill {
        color: #facc15;
      }

      .pending {
        color: var(--muted);
      }

      .pending-alert {
        align-items: center;
        border: 1px solid #7f1d1d;
        border-radius: 5px;
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
        flex-direction: column;
        gap: 8px;
        position: absolute;
        right: 12px;
        top: 12px;
        z-index: 2;
        max-width: calc(100% - 24px);
        overflow: hidden;
        padding: 8px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #050505;
      }

      .action-row {
        display: flex;
        gap: 8px;
        min-width: 0;
        width: 100%;
      }

      .row-actions button {
        border-radius: 8px;
        flex: 1 1 0;
        min-width: 0;
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .action-row-allow button {
        border-color: #14532d;
        color: #86efac;
      }

      .action-row-deny button {
        border-color: #7f1d1d;
        color: #fca5a5;
      }

      .action-row-allow button:hover {
        border-color: #22c55e;
      }

      .action-row-deny button:hover {
        border-color: #ef4444;
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
        border-radius: 8px;
        background: #050505;
      }

      .resource[data-custom="true"] .custom-rule {
        display: flex;
      }

      .custom-rule input {
        flex: 1;
        min-width: 0;
      }

      .custom-rule button {
        border-radius: 8px;
        flex: 0 0 auto;
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
          <button id="save-policies" type="button">save</button>
          <button id="load-policies" type="button">load</button>
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

function clip(value, max = 240) {
  const text = String(value)
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
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
    summary: permissionDisplayValue(request),
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
  const valueText = permissionDisplayValue(request)
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
    ruleValue: permissionRuleValue(request),
    rules: request.rules ?? [],
    value: request.value,
    valueKind: permissionValueKind(request.value),
    valueText,
  }
}

function permissionResponse(request) {
  if (request.permission === "run" && request.value === null) {
    return { id: request.id, result: "deny" }
  }
  return { id: request.id, result: request.rule?.action === "deny" ? "deny" : "allow" }
}

function globMatch(pattern, value) {
  const source = String(pattern)
  if (source.endsWith("/*")) {
    const regex = new RegExp(`^${globRegexSource(source.slice(0, -2))}(?:/.*)?$`)
    return regex.test(String(value))
  }
  const regex = new RegExp(`^${globRegexSource(source)}$`)
  return regex.test(String(value))
}

function globRegexSource(pattern) {
  return String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
}

function matchingRule(rules, request) {
  const app = request.app ?? "monkeypaw"
  const permission = request.permission ?? "permission"
  const value = permissionRuleValue(request)
  const valueKind = permissionValueKind(request.value)
  return rules.find((rule) =>
    (rule.app === "*" || rule.app === app) &&
    (rule.permission === "*" || rule.permission === permission) &&
    (!rule.valueKind || rule.valueKind === valueKind) &&
    globMatch(rule.pattern, value)
  )
}

function normalizeRules(input, nextRuleId) {
  const source = Array.isArray(input) ? input : input?.rules
  if (!Array.isArray(source)) return { nextRuleId, rules: [] }
  const rules = source
    .map((rule, index) => ({
      action: rule.action === "deny" ? "deny" : "allow",
      app: typeof rule.app === "string" && rule.app ? rule.app : "monkeypaw",
      createdAt: typeof rule.createdAt === "string" ? rule.createdAt : new Date().toISOString(),
      id: Number.isFinite(Number(rule.id)) ? Number(rule.id) : nextRuleId + index,
      pattern: typeof rule.pattern === "string" ? rule.pattern : "*",
      permission: typeof rule.permission === "string" && rule.permission ? rule.permission : "*",
      valueKind: typeof rule.valueKind === "string" ? rule.valueKind : undefined,
    }))
  return {
    nextRuleId: Math.max(nextRuleId, ...rules.map((rule) => rule.id + 1), nextRuleId),
    rules,
  }
}

function rulePattern(input, inferred) {
  if (typeof input.pattern !== "string") return "*"
  if (input.pattern !== "") return input.pattern
  if (input.valueKind === "null" || input.valueKind === "undefined") return ""
  return inferred?.value
}

function permissionValueKind(value) {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (typeof value === "string") return "string"
  return "json"
}

function permissionDisplayValue(request) {
  if (typeof request.value === "string") return request.value
  if (request.value === null) return "(null)"
  if (request.value === undefined) return "(missing)"
  return JSON.stringify(request.value, null, 2)
}

function permissionRuleValue(request) {
  if (typeof request.value === "string") return request.value
  if (request.value === null || request.value === undefined) return ""
  return JSON.stringify(request.value, null, 2)
}

export function recordPermissionRequest(request) {
  return permissionEvent(request)
}

export function recordProxyEvent(details) {
  const value = details.url ?? details.target ?? "-"
  const method = String(details.method ?? "proxy").toLowerCase()
  return {
    app: "monkeypaw",
    datetime: new Date().toISOString(),
    id: details.id ?? nextProxyRequestId++,
    pid: 0,
    permission: method === "connect" ? "proxy connect" : `proxy ${method}`,
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
  if (url.pathname === "/permissions/policies" && ["GET", "POST", "PUT"].includes(request.method)) {
    if (!env?.EVENT_BUS) return new Response("event bus binding missing\n", { status: 500 })
    return eventBus(env).fetch("http://event-bus/policies", request)
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
    if (url.pathname === "/policies" && request.method === "GET") return this.getPolicies()
    if (url.pathname === "/policies" && ["POST", "PUT"].includes(request.method)) return this.setPolicies(await request.json())
    if (request.method === "GET" && url.pathname === "/events") return this.eventStream(request)
    return new Response("not found", { status: 404 })
  }

  pendingCount() {
    return [...this.pending.values()].reduce((total, pending) => total + pending.length, 0)
  }

  addRule(input) {
    const inferred = this.inferRuleValue(input)
    const pattern = rulePattern(input, inferred)
    if (pattern === undefined) {
      return new Response("empty rule pattern does not match a pending resource\n", { status: 400 })
    }
    const rule = {
      action: input.action === "deny" ? "deny" : "allow",
      app: input.app ?? "monkeypaw",
      createdAt: new Date().toISOString(),
      id: this.nextRuleId++,
      pattern,
      permission: input.permission ?? "*",
      valueKind: typeof input.valueKind === "string" ? input.valueKind : inferred?.valueKind,
    }
    this.rules.push(rule)
    console.log(`[permissions] rule added action=${rule.action} permission=${rule.permission} pattern=${rule.pattern} pending=${this.pendingCount()}`)
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

  inferRuleValue(input) {
    if (input.pattern !== "" || input.valueKind === "null" || input.valueKind === "undefined") return
    if ("value" in input && input.value !== null && input.value !== undefined) {
      return {
        value: permissionRuleValue(input),
        valueKind: permissionValueKind(input.value),
      }
    }
    const app = input.app ?? "monkeypaw"
    const permission = input.permission ?? "*"
    const matches = [...this.pending.values()]
      .flatMap((pending) => pending)
      .map((pending) => pending.permission)
      .filter((pending) =>
        (app === "*" || (pending.app ?? "monkeypaw") === app) &&
        (permission === "*" || (pending.permission ?? "permission") === permission)
      )
      .map((pending) => ({
        key: `${permissionValueKind(pending.value)}\u0000${permissionRuleValue(pending)}`,
        value: permissionRuleValue(pending),
        valueKind: permissionValueKind(pending.value),
      }))
      .filter((pending) => pending.valueKind !== "null" && pending.valueKind !== "undefined")
    const unique = new Map(matches.map((pending) => [pending.key, pending]))
    if (unique.size !== 1) return
    return [...unique.values()][0]
  }

  getPolicies() {
    return Response.json({
      exportedAt: new Date().toISOString(),
      rules: this.rules,
      v: 1,
    })
  }

  setPolicies(input) {
    const policy = normalizeRules(input, this.nextRuleId)
    this.rules = policy.rules
    this.nextRuleId = policy.nextRuleId
    console.log(`[permissions] policies loaded rules=${this.rules.length} pending=${this.pendingCount()}`)
    this.rules.forEach((rule) => this.resolvePending(rule))
    this.resources.forEach((resource) => {
      resource.rule = matchingRule(this.rules, resource.lastRequest ?? resource)
      resource.pending = resource.pending && !resource.rule
      this.attachRules(resource)
      this.broadcast("resource", resource)
    })
    return this.getPolicies()
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
    console.log(`[permissions] pending id=${permission.id ?? "-"} app=${permission.app ?? "monkeypaw"} permission=${permission.permission ?? "permission"} value=${clip(permissionDisplayValue(permission))} pending=${this.pendingCount() + 1}`)
    return new Promise((resolve) => {
      const item = {
        permission,
        resolve,
        timeout: undefined,
      }
      item.timeout = setTimeout(() => {
        const pending = this.pending.get(resource.id) ?? []
        const remaining = pending.filter((current) => current !== item)
        if (remaining.length) {
          this.pending.set(resource.id, remaining)
        } else {
          this.pending.delete(resource.id)
        }
        permission.countIncrement = 0
        permission.pending = false
        permission.timedOut = true
        this.upsertResource(permission)
        console.log(`[permissions] pending timeout id=${permission.id ?? "-"} permission=${permission.permission ?? "permission"} value=${clip(permissionDisplayValue(permission))} pending=${this.pendingCount()}`)
        resolve(Response.json({ id: permission.id, result: "deny" }))
      }, pendingPermissionTtl)
      const pending = this.pending.get(resource.id) ?? []
      pending.push(item)
      this.pending.set(resource.id, pending)
    })
  }

  resolvePending(rule) {
    this.pending.forEach((pending, resourceId) => {
      const remaining = pending.filter((item) => {
        if (matchingRule([rule], item.permission) !== rule) return true
        clearTimeout(item.timeout)
        item.permission.pending = false
        item.permission.countIncrement = 0
        item.permission.rule = rule
        this.upsertResource(item.permission)
        console.log(`[permissions] pending resolved id=${item.permission.id ?? "-"} action=${rule.action} permission=${rule.permission} pattern=${rule.pattern}`)
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
