type RefableTimer = {
  unref?: () => void
}

export function unrefTimer<T>(timer: T): T {
  if (typeof timer === "number") {
    if (typeof Deno !== "undefined" && "unrefTimer" in Deno) {
      Deno.unrefTimer(timer)
    }
    return timer
  }

  const value = timer as RefableTimer
  value.unref?.()
  return timer
}
