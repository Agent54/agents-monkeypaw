export default async function open(target: string | URL) {
  console.log(`[open-shim] ignoring open request: ${String(target)}`)
  return undefined
}
