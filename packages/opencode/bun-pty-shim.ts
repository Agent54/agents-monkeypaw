import * as nodePty from "npm:@lydell/node-pty"

export function spawn(command, args = [], options = {}) {  
  const pty = nodePty.spawn(command, args, {
    name: options.name,
    cwd: options.cwd,
    env: options.env,
  })

  return {
    pid: pty.pid,
    write(data) {
      pty.write(data)
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
      return pty.onExit(fn)
    },
  }
}
