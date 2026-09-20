import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type {
  CommandRunInput,
  HookStream,
  PromptSubmitInput,
  SessionStartInput,
  TurnStepChunk,
  TurnStepInput,
  TurnStepResult,
} from 'claude-code'

tier('user')

const HAIKU = 'claude-haiku-4-5-20251001'
const OPUS = 'claude-opus-5'

const session: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }
const step = (over: Partial<TurnStepInput>): TurnStepInput => ({
  turnId: 'turn-1',
  index: 0,
  model: OPUS,
  effort: 'high',
  messageCount: 12,
  ...over,
})
const prompt = (text: string): PromptSubmitInput => ({ text, wait: false, origin: { kind: 'composer' } })
const route = (args: string): CommandRunInput => ({
  command: 'route',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
})

// `next(e)` on a streaming event is the stream, not a promise: read it to the
// end, and `result` is what the bottom returned.
const drain = async (stream: HookStream<TurnStepChunk, TurnStepResult>): Promise<TurnStepResult> => {
  for await (const _chunk of stream) void _chunk
  return stream.result
}

describe('register', () => {
  test('sends a subagent step to haiku and a short first prompt to low effort', async ($, on) => {
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('fs.write', () => ({ value: undefined }))
    on('prompt.submit', ($, e) => ({ text: e.text }))
    const seen: string[] = []
    on('turn.step', async function* ($, e) {
      seen.push(`${e.agentId ?? 'main'}:${e.model}:${String(e.effort)}`)
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    })

    await $.session.start(session)
    await $.prompt.submit(prompt('Say OK'))
    await drain($.turn.step(step({})))
    await drain($.turn.step(step({ index: 1 })))
    await drain($.turn.step(step({ agentId: 'a1' })))

    expect(seen).toEqual([`main:${OPUS}:low`, `main:${OPUS}:high`, `a1:${HAIKU}:high`])
  })

  test('/route pins the main loop by model id and /route auto hands it back', async ($, on) => {
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('fs.write', () => ({ value: undefined }))
    const models: string[] = []
    on('turn.step', async function* ($, e) {
      models.push(e.model)
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    })

    await $.session.start(session)
    const pinned = await $.command.run(route('sonnet'))
    await drain($.turn.step(step({})))
    const freed = await $.command.run(route('auto'))
    await drain($.turn.step(step({})))

    expect(pinned.text).toContain('claude-sonnet-5')
    expect(freed.text).toContain('keeps the model')
    expect(models).toEqual(['claude-sonnet-5', OPUS])
  })
})
