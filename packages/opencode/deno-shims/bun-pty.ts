import fs from "node:fs"
import * as nodePty from "npm:@lydell/node-pty"

const encoder = new TextEncoder()

export function spawn(command, args = [], options = {}) {  
  const pty = nodePty.spawn(command, args, {
    name: options.name,
    cwd: options.cwd,
    env: options.env,
  })
  let writable = true

  const writeAll = (data) => {
    const buffer = typeof data === "string" ? encoder.encode(data) : data
    let offset = 0
    while (offset < buffer.byteLength) {
      const written = fs.writeSync(pty.fd, buffer, offset, buffer.byteLength - offset)
      if (written <= 0) return
      offset += written
    }
  }

  pty._writeStream?._writeQueue?.splice(0)
  pty._writeStream?.dispose?.()
  if (pty._writeStream) {
    pty._writeStream.write = writeAll
    pty._writeStream._processWriteQueue = () => {}
  }
  pty._write = writeAll

  return {
    pid: pty.pid,
    write(data) {
      if (!writable) return
      try {
        pty.write(data)
      } catch (error) {
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
      return pty.onData(fn)
    },
    onExit(fn) {
      return pty.onExit((event) => {
        writable = false
        fn(event)
      })
    },
  }
}
