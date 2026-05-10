const target = process.env.WEBFETCH_PATCH_TARGET ?? "/src/packages/opencode/src/tool/webfetch.ts"
const source = await Bun.file(target).text()

const start = source.indexOf("async function extractTextFromHTML")
const end = source.indexOf("function convertHTMLToMarkdown", start)

if (start === -1 || end === -1) {
  throw new Error("Could not find webfetch text extraction block to patch")
}

await Bun.write(
  target,
  source.slice(0, start) +
    `async function extractTextFromHTML(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi, " ")
      .replace(/<style\\b[^>]*>[\\s\\S]*?<\\/style>/gi, " ")
      .replace(/<noscript\\b[^>]*>[\\s\\S]*?<\\/noscript>/gi, " ")
      .replace(/<iframe\\b[^>]*>[\\s\\S]*?<\\/iframe>/gi, " ")
      .replace(/<object\\b[^>]*>[\\s\\S]*?<\\/object>/gi, " ")
      .replace(/<embed\\b[^>]*>[\\s\\S]*?<\\/embed>/gi, " ")
      .replace(/<(br|\\/p|\\/div|\\/section|\\/article|\\/li|\\/tr|\\/h[1-6])\\b[^>]*>/gi, "\\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \\t\\f\\v]+/g, " ")
    .replace(/\\s*\\n\\s*/g, "\\n")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim()
}

function decodeHtmlEntities(text: string) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  }

  return text.replace(/&(#\\d+|#x[\\da-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const codepoint = entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
      if (!Number.isFinite(codepoint)) return match
      return String.fromCodePoint(codepoint)
    }

    return named[entity.toLowerCase() as keyof typeof named] ?? match
  })
}

` +
    source.slice(end),
)
