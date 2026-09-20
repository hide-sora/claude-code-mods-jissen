# usage-watch — build notes

Everything here was run on the real binary: Claude Code **2.1.278**, Windows 11,
Git Bash, `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` set globally in
`~/.claude/settings.json`. Nothing outside `C:/Users/lifes/kasegu` was changed.

## 1. Validator output (verbatim)

```
> cd C:/Users/lifes/kasegu/mods/usage-watch && claude plugin validate .
Validating plugin manifest: C:\Users\lifes\kasegu\mods\usage-watch\.claude-plugin\plugin.json

Validating hooks: C:\Users\lifes\kasegu\mods\usage-watch\hooks\hooks.json

  > ./register.ts hooks: session.start, session.measure
  > ./register.ts calls: $.fs.exists, $.fs.read, $.fs.write, $.session.usage, $.store.get, $.store.set, $.ui.status, $.ui.toast

Validation passed
```

(The two indented lines and the final line are printed with the binary's own
`❯` and `✔` glyphs; they are transcribed as `>` here so the file stays plain.)

Exit code 0, no warnings. It passed on the **first** attempt with the typed
form — `import type { Register } from 'claude-code'` plus
`export const register: Register = on => {...}`. No fallback to an untyped
signature was needed.

## 2. Proof run

```sh
cd C:/Users/lifes/kasegu
rm -f mods/usage-watch/PROOF-usage.json mods/usage-watch/PROOF-measure.log mods/usage-watch/debug.log
timeout 170 claude -p "Reply with exactly: usage-watch proof run. Do not use any tools." \
  --plugin-dir C:/Users/lifes/kasegu/mods/usage-watch \
  --output-format text --allowedTools "Bash,Read,Write" \
  --debug-file C:/Users/lifes/kasegu/mods/usage-watch/debug.log < /dev/null
```

Exit 0. stdout was `usage-watch proof run`.

### `PROOF-usage.json` — what `$.session.usage()` really answers at `session.start`

```json
{
  "context": {
    "window": 1000000
  },
  "rateLimits": [],
  "cost": {
    "usd": 0
  }
}
// rateLimits was EMPTY
```

This is the headline finding for the chapter: **at `session.start` the op has
almost nothing**. `context` carries only `window` — no `tokens`, no `percent`,
because no response of the live window has reported one yet. `rateLimits` is an
empty array, not missing and not zeroed; the windows only exist once an API
response has reported them. `cost` is present with `usd: 0` (the CLI always
keeps a ledger). A status line built at `session.start` would print nothing
useful; that is exactly why `session.measure` exists.

### `PROOF-measure.log` — `session.measure` DOES fire in a `-p` run

```
2026-09-20T16:04:55.037Z changed=[context,rateLimits,cost] ctx 5% | 5h 19% | 7d 16% | $0.25
```

One line, one measurement, after the single turn of the `-p` run. `changed`
carried all three units because it was the first measurement ("the first
measurement names every unit it has a figure for"). By this point `rateLimits`
had two real windows (`five_hour` 19%, `seven_day` 16%), which the
`session.start` reading four seconds earlier did not have.

### Debug log, the settled lines

```
[DEBUG] hooks module usage-watch@inline loaded (worker, environment 1, tier user); events: session.start,session.measure
[DEBUG] engine.create: no plugin-provided interfaces; $ built for usage-watch,jev-model-router,agents-md
[DEBUG] plugin.register: usage-watch (user, usage-watch@inline), judged by core alone: admitted
[DEBUG] session.start: raised (surface none, not interactive)
[DEBUG] $.fs.write (usage-watch): C:\Users\lifes\kasegu\mods\usage-watch\PROOF-usage.json (119 bytes)
[DEBUG] hooks module usage-watch@inline session.start settled in 19.9ms (worker hop, next() included)
[DEBUG] $.ui.status (usage-watch): ctx 5% | 5h 19% | 7d 16% | $0.25
[DEBUG] $.ui.status (usage-watch): no status row in a headless session; kept here: ctx 5% | 5h 19% | 7d 16% | $0.25
[DEBUG] $.store.set (usage-watch@inline): crossedSteps
[DEBUG] $.fs.write (usage-watch): C:\Users\lifes\kasegu\mods\usage-watch\PROOF-measure.log (92 bytes)
[DEBUG] hooks module usage-watch@inline session.measure settled in 15.2ms (worker hop, next() included)
```

`grep -nE "hook failed|usage-watch" debug.log` found **no** `hook failed` line.

Note that `$.store.get` produced no debug line at `session.start` while
`$.store.set` did. Reads of an unset key appear to be silent; do not read the
absence of a `$.store.get` line as the call not happening.

## 3. Tests

```
> cd C:/Users/lifes/kasegu/mods/usage-watch && claude plugin test .
tests\register.test.ts:
(pass) register > pins the status line and appends one proof line per measurement [42.36ms]
(pass) register > toasts on the rising edge only, once per step [22.72ms]

 2 pass
 0 fail
Ran 2 tests across 1 file. [0.28s]
```

Both passed on the first run. `$.session.measure(input)` is available on the
test engine (the `Engine` type is `EventCalls` mapped, and
`EventCalls.session.measure` is declared at d.ts:3855), which is what makes the
80/90% edge testable at all — the real account sat at 19%, so the toast could
never have fired in a live run. The test drives 79 → 83 → 88 → 91 and asserts
exactly two toasts.

Op events answer `{ value }` in a test, not a bare value:

```ts
on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
on('ui.status', ($, e) => (status.push(e.text), { value: undefined }))
```

Chain events answer their own result type instead
(`on('session.measure', ($, e) => ({ changed: e.changed }))`). Getting this
backwards is the fastest way to a confusing failure, because the kit throws
naming the event, not the shape.

## 4. Gotchas, with the exact text

### 4.1 `$.ui.status` is not silently dropped in headless — it says so

```
[DEBUG] $.ui.status (usage-watch): no status row in a headless session; kept here: ctx 5% | 5h 19% | 7d 16% | $0.25
```

Two lines are logged per call: the call itself, then the reason nothing drew,
with the text repeated. So in a `-p` run the debug log *is* the status line.
That is a cheaper proof than writing a file, though this mod does both.

### 4.2 `[WARN] plugin <name>: options requested but its manifest declares no userConfig`

Seen at load:

```
[WARN] plugin usage-watch: options requested but its manifest declares no userConfig; every option reads as absent
```

First read: "the typed `Register` signature declares `(on, options)`, so the
engine thinks I asked for options." That is **wrong**. A control run with the
`hello` mod — whose source is `export function register(on: any)`, one
parameter, no type import — produced the identical line:

```
[WARN] plugin hello-mod: options requested but its manifest declares no userConfig; every option reads as absent
```

So the engine always builds an options object for every plugin and warns when
the manifest declares none. It is noise, not a defect, and it is replaced by a
calmer DEBUG line the moment `userConfig` is added (see work-log's NOTES.md
§4.1). Do not restructure `register` to chase it.

### 4.3 The rising edge needs the *step*, not the percentage

Remembering "the last percentage seen" re-toasts on every single point of
movement (83 → 84 → 85 …). Remembering the last *threshold crossed*
(`stepOf` returns 90, 80 or 0) gives one toast per step, and assigning the step
back unconditionally — not only when it rises — re-arms the warning if the
window falls back down after a reset. Both halves are one line each and both
are covered by the second test.

### 4.4 `changed` is the cheap filter, and it is never empty

`e.changed` is `UsageUnit[]` = `('context' | 'rateLimits' | 'cost')[]`
(d.ts:11021). A mod that only cares about plan limits can bail on
`!e.changed.includes('rateLimits')` and never touch the store. This mod logs
`changed` verbatim instead, because the book wants to show what it actually
contains — and the first measurement of a session contains all three.

### 4.5 `.catch` on an observe-only hook

```ts
.catch(($, e, next) => (next.called ? undefined : next(e)))
```

`undefined` from a `.catch` handler means "the hook was absent" (d.ts:876-883),
so the run that already happened stands. If `next` had not been called yet the
handler calls it, so the chain below still runs. This is the whole safety net
for an observe-only hook and it fits on one line.

### 4.6 `$.plugin.root` reads fine inside a template literal

`${$.plugin.root}/PROOF-usage.json` passes the validator. `$.plugin.name` and
`$.plugin.root` are string *properties*, not functions, and the scanner treats
reading them as it treats `$.noun.verb(...)`. What it refuses is binding `$` or
a noun of it to a name — so the path has to be spelled at each call site.

## 5. What did NOT work / is NOT proven

- **The 80% and 90% toasts were never seen live.** The account's windows were at
  19% and 16% during every proof run, and there is no way to move them on
  demand. They are proven by `claude plugin test` only. The debug log
  consequently has no `$.ui.toast (usage-watch)` line.
- **Nothing was drawn.** `-p` has no status row and no notification bar, as the
  debug line in §4.1 says outright. Whether the pinned line looks right in a
  real terminal is unproven here.
- **Only one `session.measure` per `-p` run was observed.** A `-p` run is one
  turn, and the event fires "after each main-thread turn". The
  burst-folding behaviour the types describe ("one at a time, a burst folding
  into one more") was never exercised.
- **`context.breakdown` was not used.** `$.session.usage({ breakdown: "full" })`
  sends one token-count request per tool and memory file; the plain call is
  free, and a hook that runs after every turn should stay free.
- **No `tsconfig.json` was added**, so the sources were never type-checked with
  `tsc`. `claude plugin validate` and `claude plugin test` both accepted them;
  `claude plugin test` does parse the test file (an unterminated string literal
  in an earlier draft of work-log's test was reported as
  `(fail) the file did not load / Unterminated string literal (line 55, column 33)`),
  but that is a parse, not a full type-check.

## 6. Every command run, in order

| # | Command | Result |
|---|---|---|
| 1 | `claude plugin validate .` | `Validation passed`, exit 0, first attempt |
| 2 | `claude -p "Reply with exactly: usage-watch proof run..." --plugin-dir ... --debug-file ...` | exit 0; both proof files written; no `hook failed` |
| 3 | `cat PROOF-usage.json` and `cat PROOF-measure.log` | contents in §2 |
| 4 | `grep -nE "hook failed\|usage-watch" debug.log` | 12 matches, none a failure |
| 5 | `claude plugin test .` | 2 pass, 0 fail, first attempt |
| 6 | `claude -p "Reply with exactly: control run." --plugin-dir .../hello ...` | control for §4.2 |
