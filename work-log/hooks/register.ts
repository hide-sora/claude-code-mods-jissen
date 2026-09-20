import type { Register } from 'claude-code'

/** What one turn accumulated between `turn.start` and `turn.complete`. */
type Turn = { text: string; tools: Record<string, number>; denied: number; errored: number }

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local calendar day, the log file's name. */
const dayOf = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local wall-clock time, the first column of a line. */
const timeOf = (ms: number): string => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** `Bash x2, Read` — the tools of one turn, busiest first. */
const toolsOf = (tools: Record<string, number>): string =>
  Object.entries(tools)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => (n > 1 ? `${name} x${n}` : name))
    .join(', ') || 'no tools'

export const register: Register = (on, options) => {
  // The manifest's userConfig arrives here; an empty string means "use my own
  // directory", which needs $.plugin.root and so waits for a hook to run.
  const configured = typeof options.logDir === 'string' ? options.logDir.trim() : ''
  let dir = configured

  const turns = new Map<string, Turn>()
  // tool.call carries no turnId, so tools land on the turn that started last.
  let current: string | null = null

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    if (dir === '') dir = `${$.plugin.root}/worklog`
    await $.command.register({ name: 'worklog', description: "Print today's work log (work-log)" })
    return r
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    current = e.turnId
    turns.set(e.turnId, { text: e.text, tools: {}, denied: 0, errored: 0 })
    return r
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  // No matcher: this counts every tool, so it sees every call. It reads the
  // name and the outcome only, never a tool's arguments.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    const turn = current === null ? undefined : turns.get(current)
    if (turn !== undefined) {
      turn.tools[e.tool] = (turn.tools[e.tool] ?? 0) + 1
      if (r.deny !== undefined) turn.denied += 1
      else if (r.isError === true) turn.errored += 1
    }
    return r
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const turn = turns.get(e.turnId)
    turns.delete(e.turnId)
    if (turn !== undefined && dir !== '') {
      const now = Date.now()
      const flags = [turn.denied > 0 ? `${turn.denied} denied` : '', turn.errored > 0 ? `${turn.errored} errored` : '']
      const line =
        `- ${timeOf(now)} (${(e.durationMs / 1000).toFixed(1)}s, ${e.reason}) ` +
        `${toolsOf(turn.tools)}${flags.filter(Boolean).map(f => `, ${f}`).join('')} ` +
        `— ${turn.text.replace(/\s+/g, ' ').slice(0, 60)}\n`
      const path = `${dir}/${dayOf(now)}.md`
      const prior = (await $.fs.exists(path)) ? await $.fs.read(path) : `# ${dayOf(now)}\n\n`
      await $.fs.write(path, `${prior}${line}`)
    }
    return r
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('command.run', { command: 'worklog' }, async $ => {
    const path = `${dir}/${dayOf(Date.now())}.md`
    if (dir === '' || !(await $.fs.exists(path))) return { text: `no log yet (${path})` }
    return { text: await $.fs.read(path) }
  }).catch(($, e, next) => (next.called ? undefined : { text: 'could not read the log' }))
}
