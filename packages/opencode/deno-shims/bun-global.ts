import { Buffer } from "node:buffer"
import { contentType } from "jsr:@std/media-types"
import path from 'node:path'
import { fileURLToPath } from "node:url"

function ansi(code: number, text: string) {
  return `\x1b[${code}m${text}\x1b[0m`
}

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

function toBytes(input: string | ArrayBuffer | ArrayBufferView) {
  if (typeof input === "string") return new TextEncoder().encode(input)
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
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

function $(strings: TemplateStringsArray, ...values: unknown[]) {
  return new ShellCommand(command(strings, values))
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

const hash = Object.assign(
  (input: string | ArrayBuffer | ArrayBufferView) => hash32(input),
  {
    xxHash32(input: string | ArrayBuffer | ArrayBufferView) {
      return hash32(input)
    },
  },
)

const colors = {
  black(text: string) {
    return ansi(30, text)
  },
  red(text: string) {
    return ansi(31, text)
  },
  green(text: string) {
    return ansi(32, text)
  },
  yellow(text: string) {
    return ansi(33, text)
  },
  blue(text: string) {
    return ansi(34, text)
  },
  magenta(text: string) {
    return ansi(35, text)
  },
  cyan(text: string) {
    return ansi(36, text)
  },
  white(text: string) {
    return ansi(37, text)
  },
  gray(text: string) {
    return ansi(90, text)
  },
  grey(text: string) {
    return ansi(90, text)
  },
  bold(text: string) {
    return ansi(1, text)
  },
  dim(text: string) {
    return ansi(2, text)
  },
}



class BunFile {
  #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  async text(): Promise<string> {
    return await Deno.readTextFile(this.#path);
  }

  async json(): Promise<any> {
    const text = await this.text();
    return JSON.parse(text);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = await Deno.readFile(this.#path);
    return bytes.buffer;
  }

  async bytes(): Promise<Uint8Array> {
    return await Deno.readFile(this.#path);
  }

  async exists(): Promise<boolean> {
    try {
      await Deno.stat(this.#path);
      return true;
    } catch {
      return false;
    }
  }

  async delete(): Promise<void> {
    await Deno.remove(this.#path);
  }

  get size(): number {
    const stat = Deno.statSync(this.#path);
    return stat.size;
  }

  get type(): string { return contentType(path.parse(this.#path).ext); }
}

export const Bun = {
  $,
  env: new Proxy(
    {},
    {
      get(_, prop) {
        if (typeof prop !== "string") return undefined
        return Deno.env.get(prop)
      },
      has(_, prop) {
        if (typeof prop !== "string") return false
        return Deno.env.get(prop) !== undefined
      },
      ownKeys() {
        return Reflect.ownKeys(Deno.env.toObject())
      },
      getOwnPropertyDescriptor(_, prop) {
        if (typeof prop !== "string") return undefined
        const value = Deno.env.get(prop)
        if (value === undefined) return undefined
        return {
          configurable: true,
          enumerable: true,
          writable: false,
          value,
        }
      },
    },
  ) as Record<string, string | undefined>,

  color(text: string, name: keyof typeof colors) {
    const fn = colors[name]
    if (!fn) return text
    return fn(text)
  },

  fileURLToPath,

  file(path: string) {
    return new BunFile(path);
  },

  async write(path: string, data: string | Uint8Array | ArrayBuffer) {
    if (typeof data === "string") {
      await Deno.writeTextFile(path, data);
    } else {
      await Deno.writeFile(path, data instanceof ArrayBuffer ? new Uint8Array(data) : data);
    }
  },

  hash,

  sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  },

  stdin: {
    async text() {
      return await new Response(Deno.stdin.readable).text()
    },
  },

  stdout: Deno.stdout,
  stderr: Deno.stderr,

  which(name: string) {
    const pathEnv = Deno.env.get("PATH")
    if (!pathEnv) return null

    const exts =
      Deno.build.os === "windows"
        ? (Deno.env.get("PATHEXT")?.split(";").filter(Boolean) ?? [".EXE", ".CMD", ".BAT", ".COM"])
        : [""]

    for (const dir of pathEnv.split(Deno.build.os === "windows" ? ";" : ":")) {
      for (const ext of exts) {
        const full = `${dir}${dir.endsWith("/") || dir.endsWith("\\") ? "" : Deno.build.os === "windows" ? "\\" : "/"}${name}${Deno.build.os === "windows" && name.includes(".") ? "" : ext}`
        try {
          const stat = Deno.statSync(full)
          if (stat.isFile) return full
        } catch {
        }
      }
    }

    return null
  },

  serve(options: {
    hostname?: string
    port?: number
    fetch: (request: Request) => Response | Promise<Response>
  }) {
    const hostname = options.hostname ?? "0.0.0.0"
    const port = options.port ?? 8000
    const server = Deno.serve({ hostname, port }, options.fetch)

    return {
      hostname,
      port,
      url: new URL(`http://${hostname}:${port}`),
      stop() {
        return server.shutdown()
      },
    }
  },
}
