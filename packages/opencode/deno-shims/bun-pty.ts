import * as nodePty from "npm:@lydell/node-pty"

const debug = (...args) => console.error("[deno-pty]", ...args)
const encoder = new TextEncoder()

export function spawn(command, args = [], options = {}) {  
  const pty = nodePty.spawn(command, args, {
    name: options.name,
    cwd: options.cwd,
    env: options.env,
  })
  let writable = true
  const writer = Deno.openSync(`/proc/self/fd/${pty.fd}`, { write: true })
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
      const written = writer.writeSync(buffer.subarray(offset))
      debug("write", { fd: pty.fd, requested: buffer.byteLength - offset, written })
      if (written <= 0) return
      offset += written
    }
  }

  pty._write = writeAll

  return {
    pid: pty.pid,
    write(data) {
      if (!writable) return
      try {
        pty.write(data)
      } catch (error) {
        debug("write failed", { fd: pty.fd, code: error?.code, message: error?.message })
        if (error?.code !== "EBADF") throw error
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
        writer.close()
        debug("exit", { pid: pty.pid, event })
        fn(event)
      })
    },
  }
}
