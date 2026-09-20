import type { Register } from 'claude-code'


// A cheap filter, not the decision: it only picks what is worth one model
// call. Note the trailing \b -- it costs this pattern `dd if=/dev/zero`,
// because `=` is not a word character (see NOTES.md).
const TRIGGER =
  /\b(rm|rmdir|del|rd|git\s+(push\s+.*--force|reset\s+--hard|clean\s+-f|branch\s+-D)|DROP\s+(TABLE|DATABASE)|truncate|mkfs|dd\s+if=|chmod\s+-R\s+777|curl[^|]*\|\s*(sh|bash)|Remove-Item|Format-Volume)\b/i

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = typeof e.command === 'string' ? e.command : ''
    if (!TRIGGER.test(command)) return next(e)

    // The bare command alone reads as routine housekeeping to the judge: it
    // labelled `rm -rf <folder>` "safe" until this framing was added.
    const question =
      'A coding agent wants to run this shell command on a developer\'s machine.\n' +
      'destructive = it irreversibly deletes, overwrites or discards data or history.\n' +
      'safe = it only reads, lists, prints or creates.\n\n' +
      `Command: ${command}`

    const started = Date.now()
    let verdict: string | undefined
    let failure = ''
    try {
      verdict = await $.model.classify(question, ['safe', 'destructive'], { model: 'haiku' })
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
    const ms = Date.now() - started

    const decision =
      failure !== '' ? 'DENY(judge-unavailable)'
      : verdict === 'destructive' ? 'DENY(destructive)'
      : verdict === undefined ? 'allow(no-label)'
      : 'allow(safe)'

    const before = await $.fs.read(`${$.plugin.root}/PROOF-guard.log`).catch(() => '')
    const note = failure === '' ? '' : ` error=${failure}`
    await $.fs.write(
      `${$.plugin.root}/PROOF-guard.log`,
      `${before}${new Date().toISOString()} ${ms}ms verdict=${verdict ?? 'undefined'} ` +
        `decision=${decision} cmd=${JSON.stringify(command)}${note}\n`,
    )

    // Fail closed: an unreachable judge is not a pass.
    if (failure !== '') {
      return { deny: `intent-guard: the intent judge could not answer (${failure}), so the command was refused rather than guessed at` }
    }
    if (verdict === 'destructive') {
      return { deny: `intent-guard: an LLM judge read this command as destructive, so it was not run: ${command}` }
    }
    return next(e)
  }).catch(($, e, next) => {
    // The hook threw, misreturned or outran its 10 s budget. Same rule: a
    // guard that cannot decide refuses. Never replay next(e) here -- that is
    // the unjudged command running after the guard has already failed.
    return { deny: `intent-guard: the guard itself failed (${next.error.kind}: ${next.error.message ?? 'no message'}), so the Bash command was refused unjudged` }
  })
}
