import * as nodePty from "npm:@lydell/node-pty"

type RawPty = ReturnType<typeof nodePty.spawn> & {
  fd: number
  _socket?: {
    fd?: number
    destroyed?: boolean
  }
  _write?: (data: string | Uint8Array) => void
}

const debug = (...args) => console.error("[deno-pty]", ...args)
const encoder = new TextEncoder()
const libcPath = Deno.build.arch === "aarch64"
  ? "/lib/aarch64-linux-gnu/libc.so.6"
  : "/lib/x86_64-linux-gnu/libc.so.6"
const libc = Deno.dlopen(libcPath, {
  write: {
    parameters: ["i32", "buffer", "usize"],
    result: "isize",
  },
})
debug("libc", { path: libcPath })

function code(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) return error.code
}

function message(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export function spawn(command, args = [], options = {}) {
  const pty = nodePty.spawn(command, args, {
    name: options.name,
    cwd: options.cwd,
    env: options.env,
  }) as RawPty
  let writable = true
  debug("spawn", {
    pid: pty.pid,
    fd: pty.fd,
    socketFd: pty._socket?.fd,
    socketDestroyed: pty._socket?.destroyed,
    command,
    args,
    cwd: options.cwd,
  })

  const writeAll = (data) => {
    const buffer = typeof data === "string" ? encoder.encode(data) : data
    let offset = 0
    while (offset < buffer.byteLength) {
      const written = Number(libc.symbols.write(pty.fd, buffer.subarray(offset), buffer.byteLength - offset))
      debug("write", { fd: pty.fd, requested: buffer.byteLength - offset, written })
      if (written <= 0) {
        writable = false
        return
      }
      offset += written
    }
  }

  pty._write = writeAll

  return {
    pid: pty.pid,
    write(data) {
      if (!writable) return
      try {
        writeAll(data)
      } catch (error) {
        debug("write failed", { fd: pty.fd, code: code(error), message: message(error) })
        if (code(error) !== "EBADF") throw error
        writable = false
      }
    },
    resize(cols, rows) {
      pty.resize(cols, rows)
    },
    kill() {
      pty.kill()
    },
    onData(fn) {
      return pty.onData((data) => {
        debug("data", { pid: pty.pid, length: data.length })
        fn(data)
      })
    },
    onExit(fn) {
      return pty.onExit((event) => {
        writable = false
        debug("exit", { pid: pty.pid, event })
        fn(event)
      })
    },
  }
}
