import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { SessionMeasureInput, SessionStartInput, SessionUsage } from 'claude-code'

tier('user')

const session: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }

const usage: SessionUsage = {
  context: { tokens: 12_000, window: 200_000, percent: 6 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 19 }],
  cost: { usd: 0.25 },
}

/** One measurement, the fields `session.measure` always carries. */
const measure = (percentUsed: number): SessionMeasureInput => ({
  context: { tokens: 84_000, window: 200_000, percent: 42 },
  rateLimits: [{ kind: 'five_hour', percentUsed }],
  cost: { usd: 0.42 },
  changed: ['rateLimits'],
})

describe('register', () => {
  test('pins the status line and appends one proof line per measurement', async ($, on) => {
    const files = new Map<string, string>()
    const status: (string | undefined)[] = []
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: usage }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('ui.status', ($, e) => (status.push(e.text), { value: undefined }))
    on('ui.toast', () => ({ value: undefined }))
    on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
    on('fs.read', ($, e) => ({ value: files.get(e.path) ?? '' }))
    on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))

    await $.session.start(session)
    await $.session.measure(measure(19))
    await $.session.measure(measure(20))

    expect(status).toEqual(['ctx 42% | 5h 19% | $0.42', 'ctx 42% | 5h 20% | $0.42'])
    const log = [...files].find(([path]) => path.endsWith('PROOF-measure.log'))?.[1] ?? ''
    expect(log.trimEnd().split('\n')).toHaveLength(2)
    expect(log).toContain('changed=[rateLimits] ctx 42% | 5h 20% | $0.42')
  })

  test('toasts on the rising edge only, once per step', async ($, on) => {
    const toasts: string[] = []
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: usage }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
    on('fs.exists', () => ({ value: false }))
    on('fs.read', () => ({ value: '' }))
    on('fs.write', () => ({ value: undefined }))

    await $.session.start(session)
    await $.session.measure(measure(79))
    await $.session.measure(measure(83))
    await $.session.measure(measure(88))
    await $.session.measure(measure(91))

    expect(toasts).toEqual([
      'usage-watch: 5h at 83% of the window',
      'usage-watch: 5h at 91% of the window',
    ])
  })
})
