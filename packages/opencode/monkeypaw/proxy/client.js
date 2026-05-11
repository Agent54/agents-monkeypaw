const status = document.querySelector("#status")
const resources = document.querySelector("#resources")
const clear = document.querySelector("#clear")
const sort = document.querySelector("#sort")
const state = new Map()
const dirty = new Set()
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
      <span data-field="count"></span>
      <span data-field="firstSeen"></span>
      <span data-field="lastSeen"></span>
    </div>
    <div class="value" data-field="value"></div>
  </summary>
  <pre></pre>`
  updateRow(row, resource)
  return row
}

function updateRow(row, resource) {
  row.querySelector('[data-field="permission"]').textContent = resource.permission
  row.querySelector('[data-field="app"]').textContent = resource.app
  row.querySelector('[data-field="count"]').textContent = `count ${resource.count}`
  row.querySelector('[data-field="firstSeen"]').textContent = `first ${formatTime(resource.firstSeen)}`
  row.querySelector('[data-field="lastSeen"]').textContent = `last ${formatTime(resource.lastSeen)}`
  row.querySelector('[data-field="value"]').textContent = resource.valueText
  if (row.open) row.querySelector("pre").textContent = JSON.stringify(resource, null, 2)
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
