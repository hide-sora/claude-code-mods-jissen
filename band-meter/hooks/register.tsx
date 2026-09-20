/* @jsx h */
import type { Register, SessionRateLimit } from 'claude-code'

// band-meter draws one row above the prompt: how full the context window is,
// how much of the 5 hour and 7 day rate-limit windows is used, and what the
// session has cost. `/meter` hides the row and shows it again.

const CELLS = 8

/** `████░░░░` for a percentage, eight cells wide. */
function bar(percent: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * CELLS)
  return '█'.repeat(filled) + '░'.repeat(CELLS - filled)
}

/** `42%`, or `--` for a figure the engine has not reported yet. */
const asPercent = (value: number | undefined) =>
  value === undefined ? '--' : `${Math.round(value)}%`

const windowOf = (limits: readonly SessionRateLimit[], kind: string) =>
  limits.find(limit => limit.kind === kind)?.percentUsed

// The last measurement, kept in the module so every redraw is free.
const meter = {
  context: 0,
  fiveHour: undefined as number | undefined,
  sevenDay: undefined as number | undefined,
  usd: undefined as number | undefined,
}

// Whether the row is drawn; `/meter` toggles it and $.store remembers it.
let shown = true

/** `ctx ████░░░░ 42%  5h 61%  7d 18%  $0.42` */
function line(): string {
  const parts = [
    `ctx ${bar(meter.context)} ${asPercent(meter.context)}`,
    `5h ${asPercent(meter.fiveHour)}`,
    `7d ${asPercent(meter.sevenDay)}`,
  ]
  if (meter.usd !== undefined) parts.push(`$${meter.usd.toFixed(2)}`)
  return parts.join('  ')
}

export const register: Register = on => {
  // One reading at the start, so the row has figures before the first turn.
  on('session.start', async ($, e, next) => {
    const started = await next(e)

    shown = (await $.store.get('shown')) !== false

    const usage = await $.session.usage()
    meter.context = usage.context.percent ?? 0
    meter.fiveHour = windowOf(usage.rateLimits, 'five_hour')
    meter.sevenDay = windowOf(usage.rateLimits, 'seven_day')
    meter.usd = usage.cost?.usd

    await $.command.register({
      name: 'meter',
      description: 'Show or hide the band-meter row above the prompt.',
    })

    return started
  })

  // `/meter`: no core command answers this name, so the hook answers alone.
  on('command.run', { command: 'meter' }, async ($, e, next) => {
    shown = !shown
    await $.store.set('shown', shown)
    $.ui.invalidate('ui.render')

    return { text: `band-meter: ${shown ? 'shown' : 'hidden'}` }
  })

  // The engine measures the session whenever a unit moves; observe and redraw.
  on('session.measure', ($, e, next) => {
    meter.context = e.context.percent ?? meter.context
    meter.fiveHour = windowOf(e.rateLimits, 'five_hour') ?? meter.fiveHour
    meter.sevenDay = windowOf(e.rateLimits, 'seven_day') ?? meter.sevenDay
    meter.usd = e.cost?.usd ?? meter.usd
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Whatever drew beneath is kept and wrapped; a survey owns the band alone.
    const drawn = await next(e)
    if (!shown || e.props.hasSurvey || e.props.maxRows < 1) return drawn

    const { Box, Button, Text } = $.ui.resolve(e)
    // One row: the text sized to the band's own width, less room for [ hide ].
    const text = line().slice(0, Math.max(12, e.props.bodyColumns - 10))

    return (
      <Box flexDirection="column">
        {drawn}
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>{text}</Text>
          <Button
            key="hide"
            label="hide"
            onPress={() => {
              // The press reaches this closure last, under `ui.press`.
              shown = false
              $.ui.invalidate('ui.render')
              $.store
                .set('shown', false)
                .catch(() => $.ui.log('band-meter: could not store `shown`', { to: 'debug' }))
            }}
          />
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
