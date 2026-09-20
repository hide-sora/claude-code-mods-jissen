import type { Register } from 'claude-code'

// `turn.step`'s `model` reaches the API verbatim: nothing resolves an alias
// on the way down. `model: 'haiku'` makes the request itself 404 with
// `not_found_error, model: haiku`, so a router writes ids, not family names.
const MODEL_IDS: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-5',
}
const modelId = (name: string): string => MODEL_IDS[name.trim().toLowerCase()] ?? name
const SUBAGENT_MODEL = modelId('haiku')
const SHORT_PROMPT = 80

export const register: Register = on => {
  let override: string | null = null
  let lastPromptLength = 0
  const log: string[] = []

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const saved = await $.store.get('override')
    override = typeof saved === 'string' ? saved : null
    await $.command.register({
      name: 'route',
      description: 'Pin the main loop to a model, or hand it back (model-router)',
      argumentHint: '<model | auto>',
    })
    return r
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const arg = String(e.args ?? '').trim()
    if (arg === 'auto') {
      override = null
      await $.store.delete('override')
    } else if (arg !== '') {
      // Resolved here, so what the person is told is what the API is sent.
      override = modelId(arg)
      await $.store.set('override', override)
    }
    return {
      text: override
        ? `model-router: the main loop runs on ${override}`
        : 'model-router: the main loop keeps the model it asked for',
    }
  })

  // The length of the last prompt is the only thing rule 2 needs, and a
  // length is not the person's text, so nothing of the prompt is kept.
  on('prompt.submit', async ($, e, next) => {
    lastPromptLength = e.text.length
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    let model = e.model
    let effort = e.effort
    let rule = 'none'
    if (e.agentId !== undefined) {
      if (model !== SUBAGENT_MODEL) {
        model = SUBAGENT_MODEL
        rule = 'subagent'
      }
    } else if (override !== null) {
      model = override
      rule = 'override'
    } else if (e.index === 0 && lastPromptLength > 0 && lastPromptLength < SHORT_PROMPT) {
      effort = 'low'
      rule = 'short-prompt'
    }

    const r = yield* next({ ...e, model, effort })

    const trace = next.trace
      .map(t => `${t.plugin}/${t.tier}:${t.outcome}${t.chunks === undefined ? '' : `(${t.chunks}c)`}`)
      .join(' > ')
    log.push(
      [
        `index=${e.index}`,
        `loop=${e.agentId ?? 'main'}`,
        `rule=${rule}`,
        `model=${e.model} -> ${model}`,
        `effort=${String(e.effort)} -> ${String(effort)}`,
        `messages=${e.messageCount}`,
        `answered=${r.usage === null ? 'none' : r.usage.model}`,
        `stop=${String(r.stopReason)}`,
        `tools=${r.toolUses.length}`,
        `trace=${trace}`,
      ].join(' | '),
    )
    await $.fs.write(`${$.plugin.root}/PROOF-steps.log`, `${log.join('\n')}\n`)
    return r
  })
}
