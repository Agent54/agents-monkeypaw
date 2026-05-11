const status = document.querySelector("#status")
const resources = document.querySelector("#resources")
const clear = document.querySelector("#clear")
const sort = document.querySelector("#sort")
const state = new Map()
const dirty = new Set()
const busy = new Set()
let flushTimer

function upsert(resource) {
  const current = state.get(resource.id)
  if (current) {
    current.resource = resource
  } else {
    state.set(resource.id, { resource, row: undefined })
  }
  dirty.add(resource.id)
  scheduleFlush()
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = undefined
    flushDirtyRows()
    renderOrder()
  }, 1000)
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
      <button type="button" data-action="allow-all"></button>
      <button type="button" data-action="allow-value"></button>
      <button type="button" data-action="allow-custom">custom</button>
    </div>
    <form class="custom-rule">
      <input data-field="custom" name="pattern">
      <button type="submit" data-action="allow-custom-submit">allow glob</button>
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
  row.querySelector('[data-action="allow-all"]').textContent = `all ${resource.permission}`
  row.querySelector('[data-action="allow-value"]').textContent = `${resource.permission} ${resource.valueText}`
  if (!row.querySelector('[data-field="custom"]').value) row.querySelector('[data-field="custom"]').value = resource.valueText
  setControlsDisabled(row, busy.has(resource.id))
  if (row.open) row.querySelector("pre").textContent = JSON.stringify(resource, null, 2)
}

function permissionLabel(resource) {
  if (resource.permission === "net" && resource.proxy?.method) return `proxy ${resource.proxy.method.toLowerCase()}`
  return resource.permission
}

function permissionClass(resource) {
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
  return `rule ${rule.permission} ${rule.pattern}`
}

function rulesText(resource) {
  if (!resource.rules?.length) return "rules: none"
  return `rules: ${resource.rules.map((rule) => `${rule.permission} ${rule.pattern}`).join(", ")}`
}

function sortedEntries() {
  return [...state.values()].sort((left, right) => {
    if (sort.value === "count") return right.resource.count - left.resource.count || byLastSeen(left, right)
    if (sort.value === "firstSeen") return timeValue(left.resource.firstSeen) - timeValue(right.resource.firstSeen)
    if (sort.value === "app") return compareText(left.resource.app, right.resource.app) || compareText(left.resource.permission, right.resource.permission) || compareText(left.resource.valueText, right.resource.valueText)
    if (sort.value === "permission") return compareText(left.resource.permission, right.resource.permission) || compareText(left.resource.app, right.resource.app) || compareText(left.resource.valueText, right.resource.valueText)
    return byLastSeen(left, right)
  })
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
  flushTimer = undefined
  renderOrder()
})

sort.addEventListener("change", renderOrder)

resources.addEventListener("click", (event) => {
  if (event.target.closest(".custom-rule")) event.stopPropagation()
  const button = event.target.closest("button")
  const action = button?.dataset.action
  if (!action) return
  if (action === "allow-custom-submit") return
  event.preventDefault()
  event.stopPropagation()
  const row = event.target.closest(".resource")
  const entry = state.get(row?.dataset.id)
  if (!entry) return
  if (row.dataset.busy === "true") return
  if (action === "allow-all") addRule(row, entry.resource, "*")
  if (action === "allow-value") addRule(row, entry.resource, entry.resource.valueText)
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
  addRule(row, entry.resource, pattern)
})

async function addRule(row, resource, pattern) {
  busy.add(resource.id)
  setBusy(row, resource.id, true)
  const started = Date.now()
  try {
    const response = await fetch("/permissions/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app: resource.app,
        pattern,
        permission: resource.permission,
      }),
    })
    if (response.ok) {
      row.dataset.custom = "false"
    } else {
      status.textContent = "rule failed"
    }
  } finally {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 500 - (Date.now() - started))))
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
