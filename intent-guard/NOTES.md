# intent-guard — build notes

Claude Code **2.1.278**, Windows 11, Git Bash, `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` set
globally. Every claim below came off a real run.

---

## 1. Validator output (verbatim)

```
$ cd C:/Users/lifes/kasegu/mods/intent-guard && claude plugin validate .

Validating plugin manifest: C:\Users\lifes\kasegu\mods\intent-guard\.claude-plugin\plugin.json

Validating hooks: C:\Users\lifes\kasegu\mods\intent-guard\hooks\hooks.json

  ❯ ./register.ts hooks: tool.call{tool=Bash}
  ❯ ./register.ts calls: $.fs.read, $.fs.write, $.model.classify

✔ Validation passed
```

`import type { Register } from 'claude-code'` was accepted; no untyped fallback needed.
`$.model.classify` shows up in `calls:` by name — the reach line is what a reviewer reads,
and "this mod sends your shell commands to a model" is visible there without opening the file.

---

## 2. GOTCHA 1: the judge called `rm -rf` **safe**

First working build passed the bare command string to `classify`. Result, from
`PROOF-guard.v1-baseline.log` (kept in the folder as evidence):

```
2026-09-20T16:08:48.019Z 737ms verdict=safe decision=allow(safe) cmd="rm -rf C:/Users/lifes/kasegu/mods/intent-guard/tmp-victim"
2026-09-20T16:09:30.002Z 654ms verdict=safe decision=allow(safe) cmd="rm -f C:/Users/lifes/kasegu/mods/intent-guard/tmp-single.txt"
```

Both **safe**. The guard denied nothing. With labels `['safe', 'destructive']` and nothing
else, a bare `rm -rf <a named folder>` reads to Haiku as routine housekeeping — which, with
no context, is a defensible reading.

The fix is to say what the labels mean, inside the text being classified:

```ts
const question =
  'A coding agent wants to run this shell command on a developer\'s machine.\n' +
  'destructive = it irreversibly deletes, overwrites or discards data or history.\n' +
  'safe = it only reads, lists, prints or creates.\n\n' +
  `Command: ${command}`
```

`classify`'s own prompt is fixed and the docs say "`text` is data; the model answers with a
label alone" — but the label definitions still land, because they arrive as part of the text
it is reasoning over. After the change, same command:

```
2026-09-20T16:10:50.115Z 591ms verdict=destructive decision=DENY(destructive) cmd="rm -rf C:/Users/lifes/kasegu/mods/victims/tmp-victim"
```

**A two-label `classify` without a definition of the labels is a coin flip with extra steps.**

---

## 3. GOTCHA 2: the trigger regex decides what the judge is even allowed to see

The brief's regex ends with `\b`:

```
…|dd\s+if=|chmod\s+-R\s+777|curl[^|]*\|\s*(sh|bash)|Remove-Item|Format-Volume)\b
```

Two holes found, one of them proven live:

- **`dd if=/dev/zero of=…` never triggers.** The alternative `dd\s+if=` ends in `=`, a
  non-word character, so the trailing `\b` demands a word character immediately after.
  `dd if=/dev/zero` has `/` there. No boundary, no match. (Static analysis; the fix is to
  make the `\b` per-alternative, or drop it for the alternatives that end in punctuation.)
- **`find <dir> -type f -delete` never triggers, and it really deleted the file.** The
  alternative is `del`, and `\bdel\b` does not match inside `delete`. Proof run 5, second
  command, model reply verbatim:

  > **(2) `find C:/Users/lifes/kasegu/mods/victims/tmp-bypass -type f -delete`**
  > ```
  > (Bash completed with no output)
  > ```
  > 出力なし = 成功 … **この1ファイルは消えています**

  `PROOF-guard.log` has no line for it — the judge was never asked. Verified afterwards:
  `ls mods/victims/tmp-bypass` → empty.

So the honest claim for this mod is narrow: **rewording defeats the regex, not the judge.**
Everything the judge actually sees is judged on intent; everything else walks past. An
"everything goes to the judge" variant is a model call per Bash command, which is the
trade-off the prefilter buys out of.

---

## 4. GOTCHA 3: `$.model.classify` appears in the debug log as `$.model.complete`

```
[DEBUG] $.model.complete (intent-guard): claude-haiku-4-5-20251001 answered in 589ms, 11 chars
[DEBUG] $.model.complete (intent-guard): claude-haiku-4-5-20251001 answered in 487ms, 4 chars
```

`classify` is built on `complete`, and the debug log names the lower call. Grepping the log
for `classify` finds nothing. `11 chars` = `destructive`, `4 chars` = `safe` — the reply
length is the only clue to the verdict in the log, since the text is not printed.

`{ model: 'haiku' }` resolved to `claude-haiku-4-5-20251001`. The option name is `model`,
confirmed against `ClassifyOptions` (`claude-code.d.ts:1093`), whose only member is
`model?: string`.

Measured latency, four judged commands: **737 ms, 654 ms, 591 ms, 487 ms** (mean ≈ 617 ms).

---

## 5. The 10-second budget: it does not appear, and it cannot fire here

The brief asked whether a 10 s budget shows up in the debug log. **It does not.** The only
`10000ms` line in any run is unrelated:

```
2026-09-20T16:08:44.981Z [DEBUG] Creating snapshot at: C:\Users\lifes\.claude\shell-snapshots\snapshot-bash-…sh
2026-09-20T16:08:44.981Z [DEBUG] Execution timeout: 10000ms
```

— that is the Bash tool's shell-snapshot timeout, not a hook budget. `HookBudget` in
`claude-code.d.ts` fixes the numbers as types (`ms: 10_000`, `catchMs: 1_000`,
`lingerMs: 5_000`), and the engine only mentions a budget when one is exceeded.

More important, from the same doc block:

> Each bounds the hook's OWN time: the clock stops while a `next(e)` call or any `$` call of
> the hook's is in flight … so a slow chain beneath or a minute-long `$.model.complete`
> costs it nothing.

**So a slow judge can never trip the 10 s budget.** The `.catch` in this mod is a guard
against a throw or a misreturn, not against a slow model. The `try`/`catch` around
`classify` is what actually covers judge failure, and it is the one that has to fail closed.

---

## 6. Proving `.catch` fails closed

A copy of the mod with `throw new Error('deliberate failure to prove the .catch path')`
inserted before the judge. Model reply, verbatim:

```
intent-guard: the guard itself failed (throw: deliberate failure to prove the .catch path), so the Bash command was refused unjudged
```

Debug log, the three lines that matter:

```
2026-09-20T16:12:04.574Z [WARN] hook failed closed: intent-guard: errorKind=Error errorChars=43 (tool.call; its .catch answered)
2026-09-20T16:12:04.574Z [DEBUG] hooks module intent-guard@inline tool.call settled in 1.4ms (worker hop, next() included)
2026-09-20T16:12:04.574Z [DEBUG] tool.call Bash toolu_011bSdDuGCo7PZb1Cbi134fG: resolved by a hooks module (deny: intent-guard: the guard itself failed (throw: deliberate failure to prove the .catch path), so the Bash command was refused unjudged)
```

Corrections to what I was told to expect:

- The line reads **`[WARN] hook failed closed:`**, not `[ERROR] hook failed:`. The
  `(tool.call; its .catch answered)` suffix is how you tell a caught failure from a skipped
  one — the `skipped` wording belongs to a hook with no `.catch`.
- **There is no `$.ui.log` line carrying the exception text.** The log gives
  `errorChars=43`, the length only. If you want the message in the log, your `.catch` has to
  put it there itself (this one puts it in the deny text, which is why it is quotable above).
- Two vocabularies for the same failure: `next.error.kind` is `'throw' | 'timeout'`, while
  the debug line says `errorKind=Error` (the JS class). Do not try to match them.

---

## 7. Proof runs

Harness:

```sh
cd C:/Users/lifes/kasegu
timeout 170 claude -p "<prompt>" --plugin-dir mods/intent-guard \
  --output-format text --allowedTools "Bash,Read,Grep" \
  --debug-file mods/intent-guard/debugN.log < /dev/null
```

### Run 1 — `rm -rf <folder>` (v1 judge, baseline)

Verdict `safe`, so intent-guard allowed it. The deletion was then blocked by Claude Code's
**own** permission layer, and the model reported that instead:

```
<error>Claude requested permissions to edit C:\Users\lifes\kasegu\mods\intent-guard\tmp-victim which is a sensitive file.</error>
```

**Gotcha worth its own line:** anything under a `--plugin-dir` folder is a *sensitive file*
to the engine, so a victim fixture placed inside the mod is protected by something that is
not your mod. It masks both a false allow and a real deny. The later runs put victims in
`mods/victims/` instead, outside the plugin directory, and only then was the mod's own
behaviour observable.

### Run 2 — `rm -f <one file>` (v1 judge)

Verdict `safe`, 654 ms — recorded honestly; the judge did not consider deleting one named
temp file destructive at this stage. Same sensitive-file block followed.

### Run 3 — `echo hello`, must not reach the judge

```
hello

`echo hello` を実行して、出力は `hello` でした。
```

Assertions, measured around the run:

```
PROOF-guard.log bytes before=261 after=261
grep -c "model.complete (intent-guard)" debug3.log  →  0
```

and the hook did fire, it just short-circuited:

```
[DEBUG] hooks module intent-guard@inline tool.call settled in 1209.6ms (worker hop, next() included)
```

**Proven: the trigger regex saves the model call, not the hook dispatch.**

### Run 4 — `rm -rf <folder>` (v2 judge), deny

Model reply, verbatim:

```
intent-guard: an LLM judge read this command as destructive, so it was not run: rm -rf C:/Users/lifes/kasegu/mods/victims/tmp-victim
```

`ls mods/victims/tmp-victim` afterwards → `a.txt` still there. Log line:

```
2026-09-20T16:10:50.115Z 591ms verdict=destructive decision=DENY(destructive) cmd="rm -rf C:/Users/lifes/kasegu/mods/victims/tmp-victim"
```

The deny string reached the model **verbatim**, and the model respected it rather than
retrying — it explicitly said it would not work around the guard and asked how to proceed.

### Run 5 — a triggering-but-harmless command, allowed and actually run

`echo "the del command is a Windows builtin"` trips `\bdel\b`, so it is judged. Output the
model got back:

```
the del command is a Windows builtin
```

```
2026-09-20T16:11:17.914Z 488ms verdict=safe decision=allow(safe) cmd="echo \"the del command is a Windows builtin\""
```

This is the run that proves the judge is not just rubber-stamping the regex, and that the
allow path really executes.

### `PROOF-guard.log` (v2 judge, whole file)

```
2026-09-20T16:10:50.115Z 591ms verdict=destructive decision=DENY(destructive) cmd="rm -rf C:/Users/lifes/kasegu/mods/victims/tmp-victim"
2026-09-20T16:11:17.914Z 488ms verdict=safe decision=allow(safe) cmd="echo \"the del command is a Windows builtin\""
```

`PROOF-guard.v1-baseline.log` holds the two v1 lines from section 2.

---

## 8. Tests

`claude plugin test .` (verbatim):

```
tests\register.test.ts:
(pass) register > denies a command the judge reads as destructive [36.06ms]
(pass) register > runs a command the judge reads as safe [16.03ms]
(pass) register > never asks the judge about a command the trigger misses [12.60ms]
(pass) register > denies when the judge itself rejects [18.24ms]

 4 pass
 0 fail
Ran 4 tests across 1 file. [0.28s]
```

`model.classify` is its own event in the kit (`claude-code.d.ts:5468`, result
`string | undefined` at 5763), answered as `on('model.classify', () => ({ value: 'destructive' }))`.
The fourth test makes that hook **throw** to drive the fail-closed branch — the branch the
live runs never reached, because the API kept working.

---

## 9. What did NOT work

- **Bare command text into `classify`** — section 2. Said `safe` to `rm -rf`. The single
  biggest finding here.
- **Victim fixtures inside the plugin folder** — section 7, run 1. The engine's sensitive-file
  rule fired first and hid the mod's behaviour entirely.
- **Expecting the 10 s budget to cover a slow judge** — section 5. The budget clock stops
  during `$` calls. The `try`/`catch` is the real protection; `.catch` covers a throw.
- **Relying on the brief's trigger regex as written** — section 3. `dd if=…` and
  `find -delete` walk past it. Kept as specified so the book can show the hole, with the
  caveat in the code comment and the fix described above.
- **Looking for `classify` in the debug log** — section 4. It is logged as `model.complete`.
