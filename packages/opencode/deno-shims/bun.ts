export { pathToFileURL, fileURLToPath } from "node:url"
export * as semver from "npm:semver"
import { Buffer } from "node:buffer"

type ShellEnv = Record<string, string | undefined>

type ShellResult = {
  exitCode: number
  stdout: Buffer
  stderr: Buffer
  text(): string
  json<T = unknown>(): T
}

type Raw = {
  raw: string
}

function quote(value: string) {
  if (Deno.build.os === "windows") {
    return `"${value.replaceAll(`"`, `""`)}"`
  }
  return `'${value.replaceAll(`'`, `'"'"'`)}'`
}

function part(value: unknown): string {
  if (typeof value === "object" && value !== null && "raw" in value) {
    return (value as Raw).raw
  }
  if (Array.isArray(value)) {
    return value.map((item) => part(item)).join(" ")
  }
  return quote(String(value ?? ""))
}

function command(strings: TemplateStringsArray, values: unknown[]) {
  return strings.reduce((acc, chunk, index) => acc + chunk + (index < values.length ? part(values[index]) : ""), "")
}

class ShellCommand implements PromiseLike<ShellResult> {
  #command: string
  #cwd?: string
  #env?: ShellEnv
  #quiet: boolean
  #throws: boolean
  #promise?: Promise<ShellResult>

  constructor(
    command: string,
    options?: {
      cwd?: string
      env?: ShellEnv
      quiet?: boolean
      throws?: boolean
    },
  ) {
    this.#command = command
    this.#cwd = options?.cwd
    this.#env = options?.env
    this.#quiet = options?.quiet ?? false
    this.#throws = options?.throws ?? true
  }

  #clone(options?: {
    cwd?: string
    env?: ShellEnv
    quiet?: boolean
    throws?: boolean
  }) {
    return new ShellCommand(this.#command, {
      cwd: options?.cwd ?? this.#cwd,
      env: options?.env ?? this.#env,
      quiet: options?.quiet ?? this.#quiet,
      throws: options?.throws ?? this.#throws,
    })
  }

  #run() {
    if (this.#promise) return this.#promise
    this.#promise = (async () => {
      const proc = Deno.build.os === "windows"
        ? new Deno.Command("cmd", {
            args: ["/d", "/s", "/c", this.#command],
            cwd: this.#cwd,
            env: this.#env
              ? Object.fromEntries(Object.entries(this.#env).filter(([, value]) => value !== undefined)) as Record<
                  string,
                  string
                >
              : undefined,
            stdout: "piped",
            stderr: "piped",
          })
        : new Deno.Command("bash", {
            args: ["-lc", this.#command],
            cwd: this.#cwd,
            env: this.#env
              ? Object.fromEntries(Object.entries(this.#env).filter(([, value]) => value !== undefined)) as Record<
                  string,
                  string
                >
              : undefined,
            stdout: "piped",
            stderr: "piped",
          })

      const output = await proc.output()
      const stdout = Buffer.from(output.stdout)
      const stderr = Buffer.from(output.stderr)
      const result: ShellResult = {
        exitCode: output.code,
        stdout,
        stderr,
        text() {
          return stdout.toString("utf8")
        },
        json<T = unknown>() {
          return JSON.parse(stdout.toString("utf8")) as T
        },
      }

      if (!this.#quiet) {
        if (stdout.length) Deno.stdout.writeSync(stdout)
        if (stderr.length) Deno.stderr.writeSync(stderr)
      }

      if (!output.success && this.#throws) {
        const error = new Error(stderr.toString("utf8") || stdout.toString("utf8") || `Command failed: ${this.#command}`)
        Object.assign(error, result)
        throw error
      }

      return result
    })()
    return this.#promise
  }

  cwd(value: string) {
    return this.#clone({ cwd: value })
  }

  env(value: ShellEnv) {
    return this.#clone({ env: { ...(this.#env ?? {}), ...value } })
  }

  quiet() {
    return this.#clone({ quiet: true })
  }

  nothrow() {
    return this.#clone({ throws: false })
  }

  throws(value = true) {
    return this.#clone({ throws: value })
  }

  async text() {
    return (await this.#run()).text()
  }

  async json<T = unknown>() {
    return (await this.#run()).json<T>()
  }

  async *lines() {
    for (const line of (await this.text()).split(/\r?\n/)) {
      yield line
    }
  }

  then<TResult1 = ShellResult, TResult2 = never>(
    onfulfilled?: ((value: ShellResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.#run().then(onfulfilled ?? undefined, onrejected ?? undefined)
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<ShellResult | TResult> {
    return this.#run().catch(onrejected ?? undefined)
  }

  finally(onfinally?: (() => void) | null) {
    return this.#run().finally(onfinally ?? undefined)
  }
}

export function $(strings: TemplateStringsArray, ...values: unknown[]) {
  return new ShellCommand(command(strings, values))
}

function toBytes(input: string | ArrayBuffer | ArrayBufferView) {
  if (typeof input === "string") return new TextEncoder().encode(input)
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
}

function hash32(input: string | ArrayBuffer | ArrayBufferView) {
  const bytes = toBytes(input)
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

export const hash = Object.assign(
  (input: string | ArrayBuffer | ArrayBufferView) => hash32(input),
  {
    xxHash32(input: string | ArrayBuffer | ArrayBufferView) {
      return hash32(input)
    },
  },
)


export const argv = Deno.args

export function file(input: string | URL) {
  return {
    text() {
      return Deno.readTextFile(input)
    },
    async json() {
      return JSON.parse(await Deno.readTextFile(input))
    },
    bytes() {
      return Deno.readFile(input)
    },
  }
}

export function write(input: string | URL, data: string | Uint8Array) {
  if (typeof data === "string") return Deno.writeTextFile(input, data)
  return Deno.writeFile(input, data)
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const stdin = {
  async text() {
    return await new Response(Deno.stdin.readable).text()
  },
}

export const stdout = Deno.stdout
export const stderr = Deno.stderr

export const Bun = {
  $,
  argv,
  file,
  write,
  hash,
  sleep,
  stdin,
  stdout,
  stderr,
}
