import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"

const theme = fileURLToPath(new URL("./public/oc-theme-preload.js", import.meta.url))
const monkeypaw = fileURLToPath(new URL("../../monkeypaw", import.meta.url))

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "opencode-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        worker: {
          format: "es",
        },
      }
    },
  },
  {
    name: "opencode-desktop:theme-preload",
    transformIndexHtml(html) {
      return html.replace(
        '<script id="oc-theme-preload-script" src="/oc-theme-preload.js"></script>',
        `<script id="oc-theme-preload-script">${readFileSync(theme, "utf8")}</script>`,
      )
    },
  },
  {
    name: "opencode-monkeypaw",
    transform(code, id) {
      if (!id.endsWith("/src/index.css")) return
      if (!existsSync(monkeypaw)) return
      const files = readdirSync(monkeypaw)
        .filter((f) => f.endsWith(".css"))
        .sort()
      if (!files.length) return
      return {
        code: code + "\n" + files.map((f) => readFileSync(join(monkeypaw, f), "utf8")).join("\n"),
        map: null,
      }
    },
  },
  tailwindcss(),
  solidPlugin(),
]
