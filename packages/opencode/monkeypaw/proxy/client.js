const status = document.querySelector("#status")
const resources = document.querySelector("#resources")
const clear = document.querySelector("#clear")
const loadPolicies = document.querySelector("#load-policies")
const savePolicies = document.querySelector("#save-policies")
const sort = document.querySelector("#sort")
const policyStorageKey = "monkeypaw.permissionPolicies.v1"
const state = new Map()
const dirty = new Set()
const busy = new Set()
let flushNext = false
let immediateFlushTimer
let flushTimer

function upsert(resource) {
  const current = state.get(resource.id)
  if (current) {
    current.resource = resource
  } else {
    state.set(resource.id, { resource, row: undefined })
  }
  dirty.add(resource.id)
  if (shouldFlushImmediately(resource)) {
    scheduleImmediateFlush()
    return
  }
  scheduleFlush()
}

function scheduleFlush() {
  if (immediateFlushTimer) return
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = undefined
    renderOrder()
  }, 1000)
}

function scheduleImmediateFlush() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = undefined
  }
  if (immediateFlushTimer) return
  immediateFlushTimer = setTimeout(() => {
    immediateFlushTimer = undefined
    renderOrder()
  }, 0)
}

function shouldFlushImmediately(resource) {
  if (flushNext) {
    flushNext = false
    return true
  }
  return resource.proxy || resource.pending || resource.rule
}

function flushDirtyRows() {
  dirty.forEach((id) => {
    const entry = state.get(id)
    if (!entry) return
    if (!entry.row) entry.row = createRow(entry.resource)
    updateRow(entry.row, entry.resource)
  })
  dirty.clear()
}

function renderOrder() {
  if (!state.size) {
    resources.replaceChildren(emptyState())
    return
  }

  flushDirtyRows()
  resources.replaceChildren(...sortedEntries().map((entry) => entry.row))
}

function createRow(resource) {
  const row = document.createElement("details")
  row.className = "resource"
  row.innerHTML = `<summary tabindex="-1">
    <button class="caret" type="button" data-action="toggle-open" title="toggle details">›</button>
    <div class="meta">
      <span class="pill" data-field="permission"></span>
      <span data-field="app"></span>
      <span class="pending-alert" data-field="pending-alert" title="waiting for rule">!</span>
      <span class="pending" data-field="pending"></span>
      <span data-field="count"></span>
      <span data-field="firstSeen"></span>
      <span data-field="lastSeen"></span>
    </div>
    <div class="value" data-field="value"></div>
    <div class="rules" data-field="rules"></div>
    <div class="row-actions">
      <span class="spinner" data-field="spinner">saving...</span>
      <div class="permission-action action-row-allow">
        <span class="permission-action-label">allow</span>
        <div class="segments" data-field="allow-segments"></div>
      </div>
      <div class="permission-action action-row-deny">
        <span class="permission-action-label">deny</span>
        <div class="segments" data-field="deny-segments"></div>
      </div>
    </div>
  </summary>
  <pre></pre>`
  updateRow(row, resource)
  return row
}

function updateRow(row, resource) {
  row.dataset.id = resource.id
  row.dataset.pending = resource.pending ? "true" : "false"
  row.dataset.permission = resource.permission
  row.dataset.proxyMethod = resource.proxy?.method?.toLowerCase() ?? ""
  row.dataset.busy = busy.has(resource.id) ? "true" : "false"
  const pill = row.querySelector('[data-field="permission"]')
  pill.className = `pill ${permissionClass(resource)}`
  pill.textContent = permissionLabel(resource)
  row.querySelector('[data-field="app"]').textContent = resource.app
  row.querySelector('[data-field="pending-alert"]').hidden = !resource.pending
  row.querySelector('[data-field="pending"]').textContent = resource.pending ? "" : ruleLabel(resource.rule)
  row.querySelector('[data-field="count"]').textContent = `count ${resource.count}`
  row.querySelector('[data-field="firstSeen"]').textContent = `first ${formatTime(resource.firstSeen)}`
  row.querySelector('[data-field="lastSeen"]').textContent = `last ${formatTime(resource.lastSeen)}`
  row.querySelector('[data-field="value"]').textContent = resource.valueText
  row.querySelector('[data-field="rules"]').textContent = rulesText(resource)
  renderPermissionControls(row, resource)
  setActionButton(row, "toggle-open", row.open ? "⌄" : "›", row.open ? "Hide details" : "Show details")
  setControlsDisabled(row, busy.has(resource.id))
  if (row.open) row.querySelector("pre").textContent = JSON.stringify(resource, null, 2)
}

function renderPermissionControls(row, resource) {
  const patterns = segmentPatterns(resource)
  row.querySelector('[data-field="allow-segments"]').replaceChildren(...patterns.map((item) => segmentControl(item, resource, "allow")))
  row.querySelector('[data-field="deny-segments"]').replaceChildren(...patterns.map((item) => segmentControl(item, resource, "deny")))
}

function segmentControl(item, resource, action) {
  const segment = document.createElement("span")
  segment.className = item.trailing ? "segment segment-trailing" : item.empty ? "segment segment-empty" : "segment"
  segment.title = item.title
  segment.innerHTML = `${item.separator ? `<span class="segment-separator">${escapeHtml(item.separator)}</span>` : ""}
    <span class="segment-stack">
      <button class="segment-choice segment-star" type="button" data-action="segment-rule"></button>
      <button class="segment-choice segment-exact" type="button" data-action="segment-rule"></button>
    </span>`
  const star = segment.querySelector(".segment-star")
  const exact = segment.querySelector(".segment-exact")
  star.dataset.policyAction = action
  star.dataset.pattern = item.star
  star.textContent = "*"
  star.title = `${action} ${permissionLabel(resource)} ${item.star}`
  exact.dataset.policyAction = action
  exact.dataset.pattern = item.trailing ? item.star : item.exact
  exact.textContent = item.label
  exact.title = `${action} ${permissionLabel(resource)} ${item.trailing ? item.star : item.exact}`
  if (item.trailing) {
    star.remove()
    exact.textContent = "*"
  }
  return segment
}

function segmentPatterns(resource) {
  const value = resource.ruleValue
  if (resource.valueKind !== "string" || !value) {
    return [{
      empty: false,
      exact: value,
      label: resource.valueText,
      separator: "",
      star: "*",
      title: resource.valueText,
    }]
  }
  if (resource.permission === "env") return envSegmentPatterns(value)
  if (value.includes("/")) return pathSegmentPatterns(value)
  return wordSegmentPatterns(value)
}

function envSegmentPatterns(value) {
  const parts = value.split("_").filter(Boolean)
  if (!parts.length) return wordSegmentPatterns(value)
  return [...parts.map((part, index) => ({
    empty: false,
    exact: parts.slice(0, index + 1).join("_"),
    label: part,
    separator: index === 0 ? "" : "_",
    star: [...parts.slice(0, index), "*"].join("_"),
    title: parts.slice(0, index + 1).join("_"),
  })), {
    empty: true,
    exact: value,
    label: "*",
    separator: "_",
    star: `${value}_*`,
    title: `${value}_*`,
    trailing: true,
  }]
}

function pathSegmentPatterns(value) {
  const absolute = value.startsWith("/")
  const suffixSlash = value.endsWith("/") && value.length > 1
  const parts = value.split("/").filter(Boolean)
  if (!parts.length) {
    return [{
      empty: true,
      exact: absolute ? "/" : value,
      label: "*",
      separator: absolute ? "/" : "",
      star: absolute ? "/*" : "*",
      title: absolute ? "/*" : "*",
      trailing: true,
    }]
  }
  const prefix = absolute ? "/" : ""
  return [...parts.map((part, index) => ({
    empty: false,
    exact: `${prefix}${parts.slice(0, index + 1).join("/")}${suffixSlash && index === parts.length - 1 ? "/" : ""}`,
    label: part,
    separator: absolute || index > 0 ? "/" : "",
    star: `${prefix}${[...parts.slice(0, index), "*"].join("/")}`,
    title: `${prefix}${parts.slice(0, index + 1).join("/")}`,
  })), {
    empty: true,
    exact: value,
    label: "*",
    separator: "/",
    star: `${value.replace(/\/$/, "")}/*`,
    title: `${value.replace(/\/$/, "")}/*`,
    trailing: true,
  }]
}

function wordSegmentPatterns(value) {
  return [{
    empty: false,
    exact: value,
    label: value,
    separator: "",
    star: "*",
    title: value,
  }, {
    empty: true,
    exact: value,
    label: "*",
    separator: "",
    star: `${value}*`,
    title: `${value}*`,
    trailing: true,
  }]
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function setActionButton(row, action, text, title) {
  const button = row.querySelector(`[data-action="${action}"]`)
  button.textContent = text
  button.title = title
}

function permissionLabel(resource) {
  if (resource.permission?.startsWith("proxy ")) return resource.permission
  if (resource.permission === "net" && resource.proxy?.method) return `proxy ${resource.proxy.method.toLowerCase()}`
  return resource.permission
}

function permissionClass(resource) {
  if (resource.permission?.startsWith("proxy ")) {
    const method = resource.permission.slice("proxy ".length)
    if (["connect", "get", "post"].includes(method)) return `pill-proxy-${method}`
    return "pill-proxy-other"
  }
  if (resource.permission === "net" && resource.proxy?.method) {
    const method = resource.proxy.method.toLowerCase()
    if (["connect", "get", "post"].includes(method)) return `pill-proxy-${method}`
    return "pill-proxy-other"
  }
  if (["read", "write", "net", "env", "run", "sys", "ffi", "import"].includes(resource.permission)) return `pill-${resource.permission}`
  return "pill"
}

function ruleLabel(rule) {
  if (!rule) return "no rule"
  return `${rule.action} ${rule.permission} ${formatRulePattern(rule)}`
}

function rulesText(resource) {
  if (!resource.rules?.length) return "rules: none"
  return `rules: ${resource.rules.map((rule) => `${rule.action} ${rule.permission} ${formatRulePattern(rule)}`).join(", ")}`
}

function formatRulePattern(rule) {
  if (rule.valueKind === "null" && rule.pattern === "") return "(null)"
  if (rule.valueKind === "undefined" && rule.pattern === "") return "(missing)"
  return rule.pattern
}

function sortedEntries() {
  return [...state.values()].sort((left, right) => {
    const priority = resourcePriority(left.resource) - resourcePriority(right.resource)
    if (priority) return priority
    if (sort.value === "count") return right.resource.count - left.resource.count || byLastSeen(left, right)
    if (sort.value === "firstSeen") return timeValue(left.resource.firstSeen) - timeValue(right.resource.firstSeen)
    if (sort.value === "app") return compareText(left.resource.app, right.resource.app) || compareText(left.resource.permission, right.resource.permission) || compareText(left.resource.valueText, right.resource.valueText)
    if (sort.value === "permission") return compareText(left.resource.permission, right.resource.permission) || compareText(left.resource.app, right.resource.app) || compareText(left.resource.valueText, right.resource.valueText)
    return byLastSeen(left, right)
  })
}

function resourcePriority(resource) {
  if (resource.pending && !resource.proxy) return 0
  return 1
}

function byLastSeen(left, right) {
  return timeValue(right.resource.lastSeen) - timeValue(left.resource.lastSeen)
}

function timeValue(value) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return 0
  return timestamp
}

function compareText(left, right) {
  return String(left).localeCompare(String(right))
}

function formatTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function connect() {
  const source = new EventSource("/permissions/events")

  source.addEventListener("open", () => {
    status.textContent = "connected"
    status.dataset.connected = "true"
  })
  source.addEventListener("resource", (message) => {
    upsert(JSON.parse(message.data))
  })
  source.addEventListener("error", () => {
    status.textContent = "reconnecting"
    status.dataset.connected = "false"
  })
}

clear.addEventListener("click", () => {
  state.clear()
  dirty.clear()
  if (flushTimer) clearTimeout(flushTimer)
  if (immediateFlushTimer) clearTimeout(immediateFlushTimer)
  flushTimer = undefined
  immediateFlushTimer = undefined
  renderOrder()
})

savePolicies.addEventListener("click", async () => {
  setPolicyButtonsDisabled(true)
  try {
    const policy = await fetchPolicies()
    if (!policy) return
    savePolicy(policy)
    status.textContent = `saved ${policy.rules?.length ?? 0} policies`
  } finally {
    setPolicyButtonsDisabled(false)
  }
})

loadPolicies.addEventListener("click", async () => {
  await loadSavedPolicies()
})

async function fetchPolicies() {
  const response = await fetch("/permissions/policies")
  if (!response.ok) {
    status.textContent = "policy save failed"
    return
  }
  return response.json()
}

function savePolicy(policy) {
  try {
    localStorage.setItem(policyStorageKey, JSON.stringify(policy, null, 2))
  } catch {
    status.textContent = "policy save unavailable"
  }
}

async function loadSavedPolicies() {
  let saved
  try {
    saved = localStorage.getItem(policyStorageKey)
  } catch {
    status.textContent = "policy load unavailable"
    return
  }
  if (!saved) {
    status.textContent = "no saved policies"
    return
  }
  setPolicyButtonsDisabled(true)
  try {
    const policy = JSON.parse(saved)
    const response = await fetch("/permissions/policies", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(policy),
    })
    if (!response.ok) {
      status.textContent = "policy load failed"
      return
    }
    const loaded = await response.json()
    flushNext = true
    scheduleImmediateFlush()
    status.textContent = `loaded ${loaded.rules?.length ?? 0} policies`
  } catch {
    status.textContent = "saved policies invalid"
  } finally {
    setPolicyButtonsDisabled(false)
  }
}

function setPolicyButtonsDisabled(disabled) {
  savePolicies.disabled = disabled
  loadPolicies.disabled = disabled
}

sort.addEventListener("change", renderOrder)

resources.addEventListener("click", (event) => {
  const summary = event.target.closest(".resource > summary")
  if (summary) event.preventDefault()
  const button = event.target.closest("button")
  const action = button?.dataset.action
  if (!action) return
  event.preventDefault()
  event.stopPropagation()
  const row = event.target.closest(".resource")
  const entry = state.get(row?.dataset.id)
  if (!entry) return
  if (action === "toggle-open") {
    row.open = !row.open
    setActionButton(row, "toggle-open", row.open ? "⌄" : "›", row.open ? "Hide details" : "Show details")
    if (row.open) row.querySelector("pre").textContent = JSON.stringify(entry.resource, null, 2)
    return
  }
  if (row.dataset.busy === "true") return
  if (action === "segment-rule") {
    addRule(row, entry.resource, button.dataset.pattern, button.dataset.policyAction, entry.resource.valueKind)
  }
})

async function addRule(row, resource, pattern, action, valueKind) {
  busy.add(resource.id)
  setBusy(row, resource.id, true)
  try {
    const response = await fetch("/permissions/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        app: resource.app,
        pattern,
        permission: resource.permission,
        value: resource.value,
        valueKind,
      }),
    })
    if (response.ok) {
      row.dataset.custom = "false"
      flushNext = true
      scheduleImmediateFlush()
    } else {
      status.textContent = "rule failed"
    }
  } finally {
    busy.delete(resource.id)
    setBusy(row, resource.id, false)
  }
}

function setBusy(row, id, isBusy) {
  if (!row || row.dataset.id !== id) return
  row.dataset.busy = isBusy ? "true" : "false"
  setControlsDisabled(row, isBusy)
}

function setControlsDisabled(row, isBusy) {
  row.querySelectorAll("button, input").forEach((item) => {
    item.disabled = isBusy
  })
}

resources.addEventListener("toggle", (event) => {
  if (!event.target.matches(".resource")) return
  if (!event.target.open) return
  const entry = [...state.values()].find((item) => item.row === event.target)
  if (entry) event.target.querySelector("pre").textContent = JSON.stringify(entry.resource, null, 2)
}, true)

function emptyState() {
  const item = document.createElement("article")
  item.className = "empty"
  item.textContent = "Waiting for permission resources..."
  return item
}

connect()
