import type { Hono } from "hono"
import { upgradeWebSocket } from "../../deno-shims/hono-deno.ts"
import type { Adapter } from "./adapter"

export const adapter: Adapter = {
  create(app: Hono) {
    return {
      upgradeWebSocket,
      async listen(opts) {
        const start = (port: number) => {
          try {
            return Deno.serve(
              {
                hostname: opts.hostname,
                port,
              },
              app.fetch,
            )
          } catch {
            return
          }
        }

        const server = opts.port === 0 ? (start(4096) ?? start(0)) : start(opts.port)
        if (!server) {
          throw new Error(`Failed to start server on port ${opts.port}`)
        }

        if (server.addr.transport !== "tcp") {
          throw new Error(`Failed to resolve server address for port ${opts.port}`)
        }

        let stopping: Promise<void> | undefined
        return {
          port: server.addr.port,
          finished: server.finished,
          stop() {
            stopping ??= server.shutdown()
            return stopping
          },
        }
      },
    }
  },
}
