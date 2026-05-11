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
  row.innerHTML = `<summary>
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
      <div class="action-row action-row-allow">
        <button type="button" data-action="allow-all"></button>
        <button type="button" data-action="allow-value"></button>
        <button type="button" data-action="allow-custom">custom</button>
      </div>
      <div class="action-row action-row-deny">
        <button type="button" data-action="deny-all"></button>
        <button type="button" data-action="deny-value"></button>
      </div>
    </div>
    <form class="custom-rule">
      <input data-field="custom" name="pattern">
      <button type="submit" data-action="allow-custom-submit">allow glob</button>
      <button type="submit" data-action="deny-custom-submit">deny glob</button>
      <button type="button" data-action="allow-custom-cancel">cancel</button>
    </form>
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
  setActionButton(row, "allow-all", `allow all ${permissionLabel(resource)}`, `Allow all ${permissionLabel(resource)} resources`)
  setActionButton(row, "deny-all", `deny all ${permissionLabel(resource)}`, `Deny all ${permissionLabel(resource)} resources`)
  setActionButton(row, "allow-value", `allow ${resource.valueText}`, `Allow ${permissionLabel(resource)} ${resource.valueText}`)
  setActionButton(row, "deny-value", `deny ${resource.valueText}`, `Deny ${permissionLabel(resource)} ${resource.valueText}`)
  setActionButton(row, "allow-custom", "custom", "Custom glob rule")
  setActionButton(row, "allow-custom-submit", "allow glob", "Allow custom glob")
  setActionButton(row, "deny-custom-submit", "deny glob", "Deny custom glob")
  setActionButton(row, "allow-custom-cancel", "cancel", "Cancel custom glob")
  const custom = row.querySelector('[data-field="custom"]')
  if (!custom.value) custom.value = resource.ruleValue
  custom.title = resource.valueText
  setControlsDisabled(row, busy.has(resource.id))
  if (row.open) row.querySelector("pre").textContent = JSON.stringify(resource, null, 2)
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
  if (event.target.closest(".custom-rule")) event.stopPropagation()
  const button = event.target.closest("button")
  const action = button?.dataset.action
  if (!action) return
  if (action === "allow-custom-submit" || action === "deny-custom-submit") return
  event.preventDefault()
  event.stopPropagation()
  const row = event.target.closest(".resource")
  const entry = state.get(row?.dataset.id)
  if (!entry) return
  if (row.dataset.busy === "true") return
  if (action === "allow-all") addRule(row, entry.resource, "*", "allow")
  if (action === "deny-all") addRule(row, entry.resource, "*", "deny")
  if (action === "allow-value") addRule(row, entry.resource, entry.resource.ruleValue, "allow", entry.resource.valueKind)
  if (action === "deny-value") addRule(row, entry.resource, entry.resource.ruleValue, "deny", entry.resource.valueKind)
  if (action === "allow-custom") {
    row.dataset.custom = "true"
    row.querySelector('[data-field="custom"]').focus()
  }
  if (action === "allow-custom-cancel") {
    row.dataset.custom = "false"
  }
})

resources.addEventListener("submit", (event) => {
  if (!event.target.matches(".custom-rule")) return
  event.preventDefault()
  const row = event.target.closest(".resource")
  const entry = state.get(row?.dataset.id)
  const pattern = event.target.elements.pattern.value.trim()
  if (!entry || !pattern || row.dataset.busy === "true") return
  addRule(row, entry.resource, pattern, event.submitter?.dataset.action === "deny-custom-submit" ? "deny" : "allow", entry.resource.valueKind)
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
