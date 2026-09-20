import type { Register } from 'claude-code'

// The store is this plugin's own JSON file under the user's Claude Code
// configuration directory, so a note written in one session is read in the
// next one. Nothing else in the session can reach it.
const KEY = 'notes'

type Note = { text: string; at: string }

const read = (raw: unknown): Note[] => (Array.isArray(raw) ? (raw as Note[]) : [])

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.tool.register({
      name: 'note_add',
      description: 'Save a short note for later in this project. Input: { text }',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    })
    await $.tool.register({
      name: 'note_list',
      description: 'List every note saved so far in this project. No input.',
      inputSchema: { type: 'object', properties: {} },
    })
    await $.command.register({
      name: 'notes',
      description: 'List saved notes (notes-tool)',
    })
    return r
  })

  // A tool.call hook that answers without `next` is the tool: core validates
  // the answer, maps it for the model and records it as the tool's result.
  on('tool.call', { tool: 'mcp__notes-tool__note_add' }, async ($, e) => {
    const text = String(e.text ?? '').trim()
    if (text === '') return { deny: 'note_add needs a non-empty text' }
    const notes = read(await $.store.get(KEY))
    notes.push({ text, at: new Date().toISOString() })
    await $.store.set(KEY, notes)
    return { result: `saved note ${notes.length}: ${text}` }
  })

  on('tool.call', { tool: 'mcp__notes-tool__note_list' }, async ($, e) => {
    const notes = read(await $.store.get(KEY))
    if (notes.length === 0) return { result: 'no notes saved yet' }
    return { result: notes.map((n, i) => `${i + 1}. ${n.text}`).join('\n') }
  })

  on('command.run', { command: 'notes' }, async ($, e) => {
    const notes = read(await $.store.get(KEY))
    return {
      text:
        notes.length === 0
          ? 'notes-tool: nothing saved yet'
          : notes.map((n, i) => `${i + 1}. ${n.text}  (${n.at})`).join('\n'),
    }
  })
}
