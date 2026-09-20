import type {
  CommandRunInput,
  On,
  RenderElement,
  RenderSurface,
  SessionStartInput,
  SessionUsage,
} from 'claude-code'
import type { MountTarget } from 'claude-code/testing'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

tier('user')

const SESSION: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }

const USAGE: SessionUsage = {
  context: { window: 200_000, tokens: 84_000, percent: 42 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 61 },
    { kind: 'seven_day', percentUsed: 18 },
  ],
  cost: { usd: 0.42 },
}

const METER: CommandRunInput = {
  command: 'meter',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
}

/** The band above the prompt on one surface, as the engine would draw it. */
const band = <P extends RenderSurface>(surface: P): MountTarget<P, 'AbovePrompt'> => ({
  plugin: 'band-meter',
  surface,
  component: 'AbovePrompt',
  requestId: 'band',
  viewport: { columns: 100, rows: 40 },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
})

/** The engine draws nothing of its own in the band; this stands in for it. */
const EMPTY: RenderElement = { type: 'Box', children: [] }

/** Everything the mod asks of the world beneath it. */
function beneath(on: On): void {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: USAGE }))
  on('ui.render', { component: 'AbovePrompt' }, () => EMPTY)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  mock.store(on, {})
}

describe('band-meter', () => {
  test('draws the meter and hides it when the button is pressed', async ($, on) => {
    beneath(on)
    await $.session.start(SESSION)

    const ui = await $.ui.mount(band('terminal'))

    const meter = await ui.find({ type: 'Text', text: /ctx/ })
    expect(meter, 'the meter row is drawn').toBeDefined()
    expect(meter?.text).toBe('ctx ███░░░░░ 42%  5h 61%  7d 18%  $0.42')
    expect((await ui.find({ key: 'hide' }))?.props.label).toBe('hide')

    expect(await ui.press({ key: 'hide' })).toEqual({ element: 'hide' })

    expect(await ui.find({ type: 'Text', text: /ctx/ }), 'gone after the press').toBeUndefined()
    expect(await ui.find({ key: 'hide' })).toBeUndefined()

    await ui.unmount()
  })

  test('draws on every surface whose table has Box, Text and Button', async ($, on) => {
    beneath(on)
    await $.session.start(SESSION)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount(band(surface))

      expect(await ui.find({ type: 'Text', text: /ctx/ }), surface).toBeDefined()

      await ui.press({ key: 'hide' })
      expect(await ui.find({ type: 'Text', text: /ctx/ }), surface).toBeUndefined()
      await ui.unmount()

      // `shown` lives in the module, so put it back for the next surface.
      await $.command.run(METER)
    }
  })

  test('/meter hides the row and shows it again', async ($, on) => {
    beneath(on)
    await $.session.start(SESSION)

    const ui = await $.ui.mount(band('terminal'))
    expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeDefined()

    expect(await $.command.run(METER)).toEqual({ text: 'band-meter: hidden' })
    expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()

    expect(await $.command.run(METER)).toEqual({ text: 'band-meter: shown' })
    expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeDefined()

    await ui.unmount()
  })

  test('a measurement moves the figures and redraws', async ($, on) => {
    beneath(on)
    await $.session.start(SESSION)

    const ui = await $.ui.mount(band('terminal'))

    await $.session.measure({
      context: { window: 200_000, tokens: 180_000, percent: 90 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 75 }],
      cost: { usd: 1.5 },
      changed: ['context', 'rateLimits', 'cost'],
    })

    const meter = await ui.find({ type: 'Text', text: /ctx/ })
    expect(meter?.text).toContain('90%')
    expect(meter?.text).toContain('5h 75%')
    expect(meter?.text, 'a window the measurement left out keeps its figure').toContain('7d 18%')
    expect(meter?.text).toContain('$1.50')

    await ui.unmount()
  })
})
