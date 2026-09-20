# work-log — build notes

Same environment as usage-watch: Claude Code **2.1.278**, Windows 11, Git Bash,
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` set globally. Nothing outside
`C:/Users/lifes/kasegu` was changed — including the option proof, which uses a
`--settings` file kept inside this folder rather than touching
`~/.claude/settings.json`.

## 1. Validator output (verbatim)

```
> cd C:/Users/lifes/kasegu/mods/work-log && claude plugin validate .
Validating plugin manifest: C:\Users\lifes\kasegu\mods\work-log\.claude-plugin\plugin.json

Validating hooks: C:\Users\lifes\kasegu\mods\work-log\hooks\hooks.json

  > ./register.ts hooks: session.start, turn.start, tool.call, turn.complete, command.run{command=worklog}
  > ./register.ts calls: $.command.register, $.fs.exists, $.fs.read, $.fs.write

Validation passed
```

(`>` stands in for the binary's `❯` and the last line's `✔`.)

Exit 0, first attempt, with the typed form
`export const register: Register = (on, options) => {...}`. The validator prints
the matcher inline — `command.run{command=worklog}` — which is how you confirm a
matcher narrowed as intended without running anything.

## 2. Proof run A — the log gets written

```sh
cd C:/Users/lifes/kasegu
rm -rf mods/work-log/worklog mods/work-log/debug.log
timeout 170 claude -p "Run the bash command: echo work-log-proof . Then run it a second time. Then reply with exactly: done." \
  --plugin-dir C:/Users/lifes/kasegu/mods/work-log \
  --output-format text --allowedTools "Bash,Read,Write" \
  --debug-file C:/Users/lifes/kasegu/mods/work-log/debug.log < /dev/null
```

Exit 0, stdout `done.`. `worklog/2026-09-21.md` did not exist before the run and
afterwards held:

```markdown
# 2026-09-21

- 01:07:01 (6.2s, answer) Bash x2 — Run the bash command: echo work-log-proof . Then run it a se
```

`Bash x2` is the `tool.call` counter; `answer` is `e.reason`; `6.2s` is
`e.durationMs`; the tail is the first 60 characters of `turn.start`'s `e.text`.

Debug log, settled lines:

```
[DEBUG] hooks module work-log@inline loaded (worker, environment 1, tier user); events: session.start,turn.start,tool.call,turn.complete,command.run
[DEBUG] plugin.register: work-log (user, work-log@inline), judged by core alone: admitted
[DEBUG] $.command.register (work-log): /worklog listed
[DEBUG] hooks module work-log@inline session.start settled in 24.3ms (worker hop, next() included)
[DEBUG] hooks module work-log@inline turn.start settled in 13.1ms (worker hop, next() included)
[DEBUG] hooks module work-log@inline tool.call settled in 1017.1ms (worker hop, next() included)
[DEBUG] hooks module work-log@inline tool.call settled in 1196.3ms (worker hop, next() included)
[DEBUG] $.fs.write (work-log): C:\Users\lifes\kasegu\mods\work-log\worklog\2026-09-21.md (113 bytes)
[DEBUG] hooks module work-log@inline turn.complete settled in 2.8ms (worker hop, next() included)
```

No `hook failed` line. Two things worth pointing at:

- **`$.command.register` works in a headless run.** `/worklog listed` is logged
  even though nobody can type it. Registration is not gated on a terminal.
- **The `tool.call` timings include the tool.** 1017 ms and 1196 ms are the Bash
  calls themselves; the hook's own work is the few microseconds after
  `await next(e)`. "settled in" is wall clock for the whole link, `next()`
  included, as the line says.
- **`$.fs.write` created `worklog/`.** The directory did not exist. The types say
  "creating it and its directories as needed" and it does.

## 3. Proof run B — `command.run` fires, headless, for real

The brief said a slash command cannot be typed in a `-p` run. It turns out it
can, and the first attempt failed for a reason that has nothing to do with
Claude Code.

```sh
claude -p "/worklog" --plugin-dir ... --output-format text --debug-file ...
```

The model answered a confused essay about `C:/Program Files/Git/worklog`. **Git
Bash (MSYS2) rewrote the argument.** A lone `/worklog` looks like a Unix
absolute path, so the shell converted it to the Windows path of the Git
installation root plus `worklog` before `claude` ever saw it. The debug log
showed `turn.start` and two `tool.call`s but no `command.run`.

With the conversion switched off:

```sh
MSYS_NO_PATHCONV=1 timeout 170 claude -p "/worklog" \
  --plugin-dir C:/Users/lifes/kasegu/mods/work-log \
  --output-format text --allowedTools "Read" \
  --debug-file C:/Users/lifes/kasegu/mods/work-log/debug-command2.log < /dev/null
```

stdout, verbatim:

```
work-log: # 2026-09-21

- 01:07:01 (6.2s, answer) Bash x2 — Run the bash command: echo work-log-proof . Then run it a se
- 01:07:36 (16.4s, answer) Glob, PowerShell, 1 errored — C:/Program Files/Git/worklog
```

and the debug log:

```
[DEBUG] $.command.register (work-log): /worklog listed
[DEBUG] work-log (user) answered command.run without next() in 1.5ms; nothing beneath it ran for this dispatch
[DEBUG] hooks module work-log@inline command.run settled in 2.0ms (worker hop, next() included)
```

Three things this proves at once:

1. **A `-p` prompt that starts with `/` runs the slash command**, plugin-defined
   ones included. No terminal needed.
2. **A hook that answers without `next` is announced**, by name and tier:
   `answered command.run without next() in 1.5ms; nothing beneath it ran for
   this dispatch`. That is the engine telling you the side effect did not
   happen — exactly the line to look for when a mod swallows something it
   should have passed on.
3. **The plugin's name prefixes the output.** `work-log: ` is prepended by the
   engine, not by the mod, because a non-bundled plugin's `{ text }` is shown
   "under the names of the plugins hooking the command". Do not put the mod's
   own name in the text — it gets said twice.

The second log line also shows the error counter working: the previous turn's
`PowerShell` call failed and `1 errored` was recorded from `r.isError`.

## 4. Proof run C — `userConfig` options really arrive

The debug log tells you where options are read from. Without `userConfig` in the
manifest (usage-watch), the line is a WARN; with it, a DEBUG that names the
exact lookup:

```
[DEBUG] plugin work-log: no pluginConfigs["work-log" or "work-log@inline"].options in user, --settings or managed settings (project settings are not read); every option is its default
```

So the key is `pluginConfigs["<name>"]` or `pluginConfigs["<name>@<source>"]`,
the value is `.options`, and **project settings are not read** — which is worth
stating in the book, because a `.claude/settings.json` in the repo is the first
place most people would put it.

`--settings` takes a file, so the option could be proven without editing
anything in `~/.claude`. `proof-settings.json`, kept beside the mod:

```json
{
  "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" },
  "pluginConfigs": {
    "work-log@inline": {
      "options": { "logDir": "C:/Users/lifes/kasegu/mods/work-log/custom-log" }
    }
  }
}
```

```sh
rm -rf mods/work-log/custom-log
timeout 170 claude -p "Reply with exactly: option proof." \
  --plugin-dir C:/Users/lifes/kasegu/mods/work-log \
  --settings C:/Users/lifes/kasegu/mods/work-log/proof-settings.json \
  --output-format text --allowedTools "Read" \
  --debug-file C:/Users/lifes/kasegu/mods/work-log/debug-options.log < /dev/null
```

The "no pluginConfigs..." line was gone for `work-log` (it still appeared for
`agents-md`, which had no options set), and the write landed in the configured
directory:

```
[DEBUG] $.fs.write (work-log): C:\Users\lifes\kasegu\mods\work-log\custom-log\2026-09-21.md (87 bytes)
```

```markdown
# 2026-09-21

- 01:09:21 (3.6s, answer) no tools — Reply with exactly: option proof.
```

**How the options arrive, exactly:** as the second argument of
`register(on, options)`, typed
`Readonly<Record<string, string | number | boolean | readonly string[]>>`
(`PluginOptions`, d.ts:6137). They are plain values, already defaulted by the
host, and `register` is re-run with a new object when the person changes them —
so read them into a `const` at the top of `register` and let the hooks close
over it, which is what this mod does.

## 5. Tests

```
> cd C:/Users/lifes/kasegu/mods/work-log && claude plugin test .
tests\register.test.ts:
(pass) register > appends one line per turn, counting tools and denials [50.05ms]
(pass) register > /worklog prints the day file, and says so when there is none [20.41ms]

 2 pass
 0 fail
Ran 2 tests across 1 file. [0.32s]
```

`$.command.run({ command: 'worklog', args: '', origin, presentation })` **is**
allowed by the test kit — `Engine` is `EventCalls` mapped
(d.ts:11369 in the `claude-code/testing` block), and `EventCalls.command.run` is
declared at d.ts:3824. `origin` and `presentation` are pinned fields a plugin
never passes at runtime but a test must supply:

```ts
const run: CommandRunInput = {
  command: 'worklog',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
}
```

The deny path is driven by making the lower `tool.call` hook refuse:

```ts
on('tool.call', ($, e) => (e.tool === 'Write' ? { deny: 'not here' } : { result: 'ok', text: 'ok' }))
```

which is how `1 denied` gets asserted without a real permission prompt.

## 6. Gotchas, with the exact text

### 6.1 The two different "options" lines

| Manifest | Line at load |
|---|---|
| no `userConfig` | `[WARN] plugin usage-watch: options requested but its manifest declares no userConfig; every option reads as absent` |
| `userConfig`, nothing set | `[DEBUG] plugin work-log: no pluginConfigs["work-log" or "work-log@inline"].options in user, --settings or managed settings (project settings are not read); every option is its default` |
| `userConfig`, value set | neither line |

The WARN is not about the shape of `register`. A control run with the `hello`
mod, whose `register` takes one parameter and imports no types, produced the
same WARN. See usage-watch's NOTES.md §4.2.

### 6.2 The path that reaches `fs.write` is normalized

The mod builds `${dir}/${dayOf(now)}.md` with forward slashes. What the
`fs.write` event carried was:

```
C:\Users\lifes\kasegu\mods\work-log\worklog\2026-09-21.md
```

all backslashes, because `$.plugin.root` is a Windows path and the engine
normalizes before dispatching. The first version of the test asserted

```ts
expect(path.endsWith(`/worklog/${today()}.md`)).toBe(true)
```

and failed with `Expected: true / Received: false` — no hint why. Re-running
with `expect(path).toBe('SHOW-ME')` to print the received value is the cheapest
way to see it:

```
Expected: "SHOW-ME"
Received: "C:\\Users\\lifes\\kasegu\\mods\\work-log\\worklog\\2026-09-21.md"
```

The fix was to assert on the parts (`toContain('worklog')`,
`toContain(`${today()}.md`)`) rather than on separators. Mixing separators in
the *input* is fine — the engine sorted it out — but never assert on them.

### 6.3 `tool.call` carries no `turnId`

`ToolCallInput` has `tool`, `tool_use_id`, the tool's own arguments and
`agentId` inside a subagent — but nothing that names the turn. So the counter
has to remember "the turn that started last" in module state and attribute calls
to it. Consequence to state plainly in the book: **a subagent's tool calls are
counted into the main turn that spawned it**, because every hook sees a
subagent's calls and `e.agentId` is the only way to tell them apart. This mod
deliberately does not, to keep the register under 90 lines; filtering on
`e.agentId === undefined` is the one-line change.

### 6.4 Count *after* `next`, not before

```ts
const r = await next(e)
turn.tools[e.tool] = (turn.tools[e.tool] ?? 0) + 1
if (r.deny !== undefined) turn.denied += 1
else if (r.isError === true) turn.errored += 1
```

`r.deny` and `r.isError` only exist on the result. Counting before `next` gives
you a tool tally with no idea whether anything ran. Both `deny` and `isError`
are declared on every branch of the `ToolCallResult` union (d.ts:9636-9707), so
`r.deny !== undefined` narrows without a cast.

### 6.5 `$.plugin.root` is only reachable from inside a hook

The default log directory is `<plugin root>/worklog`, but `$` exists only
inside a hook, and the validator refuses binding `$` or a noun of it to a name.
So the root is captured into a module-level `let dir` on the first
`session.start` and every later hook reads that variable. `turn.complete` guards
on `dir !== ''` so a turn that somehow completes before `session.start` writes
nothing instead of writing to `/YYYY-MM-DD.md`.

## 7. What did NOT work / is NOT proven

- **`claude -p "/worklog"` without `MSYS_NO_PATHCONV=1`** does not run the
  command on Git Bash. Recorded in full in §3; it is a shell problem, not a
  Claude Code one, but it will bite every Windows reader.
- **Only single-turn runs were observed.** `-p` is one turn, so the daily file
  accumulating many lines across a session is only shown by running the binary
  three times into the same file (which the artifacts above do — three separate
  runs, two files). Multi-turn accumulation inside one session is unproven.
- **Subagent attribution is unproven and, as built, wrong** (see §6.3). No
  subagent was spawned in any proof run.
- **`/worklog` was never typed in an interactive session.** The typeahead entry,
  the description text and how the output is framed on a real terminal are
  unproven; only the headless `command.run` dispatch is.
- **Nothing proves behaviour when two plugins register the same command name.**
  The types say "registering a name again replaces it; a built-in's name is
  refused"; `worklog` collided with nothing here.
- **No `tsconfig.json` / no `tsc` run**, as with usage-watch. The only
  type-adjacent check performed is whatever `claude plugin test` does when it
  loads the test file.

## 8. Every command run, in order

| # | Command | Result |
|---|---|---|
| 1 | `claude plugin validate .` | `Validation passed`, exit 0, first attempt |
| 2 | `claude -p "Run the bash command: echo work-log-proof ..." --plugin-dir ... --debug-file debug.log` | exit 0; `worklog/2026-09-21.md` written; no `hook failed` |
| 3 | `claude -p "/worklog" ... --debug-file debug-command.log` | **failed**: Git Bash turned `/worklog` into a path; no `command.run` |
| 4 | `MSYS_NO_PATHCONV=1 claude -p "/worklog" ... --debug-file debug-command2.log` | exit 0; command ran; output in §3 |
| 5 | `claude -p "Reply with exactly: option proof." --settings proof-settings.json ...` | exit 0; write landed in `custom-log/` |
| 6 | `claude plugin test .` | first run 1 pass 1 fail (§6.2), then 2 pass 0 fail |
