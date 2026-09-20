import { describe, expect, test, tier } from 'claude-code/testing'
import type { CommandRunInput, SessionStartInput, TurnCompleteInput, TurnStartInput } from 'claude-code'

tier('user')

const session: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }
const start: TurnStartInput = { text: 'list the repo and then build it', turnId: 't-1' }
const complete: TurnCompleteInput = {
  answer: 'done',
  durationMs: 4_200,
  isAborted: false,
  turnId: 't-1',
  reason: 'answer',
}
const run: CommandRunInput = {
  command: 'worklog',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
}

const pad = (n: number): string => String(n).padStart(2, '0')
const today = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The lower hooks every test needs: the world beneath the mod. */
const world = (on: Parameters<Parameters<typeof test>[1]>[1], files: Map<string, string>) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.read', ($, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))
}

describe('register', () => {
  test('appends one line per turn, counting tools and denials', async ($, on) => {
    const files = new Map<string, string>()
    world(on, files)
    on('tool.call', ($, e) => (e.tool === 'Write' ? { deny: 'not here' } : { result: 'ok', text: 'ok' }))

    await $.session.start(session)
    await $.turn.start(start)
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.tool.call({ tool: 'Bash', command: 'make' })
    await $.tool.call({ tool: 'Write', file_path: '/work/x', content: 'x' })
    await $.turn.complete(complete)

    const [path, text] = [...files][0] ?? ['', '']
    // $.plugin.root is a Windows path here and the engine normalizes the path
    // before fs.write sees it, so assert on the parts, not on the separators.
    expect(path).toContain('worklog')
    expect(path).toContain(`${today()}.md`)
    expect(text).toContain(`# ${today()}`)
    expect(text).toContain('(4.2s, answer) Bash x2, Write, 1 denied — list the repo and then build it')
  })

  test('/worklog prints the day file, and says so when there is none', async ($, on) => {
    const files = new Map<string, string>()
    world(on, files)
    on('tool.call', () => ({ result: 'ok', text: 'ok' }))

    await $.session.start(session)
    const empty = await $.command.run(run)
    expect(empty.text).toContain('work-log: no log yet')

    await $.turn.start(start)
    await $.turn.complete(complete)
    const filled = await $.command.run(run)
    expect(filled.text).toContain(`# ${today()}`)
    expect(filled.text).toContain('list the repo and then build it')
  })
})
