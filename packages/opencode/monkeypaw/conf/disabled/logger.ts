import type { Plugin } from "@opencode-ai/plugin"

export const LoggerPlugin: Plugin = async (ctx) => {
  console.error("=== PLUGIN LOADED ===", ctx.directory)
  return {
    "experimental.chat.system.transform": async (input, output) => {
      console.error("=== SYSTEM PROMPTS ===")
      for (const s of output.system) {
        console.error(s)
      }
      console.error("=== END SYSTEM ===")
    },
    "experimental.chat.messages.transform": async (input, output) => {
      console.error("=== FULL MESSAGE HISTORY ===")
      for (const msg of output.messages) {
        console.error("--- message role:", msg.info.role, "id:", msg.info.id, "---")
        for (const part of msg.parts) {
          console.error(JSON.stringify(part, null, 2))
        }
      }
      console.error("=== END MESSAGES ===")
    },
    "tool.definition": async (input, output) => {
      console.error("=== TOOL DEF ===", input.toolID)
      console.error("description:", output.description)
      console.error("parameters:", JSON.stringify(output.parameters, null, 2))
      console.error("=== END TOOL DEF ===")
    },
    "chat.params": async (input, output) => {
      console.error("=== CHAT PARAMS ===", JSON.stringify({
        model: input.model,
        agent: input.agent,
        temperature: output.temperature,
      }, null, 2))
    },
  }
}
