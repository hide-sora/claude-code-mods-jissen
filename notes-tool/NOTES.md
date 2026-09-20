# notes-tool — build notes

Claude Code 2.1.278, Windows 11, Git Bash,
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` set globally. Runs on 2026-09-20.

---

## 1. Validator output (verbatim)

```
$ cd C:/Users/lifes/kasegu/mods/notes-tool && claude plugin validate .
Validating plugin manifest: C:\Users\lifes\kasegu\mods\notes-tool\.claude-plugin\plugin.json

Validating hooks: C:\Users\lifes\kasegu\mods\notes-tool\hooks\hooks.json

  ❯ ./register.ts hooks: session.start, tool.call{tool=mcp__notes-tool__note_add}, tool.call{tool=mcp__notes-tool__note_list}, command.run{command=notes}
  ❯ ./register.ts calls: $.command.register, $.store.get, $.store.set, $.tool.register

✔ Validation passed
```

`import type { Register } from 'claude-code'` was accepted on the first try; no
untyped fallback was needed.

## 2. Test output (verbatim)

```
$ claude plugin test .
tests\register.test.ts:
(pass) register > registers both tools and the command at session.start [39.76ms]
(pass) register > note_add saves, note_list reads back, and /notes shows the same notes [20.03ms]
(pass) register > refuses an empty note instead of saving one [16.26ms]

 3 pass
 0 fail
Ran 3 tests across 1 file. [0.28s]
```

The world beneath the mod, as the tests build it:

```ts
mock.store(on, {})
on('session.start', ($, e) => ({ cwd: e.cwd }))
on('tool.register', ($, e) => ({ value: { tool: `mcp__notes-tool__${e.name}` } }))
on('command.register', ($, e) => ({ value: { command: e.name } }))
```

Every `$` op event (`tool.register`, `command.register`, `fs.write`, …) is
answered with `{ value: <OpValueOf[event]> }`, never with the bare value.
`OpValueOf['tool.register']` is `{ tool: string }` and
`OpValueOf['command.register']` is `{ command: string }`.

No lower `tool.call` hook is needed: the mod answers `tool.call` without
`next`, so nothing beneath it runs for those dispatches.

## 3. The tool.call answer shape — the thing to get right

**A `tool.call` hook that serves a registered tool returns `{ result }`, or
`{ deny }` to refuse. Not `{ text }`, not `{ content }`.**

From `ToolCallResult` (claude-code.d.ts ~9636):

> What a `tool.call` hook returns and what `next(e)` and `$.tool.call(input)`
> resolve to: the tool's result (`{ result, context? }`) or `{ deny }`.
> … Core validates a hook's answer against the tool's output schema when it
> has one, maps it for the model with the tool's own mapper, and records it in
> the transcript as the tool's result.

`text` and `ref` exist on that type but are **set by core**, on what `next(e)`
resolves to. A hook writes `result`; it does not write `text`. The
`agent.register` `@example` in the same file confirms the shape:
`return { result: deny ?? (await answerOf(agentId)) }`.

`command.run` is the other way round: it returns `{ text }` (plus optional
`context`), because a command's output is a transcript line, not a tool record.
Two events, two different answer keys, in the same 60-line file.

In this mod `result` is a plain string and the model read it verbatim (see §4).

## 4. Proof run 1 — two adds and a list, in one session

```
$ cd C:/Users/lifes/kasegu && timeout 170 claude -p "First call the tool note_add with text 'buy milk'. Then call note_add with text 'call mom'. Then call note_list and report exactly what it returned." \
    --plugin-dir C:/Users/lifes/kasegu/mods/notes-tool \
    --output-format text \
    --allowedTools "mcp__notes-tool__note_add,mcp__notes-tool__note_list" \
    --debug-file C:/Users/lifes/kasegu/mods/notes-tool/debug.log < /dev/null
```

The `--allowedTools "mcp__notes-tool__note_add,mcp__notes-tool__note_list"`
syntax **worked as written** — no fallback was needed.

Model reply (verbatim, abridged to the part that matters):

```
3回とも実行しました。

**実行結果**

1. `note_add`（text: `buy milk`）→ `saved note 1: buy milk`
2. `note_add`（text: `call mom`）→ `saved note 2: call mom`
3. `note_list` の返り値（そのまま）：

​```
1. buy milk
2. call mom
​```
```

Debug-log lines:

```
[DEBUG] hooks module notes-tool@inline loaded (worker, environment 1, tier user); events: session.start,tool.call,command.run
[DEBUG] plugin.register: notes-tool (user, notes-tool@inline), judged by core alone: admitted
[DEBUG] $.tool.register: loopback MCP server listening on 127.0.0.1:54214
[DEBUG] $.tool.register (notes-tool): 1 tool(s) served at 127.0.0.1:54214/<secret>/notes-tool v1
[DEBUG] $.tool.register (notes-tool): mcp__notes-tool__note_add (1 tool(s) on server "notes-tool"); connecting
[DEBUG] $.tool.register (notes-tool): mcp__notes-tool__note_add visible after 71ms
[DEBUG] $.tool.register (notes-tool): mcp__notes-tool__note_list (2 tool(s) on server "notes-tool"); connecting
[DEBUG] $.tool.register (notes-tool): mcp__notes-tool__note_list visible after 27ms
[DEBUG] ToolSearchTool: selected mcp__notes-tool__note_add, mcp__notes-tool__note_list
[DEBUG] notes-tool (user) answered tool.call without next() in 4.9ms; nothing beneath it ran for this dispatch
[DEBUG] hooks module notes-tool@inline tool.call settled in 5.4ms (worker hop, next() included)
[DEBUG] tool.call mcp__notes-tool__note_add toolu_011Af1eLeUeBwqWWwA8fe4gq: resolved by a hooks module (result)
[DEBUG] tool.call mcp__notes-tool__note_list toolu_01NbGMQ4Nn7Lgoutv1ac4QJs: resolved by a hooks module (result)
```

Registered names, as the engine prints them: `mcp__notes-tool__note_add` and
`mcp__notes-tool__note_list` — `mcp__<plugin-name-from-plugin.json>__<name>`.
`$.tool.register` stands up a **loopback MCP server** on 127.0.0.1 to serve
them, one per plugin, and each registration reconnects that server (71 ms then
27 ms here). Registering two tools is two round trips, not one.

## 5. Proof run 2 — the store outlives the session

A second, separate `claude -p`, in a new process, adding nothing:

```
$ timeout 170 claude -p "Call the tool note_list and report exactly what it returned. Do not add any note." \
    --plugin-dir C:/Users/lifes/kasegu/mods/notes-tool \
    --output-format text --allowedTools "mcp__notes-tool__note_list" \
    --debug-file C:/Users/lifes/kasegu/mods/notes-tool/debug2.log < /dev/null
```

Model reply (verbatim, abridged):

```
`note_list` の返り値をそのまま報告します。

​```
1. buy milk
2. call mom
​```

保存されているノートは 2 件で、内容は上記のとおりです（追加は行っていません）。
```

## 6. Where the store lives on disk

```
$ grep -rl "buy milk" C:/Users/lifes/.claude --include=*.json
C:/Users/lifes/.claude/plugins/store/notes-tool_inline-0716ddbdc635.json
```

Contents after run 1:

```json
{
  "notes": [
    { "text": "buy milk", "at": "2026-09-20T16:09:23.899Z" },
    { "text": "call mom", "at": "2026-09-20T16:09:24.982Z" }
  ]
}
```

One flat JSON file per plugin under
`~/.claude/plugins/store/`, keyed by the `$.store` keys. The file name for a
`--plugin-dir` load is `<plugin-name>_inline-<hash>.json`: the `inline-<hash>`
part is the loader's identity for that directory, so the same mod installed
properly and the same mod run with `--plugin-dir` are **not guaranteed to share
a store file**. Worth knowing before telling a reader their notes vanished.

The d.ts bounds it: values must be JSON (`get` reads back
`JSON.parse(JSON.stringify(value))`, so a `Date` returns as its ISO string —
which is why this mod stores `at` as a string on purpose), and the whole store
rejects past 4 MiB of JSON text.

## 7. Gotchas, with the exact text

1. **`{ result }`, not `{ text }`.** A `tool.call` hook serving a registered
   tool answers `{ result: <the tool's output> }`; `{ deny: '<reason>' }`
   refuses and the model reads the reason as an error result. `text` and `ref`
   on `ToolCallResult` are core's, set on what `next(e)` resolves to — "Absent
   on a hook's own `{ result }`". Meanwhile `command.run` answers `{ text }`.
   Mixing the two up is the single easiest way to break this mod.

2. **A registered tool with no hook simply fails.** The d.ts is explicit:
   "Serve it with a `tool.call` hook on `{ tool: "mcp__<plugin>__<name>" }`
   that returns the result (a call no hook answers fails)". The matcher must
   carry the **full** `mcp__<plugin>__<name>` name, not the short one passed to
   `$.tool.register`. The validator prints the matcher back at you
   (`tool.call{tool=mcp__notes-tool__note_add}`), which is where to catch a
   typo.

3. **`$.tool.register` rejects before the session binds.** "Rejects until the
   session binds, at `session.start`." So it lives inside a `session.start`
   hook, after `await next(e)` — not at module top level.

4. **`claude -p` does not run slash commands.** `/notes` could not be exercised
   headlessly: `claude -p "/cost"` (a built-in, tested for comparison with the
   sibling mod) came back as a model reply beginning
   「cost」だけでは何をご希望か分かりませんでした — the leading slash is
   stripped and the text arrives at `prompt.submit` as an ordinary prompt.
   `/notes` is therefore proven in `claude plugin test`
   (`$.command.run({ command: 'notes', ... })`), not in `-p`.

5. **Two `$.tool.register` calls are two MCP reconnections.** Each one
   re-serves the loopback server and waits for the tool to become visible
   (`visible after 71ms`, `visible after 27ms`). Registering many tools at
   `session.start` adds up; it is not a free local call.

6. **A benign warning on every `--plugin-dir` load.**
   `[WARN] plugin notes-tool: options requested but its manifest declares no
   userConfig; every option reads as absent` — noise, the module loaded and
   every hook fired.

## 8. What did not work, and why

- **`/notes` under `claude -p`** — no `command.run` dispatch exists in headless
  mode (gotcha 4). Covered by a test instead.
- Nothing else failed. `--allowedTools` with the full `mcp__notes-tool__*`
  names worked on the first attempt, the store persisted across processes
  without any extra flag, and no `hook failed:` line appeared in either debug
  log (`grep -nE "hook failed" debug.log debug2.log` → no matches).
