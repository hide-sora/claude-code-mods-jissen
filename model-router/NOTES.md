# model-router — build notes

Everything below was run on the real binary: Claude Code 2.1.278, Windows 11,
Git Bash, `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` set globally in
`~/.claude/settings.json`. Date of the runs: 2026-09-20 (UTC stamps in the
debug log excerpts).

A second, user-level mod `jev-model-router@skills-dir` was installed globally
during every run and hooks `prompt.submit`, `turn.step` and `agent.spawn` as
well. It was never modified. What it did is recorded below, because it is part
of the honest picture of what a `turn.step` hook sees.

---

## 1. Validator output (verbatim)

```
$ cd C:/Users/lifes/kasegu/mods/model-router && claude plugin validate .
Validating plugin manifest: C:\Users\lifes\kasegu\mods\model-router\.claude-plugin\plugin.json

Validating hooks: C:\Users\lifes\kasegu\mods\model-router\hooks\hooks.json

  ❯ ./register.ts hooks: session.start, command.run{command=route}, prompt.submit, turn.step
  ❯ ./register.ts calls: $.command.register, $.fs.write, $.store.delete, $.store.get, $.store.set

✔ Validation passed
```

Notes on that output:

- `import type { Register } from 'claude-code'` was accepted on the first try.
  The typed shape `export const register: Register = on => {...}` did **not**
  have to be downgraded to untyped. No fallback was needed.
- `$.plugin.root` does **not** appear in the `calls:` line. It is a string
  property, not a call, so the validator's static inventory of calls skips it,
  while `$.fs.write`, `$.store.get`, `$.store.set`, `$.store.delete` and
  `$.command.register` are all listed. This is a useful way to see, before
  running anything, exactly what a mod can reach.
- The matcher `{ command: 'route' }` is printed into the hook list as
  `command.run{command=route}`. The validator surfaces the narrowing, so a
  typo in a matcher is visible here rather than at runtime.

## 2. Test output (verbatim)

```
$ claude plugin test .
tests\register.test.ts:
(pass) register > sends a subagent step to haiku and a short first prompt to low effort [42.15ms]
(pass) register > /route pins the main loop by model id and /route auto hands it back [18.53ms]

 2 pass
 0 fail
Ran 2 tests across 1 file. [0.26s]
```

`claude plugin test` needed no generated types on disk and no login. The tests
import `claude-code/testing` and type-only symbols from `claude-code`; the test
runner resolves both.

Driving a streaming event from a test works, and this is the part worth
copying:

```ts
const drain = async (stream: HookStream<TurnStepChunk, TurnStepResult>) => {
  for await (const _chunk of stream) void _chunk
  return stream.result
}
await drain($.turn.step(step({ agentId: 'a1' })))
```

`$.turn.step(e)` returns a `HookStream`, not a promise. `stream.result` only
settles once the stream has been read to its end, so the drain loop is
mandatory. The hook the test registers beneath the mod must itself be a
generator:

```ts
on('turn.step', async function* ($, e) {
  return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
})
```

## 3. Proof run 1 — short prompt, `effort` rewritten

```
$ cd C:/Users/lifes/kasegu && timeout 170 claude -p "Say OK" \
    --plugin-dir C:/Users/lifes/kasegu/mods/model-router \
    --output-format text --allowedTools "Bash,Read" \
    --debug-file C:/Users/lifes/kasegu/mods/model-router/debug.log < /dev/null
```

Model reply: `OK`

`PROOF-steps.log` after the run:

```
index=0 | loop=main | rule=short-prompt | model=claude-opus-5[1m] -> claude-opus-5[1m] | effort=high -> low | messages=18 | answered=claude-opus-5 | stop=end_turn | tools=0 | trace=jev-model-router/user:returned > engine/core:returned
```

Debug-log lines that matter:

```
[DEBUG] hooks module model-router@inline loaded (worker, environment 1, tier user); events: session.start,command.run,prompt.submit,turn.step
[DEBUG] hooks module jev-model-router@skills-dir loaded (worker, environment 2, tier user); events: prompt.submit,turn.step,agent.spawn
[DEBUG] plugin.register: model-router (user, model-router@inline), judged by core alone: admitted
[DEBUG] $.command.register (model-router): /route listed
[DEBUG] hooks module model-router@inline session.start settled in 30.3ms (worker hop, next() included)
[DEBUG] hooks module model-router@inline, jev-model-router@skills-dir prompt.submit settled in 826.0ms (worker hop, next() included)
[DEBUG] [jev-model-router] $.ui.log: [jev-model-router] main loop: kept claude-opus-5[1m]/low, wanted haiku (confidence n/d)
[DEBUG] $.fs.write (model-router): C:\Users\lifes\kasegu\mods\model-router\PROOF-steps.log (235 bytes)
[DEBUG] hooks module model-router@inline, jev-model-router@skills-dir turn.step stream settled in 1327.6ms (worker hop, next() included)
```

The jev line is the proof that the `effort` rewrite travelled **down** the
chain: jev sits beneath model-router and reports the step it received as
`claude-opus-5[1m]/low`, i.e. it already saw `low`, not the session's `high`.

`messages=18` on a one-line prompt is the transcript, not the prompt.

## 4. Proof run 2 — subagent step, and the finding the book is for

The first version of the mod wrote the family alias, exactly as a reader
would: `const SUBAGENT_MODEL = 'haiku'`.

```
$ timeout 170 claude -p "Use the Agent tool with subagent_type general-purpose to answer: what is 2+2? Then report its answer." \
    --plugin-dir C:/Users/lifes/kasegu/mods/model-router \
    --output-format text --allowedTools "Agent" \
    --debug-file C:/Users/lifes/kasegu/mods/model-router/debug2.log < /dev/null
```

The CLI printed, before the model's answer:

```
[claude-code:unrecognized_model] {"model":"haiku","query_source":"agent:builtin:general-purpose"}
```

The model then reported (Japanese, abridged): the subagent was started twice
and both runs ended at once with an API error,
`Agent terminated early due to an API error: There's an issue with the selected
model (haiku). It may not exist or you may not have access to it. (error type
model_not_found, HTTP 404)`.

`PROOF-steps-alias-404.log` (kept as the failing evidence):

```
index=0 | loop=main | rule=none | model=claude-opus-5[1m] -> claude-opus-5[1m] | effort=high -> high | messages=18 | answered=claude-opus-5 | stop=tool_use | tools=1 | trace=jev-model-router/user:returned > engine/core:returned
index=0 | loop=af5d4d3866696e194 | rule=subagent | model=claude-opus-5[1m] -> haiku | effort=high -> high | messages=10 | answered=none | stop=null | tools=0 | trace=jev-model-router/user:returned > engine/core:returned
index=1 | loop=main | rule=none | model=claude-opus-5[1m] -> claude-opus-5[1m] | effort=high -> high | messages=25 | answered=claude-opus-5 | stop=tool_use | tools=1 | trace=jev-model-router/user:returned > engine/core:returned
index=0 | loop=a79906c2bde7b2f17 | rule=subagent | model=claude-sonnet-5 -> haiku | effort=high -> high | messages=10 | answered=none | stop=null | tools=0 | trace=jev-model-router/user:returned > engine/core:returned
index=2 | loop=main | rule=none | model=claude-opus-5[1m] -> claude-opus-5[1m] | effort=high -> high | messages=29 | answered=claude-opus-5 | stop=end_turn | tools=0 | trace=jev-model-router/user:returned > engine/core:returned
```

and `debug2.log`:

```
[DEBUG] [API:timing] dispatching to firstParty model=haiku
[ERROR] API error (attempt 1/11): 404 404 {"type":"error","error":{"type":"not_found_error","message":"model: haiku"},"request_id":"req_011CfEygC3oGDPmX28Rw7KZ9"}
[WARN] Streaming endpoint returned 404, falling back to non-streaming mode
[ERROR] Non-streaming fallback also failed: 404 {"type":"error","error":{"type":"not_found_error","message":"model: haiku"},"request_id":"req_011CfEygE46LMgo1LpbDRT7a"}
[ERROR] API model not found: model: haiku
[ERROR] Sync agent error: Agent terminated early due to an API error: There's an issue with the selected model (haiku). It may not exist or you may not have access to it. Run --model to pick a different model. (error type model_not_found, HTTP 404, request id req_011CfEygE46LMgo1LpbDRT7a, model sent to the API: claude-opus-5)
```

`dispatching to firstParty model=haiku` is the answer to the book's question,
and it is a stronger answer than a success would have been (see §6).

Note the last line's tail, `model sent to the API: claude-opus-5`. That part of
the error message is **wrong**: the request that 404'd carried `haiku`, as both
the dispatch line and the 404 body (`"message":"model: haiku"`) show. The
message prints the model the *session* is on, not the model the request was
made with. Do not debug a `turn.step` rewrite from that sentence.

## 5. Proof run 3 — the fix, and the subagent actually answering on haiku

After changing the mod to resolve family names to ids
(`haiku -> claude-haiku-4-5-20251001`), the same command was run again:

Model reply (abridged): `サブエージェント（general-purpose）に「2+2 は？」と聞いた結果です。**回答: 4**`

`PROOF-steps.log`:

```
index=0 | loop=main | rule=none | model=claude-opus-5[1m] -> claude-opus-5[1m] | effort=high -> high | messages=18 | answered=claude-opus-5 | stop=tool_use | tools=1 | trace=jev-model-router/user:returned > engine/core:returned
index=0 | loop=a16bed91c0e2520c2 | rule=subagent | model=claude-opus-5[1m] -> claude-haiku-4-5-20251001 | effort=high -> high | messages=10 | answered=claude-haiku-4-5-20251001 | stop=end_turn | tools=0 | trace=jev-model-router/user:returned > engine/core:returned
index=1 | loop=main | rule=none | model=claude-opus-5[1m] -> claude-opus-5[1m] | effort=high -> high | messages=25 | answered=claude-opus-5 | stop=end_turn | tools=0 | trace=jev-model-router/user:returned > engine/core:returned
```

`answered=` is `TurnStepResult.usage.model`, which the d.ts documents as
"Which model answered, by the id the API reports". On the subagent step the
model asked for and the model that answered are the same rewritten id.

## 6. Does rewriting `model` in `turn.step` actually change the model used?

**Yes, proven, twice over, by two independent kinds of evidence.**

1. **Negative evidence (run 2).** Writing `model: 'haiku'` made the HTTP
   request itself fail: `[API:timing] dispatching to firstParty model=haiku`,
   then `404 {"type":"not_found_error","message":"model: haiku"}`. A rewrite
   that the engine ignored could not have produced a 404 naming the value the
   hook wrote. This also proves the value is sent **verbatim**: no alias
   resolution, no validation, no fallback to the session's model.
2. **Positive evidence (run 3).** Writing the full id made
   `TurnStepResult.usage.model` come back as
   `claude-haiku-4-5-20251001` for the subagent step while the main-loop steps
   in the same run came back `claude-opus-5`. The engine resolved the step's
   own model per request.

What is **not** provable from the artifacts available:

- `effort` reaching the API. There is no effort field in `usage` and no debug
  line naming a thinking budget. What is proven is that the rewrite reaches
  every lower link: jev, beneath us, logged the step it received as
  `claude-opus-5[1m]/low`. Whether the API request then carried that effort is
  believed but unproven here. Call it "reaches the chain", not "reaches the
  model".
- The `[1m]` suffix. The session ran on `claude-opus-5[1m]`; `usage.model` came
  back `claude-opus-5`. The suffix is a Claude Code request decoration, not
  part of the id the API reports back. Comparing `e.model` to `r.usage.model`
  by string equality will therefore look like a mismatch on a step nobody
  rewrote.

## 7. Where jev-model-router sits in the chain

Every `PROOF-steps.log` line ends with the trace of what ran beneath this hook:

```
trace=jev-model-router/user:returned > engine/core:returned
```

`next.trace` lists the **lower** links, outermost first. So with
`--plugin-dir` loading model-router and jev installed globally at the same
`user` tier, model-router ran **above** jev. Consequences seen in the logs:

- model-router's rewrite happens first; jev sees the already-rewritten step
  (`kept claude-opus-5[1m]/low`).
- Both hooks were reported as one settle line:
  `hooks module model-router@inline, jev-model-router@skills-dir turn.step
  stream settled in 1327.6ms (worker hop, next() included)`.
- jev did not undo anything in these runs: `routeMainModel` is off in its
  configuration, and its own log says so (`main loop: kept ...`). A globally
  installed router with main-loop model routing **on** would be the link that
  wins or loses depending on who is outermost, and the ordering is not
  something this mod declares — it is what the loader produced here. Do not
  build a mod that depends on being outermost.
- `TraceEntry.chunks` was **absent** on every entry, on a streaming event where
  the d.ts says it is present and "absent on every other". The outcome recorded
  for the lower links was `returned`, not `passed`. Recorded as observed; the
  log format prints `(Nc)` when `chunks` is a number and printed nothing on
  every run.

## 8. Gotchas, with the exact text

1. **`turn.step`'s `model` is sent to the API verbatim.**
   `[API:timing] dispatching to firstParty model=haiku` →
   `404 {"type":"error","error":{"type":"not_found_error","message":"model: haiku"}}`.
   Fix: keep an id table and resolve before writing
   (`haiku → claude-haiku-4-5-20251001`). The engine resolves the *session's*
   model alias for you; it does not resolve a hook's.

2. **The 404's own explanation names the wrong model.**
   `... (error type model_not_found, HTTP 404, request id ..., model sent to the
   API: claude-opus-5)` — while the request carried `haiku`. Trust
   `[API:timing] dispatching to firstParty model=` and the 404 body, not the
   trailing sentence.

3. **`claude -p` does not run slash commands at all.**
   `claude -p "/route sonnet"` never raised `command.run`; the text arrived at
   `prompt.submit` as an ordinary prompt (the mod's own rule 2 fired on it:
   `rule=short-prompt`) and the model answered it in prose. The same happens to
   a built-in: `claude -p "/cost"` produced a model reply beginning
   「cost」だけでは何をご希望か分かりませんでした — the leading slash is
   stripped and the rest is a prompt. Rule 3 is therefore **proven in
   `claude plugin test`, not in `-p`**; there is no way to exercise a
   registered slash command headlessly.

4. **`$.fs` has no append.** `$.fs.write(path, text)` takes "the whole new
   content". Keep the lines in a module-level array and rewrite the file each
   time, or read-modify-write. There is no `$.fs.append`.

5. **`next(e)` on `turn.step` is a stream, not a promise.** The hook must be
   `async function*` and the call `yield* next({ ...e, model, effort })`. A
   plain `async ($, e, next) => next(e)` is a type error by design: the d.ts
   says "A plain function is a type error here even when it returns `next(e)`:
   the hook is the generator, not a function that hands one back."

6. **A benign warning on every `--plugin-dir` load.**
   `[WARN] plugin model-router: options requested but its manifest declares no
   userConfig; every option reads as absent` appears before the module loads,
   for a manifest with no `userConfig` key. It is noise, not a failure; the
   module still loaded and every hook fired.

7. **`messageCount` is the transcript, not the prompt.** A `claude -p "Say OK"`
   run reported `messages=18` at `index=0`. Do not use it as a proxy for how
   much the person typed; that is why rule 2 captures the length in
   `prompt.submit` instead.

## 9. What did not work, and why

- **`claude -p "/route sonnet"`** — no `command.run` dispatch (see gotcha 3).
  Replaced by a `claude plugin test` case that calls
  `$.command.run({ command: 'route', args: 'sonnet', ... })` directly and then
  checks the model the next `turn.step` received.
- **First `/route` design: store the raw argument.** The test failed with
  `Expected: containing "claude-sonnet-5" / Received: "model-router: the main
  loop runs on sonnet"`. Fixed by resolving the id inside `command.run`, so the
  line the person is shown is the string the API will be sent.
- **`model.includes(SUBAGENT_MODEL)` as the "already haiku" check** — harmless
  with the alias, wrong with the id. Replaced by plain equality against the
  resolved id.
- **Proving `effort` reached the API** — no artifact carries it. Left unproven
  on purpose rather than claimed.

## 10. Addendum (2026-09-21): §8-3 and §9 were wrong about `claude -p` and slash commands

The "`claude -p` does not run slash commands" finding above was an artifact of Git Bash (MSYS) argument conversion: `/route sonnet` reached `claude` as `C:/Program Files/Git/route sonnet`, an ordinary prompt. With `MSYS_NO_PATHCONV=1` (or `//route`), `-p` **does** dispatch a plugin-registered command and its `command.run` hook fires (`work-log (user) answered command.run without next() in 1.7ms`). Built-in commands (`/cost`) dispatch too but raise no `command.run`; `/help` is refused headlessly. Seven-run evidence: `../_docs/slash-commands-in-p.md`. The test-kit proof of rule 3 stands as written.
