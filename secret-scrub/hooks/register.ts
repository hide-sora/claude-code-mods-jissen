import type { Register } from 'claude-code'


// Ordered: the PEM block must match before the line-level rules chew it up.
const RULES: { kind: string; re: RegExp }[] = [
  { kind: 'pem', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'bearer', re: /(Authorization:[ \t]*Bearer[ \t]+)[A-Za-z0-9._~+/=-]+/g },
  { kind: 'openai', re: /sk-[A-Za-z0-9_-]{16,}/g },
  { kind: 'aws', re: /AKIA[0-9A-Z]{16}/g },
  { kind: 'github', re: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { kind: 'slack', re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
]

type Hits = Record<string, number>

function scrubText(text: string, hits: Hits): string {
  let out = text
  for (const rule of RULES) {
    // Only the bearer rule has a capture group. For the others the second
    // argument replace() passes is the match OFFSET, a number -- writing it
    // out produced "137[REDACTED:openai]" until this typeof guard was added.
    out = out.replace(rule.re, (_m: string, keep: unknown) => {
      hits[rule.kind] = (hits[rule.kind] ?? 0) + 1
      return `${typeof keep === 'string' ? keep : ''}[REDACTED:${rule.kind}]`
    })
  }
  return out
}

// A tool result is a record, not a string: Read keeps the file under
// result.file.content, Bash under result.stdout, Grep's record is untyped.
// Walking every string reaches all three without a per-tool branch.
function scrubValue(value: unknown, hits: Hits): unknown {
  if (typeof value === 'string') return scrubText(value, hits)
  if (Array.isArray(value)) return value.map(item => scrubValue(item, hits))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = scrubValue(item, hits)
    return out
  }
  return value
}

export const register: Register = on => {
  on('tool.call', { tool: ['Read', 'Grep', 'Bash'] }, async ($, e, next) => {
    const r = await next(e)
    if (r === null || typeof r !== 'object') return r
    if ('deny' in r && r.deny !== undefined) return r

    // Two counters: the record and the model-facing text are separate copies
    // of the same bytes, so one shared counter would double every kind.
    const inResult: Hits = {}
    const inText: Hits = {}
    const result = scrubValue(r.result, inResult)
    const text = typeof r.text === 'string' ? scrubText(r.text, inText) : r.text
    const kinds = [...new Set([...Object.keys(inResult), ...Object.keys(inText)])]
    if (kinds.length === 0) return r

    const summary = kinds.map(k => `${k}=${inResult[k] ?? 0}/${inText[k] ?? 0}`).join(' ')
    const before = await $.fs.read(`${$.plugin.root}/PROOF-scrub.log`).catch(() => '')
    const line =
      `${new Date().toISOString()} tool=${e.tool} ` +
      `resultKeys=[${Object.keys(r).join(',')}] ` +
      `hits(record/text) ${summary}\n`
    await $.fs.write(`${$.plugin.root}/PROOF-scrub.log`, `${before}${line}`)

    // ref names core's own messages and core would reuse them verbatim, so a
    // scrubbed answer must not carry it: return result + text only.
    return { result, text, context: r.context }
  }).catch(($, e, next) => {
    // Fail CLOSED. The generic template replays next(e) when it already ran,
    // but here that replay is the unscrubbed result, which is the whole point.
    return { deny: `secret-scrub: the scrubber failed (${next.error.kind}), refusing to hand ${e.tool} output over unscrubbed` }
  })
}
