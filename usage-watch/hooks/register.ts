import type { Register } from 'claude-code'

/** The steps a window is warned at, highest first, so 93% reports 90 once. */
const STEPS = [90, 80] as const

/** The $.store key holding the last step each window was warned at. */
const KEY = 'crossedSteps'

/** Short names for the windows the engine reports. */
const SHORT: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: 'spend',
}

/** The highest step `percent` has reached, or 0 below them all. */
const stepOf = (percent: number): number => STEPS.find(step => percent >= step) ?? 0

export const register: Register = on => {
  // Mirrors the store, so a burst of measurements does not re-read it. The
  // store is what survives a restart; this is what makes the edge cheap.
  let crossed: Record<string, number> = {}

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const saved = await $.store.get(KEY)
    if (saved !== null && typeof saved === 'object') {
      crossed = { ...(saved as Record<string, number>) }
    }
    // Read the op once so the book can print the real shape of what it answers.
    const usage = await $.session.usage()
    const empty = usage.rateLimits.length === 0
    await $.fs.write(
      `${$.plugin.root}/PROOF-usage.json`,
      `${JSON.stringify(usage, null, 2)}\n` +
        `// rateLimits was ${empty ? 'EMPTY' : `${usage.rateLimits.length} window(s)`}\n`,
    )
    return r
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('session.measure', async ($, e, next) => {
    const r = await next(e)

    const parts = [`ctx ${e.context.percent ?? 0}%`]
    for (const window of e.rateLimits) {
      parts.push(`${SHORT[window.kind] ?? window.kind} ${window.percentUsed}%`)
    }
    if (e.cost !== undefined) parts.push(`$${e.cost.usd.toFixed(2)}`)
    const text = parts.join(' | ')
    $.ui.status(text)

    // Rising edge only: a window that falls back below a step re-arms it.
    for (const window of e.rateLimits) {
      const step = stepOf(window.percentUsed)
      if (step > (crossed[window.kind] ?? 0)) {
        $.ui.toast(`usage-watch: ${SHORT[window.kind] ?? window.kind} at ${window.percentUsed}% of the window`)
      }
      crossed[window.kind] = step
    }
    await $.store.set(KEY, crossed)

    const path = `${$.plugin.root}/PROOF-measure.log`
    const line = `${new Date().toISOString()} changed=[${e.changed.join(',')}] ${text}\n`
    const prior = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
    await $.fs.write(path, `${prior}${line}`)

    return r
  }).catch(($, e, next) => (next.called ? undefined : next(e)))
}
