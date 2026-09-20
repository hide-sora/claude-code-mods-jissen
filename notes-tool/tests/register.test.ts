import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { CommandRunInput, SessionStartInput } from 'claude-code'

tier('user')

const session: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }
const notes = (): CommandRunInput => ({
  command: 'notes',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
})

describe('register', () => {
  test('registers both tools and the command at session.start', async ($, on) => {
    mock.store(on, {})
    const registered: string[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('tool.register', ($, e) => {
      registered.push(e.name)
      return { value: { tool: `mcp__notes-tool__${e.name}` } }
    })
    on('command.register', ($, e) => {
      registered.push(`/${e.name}`)
      return { value: { command: e.name } }
    })

    await $.session.start(session)

    expect(registered).toEqual(['note_add', 'note_list', '/notes'])
  })

  test('note_add saves, note_list reads back, and /notes shows the same notes', async ($, on) => {
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('tool.register', ($, e) => ({ value: { tool: `mcp__notes-tool__${e.name}` } }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))

    await $.session.start(session)
    const first = await $.tool.call({ tool: 'mcp__notes-tool__note_add', text: 'buy milk' })
    await $.tool.call({ tool: 'mcp__notes-tool__note_add', text: 'call mom' })
    const listed = await $.tool.call({ tool: 'mcp__notes-tool__note_list' })
    const { text } = await $.command.run(notes())

    expect(first.result).toBe('saved note 1: buy milk')
    expect(listed.result).toBe('1. buy milk\n2. call mom')
    expect(text).toContain('1. buy milk')
  })

  test('refuses an empty note instead of saving one', async ($, on) => {
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('tool.register', ($, e) => ({ value: { tool: `mcp__notes-tool__${e.name}` } }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))

    await $.session.start(session)
    const denied = await $.tool.call({ tool: 'mcp__notes-tool__note_add', text: '   ' })
    const listed = await $.tool.call({ tool: 'mcp__notes-tool__note_list' })

    expect(denied.deny).toContain('non-empty')
    expect(listed.result).toBe('no notes saved yet')
  })
})
