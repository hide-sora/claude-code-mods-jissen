# secret-scrub — build notes

Everything below was run on the real binary: **Claude Code 2.1.278, Windows 11, Git Bash**,
with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` set globally in `~/.claude/settings.json`.
Nothing here is assumed.

---

## 1. Validator output (verbatim)

```
$ cd C:/Users/lifes/kasegu/mods/secret-scrub && claude plugin validate .

Validating plugin manifest: C:\Users\lifes\kasegu\mods\secret-scrub\.claude-plugin\plugin.json

Validating hooks: C:\Users\lifes\kasegu\mods\secret-scrub\hooks\hooks.json

  ❯ ./register.ts hooks: tool.call{tool=Read|Grep|Bash}
  ❯ ./register.ts calls: $.fs.read, $.fs.write

✔ Validation passed
```

`import type { Register } from 'claude-code'` + `export const register: Register = on => {…}`
was accepted on the first try. **No fallback to an untyped `export function register(on: any)`
was needed.** The types file is not present in the plugin folder (`/plugin-types` was never
run here) and the validator did not care — it does not typecheck, it inventories `$` calls.

Note what the `calls:` line does *not* say: `$.model`, `$.http`, `$.process` are absent.
That line is the mod's whole reach, and it is derived statically from the source.

---

## 2. The result shape of `tool.call`, observed

This is the question the whole mod turns on. Observed, not assumed — `PROOF-scrub.log`
records `Object.keys(r)` of whatever `await next(e)` resolved to:

```
2026-09-20T16:05:27.817Z tool=Read resultKeys=[ref,result,text] hits(record/text) pem=1/1 bearer=1/1 openai=1/1 aws=1/1 github=1/1 slack=1/1
2026-09-20T16:05:52.545Z tool=Grep resultKeys=[ref,result,text] hits(record/text) openai=1/1 aws=1/1 github=1/1 slack=1/1
2026-09-20T16:05:53.979Z tool=Bash resultKeys=[ref,result,text] hits(record/text) pem=1/1 bearer=1/1 openai=1/1 aws=1/1 github=1/1 slack=1/1
```

**`next(e)` from core resolves to exactly `{ ref, result, text }` for all three tools.**
(`isError` joins them when the tool errored; `context` was never present from core.)

- `ref: number` — names the messages core already produced, host side.
- `result` — the tool's structured record. Per tool (from `claude-code.d.ts`, the
  `BuiltinToolResults` block at the end of the file):
  - `Read` → `{ type: "text", file: { filePath, content, numLines, startLine, totalLines } }`
    (also `image` / `notebook` / `pdf` / `parts` / `file_unchanged` variants)
  - `Bash` → `{ stdout, stderr, interrupted, … }`
  - `Grep` → **no entry in `BuiltinToolResults`**, so it types as `unknown`; at runtime it is
    a record with the matching lines in it.
- `text: string` — "the result as the model reads it (text blocks joined)".

Because the three shapes differ and Grep's is untyped, the mod walks every string in the
record rather than branching per tool. That is also what makes it survive a new tool.

---

## 3. GOTCHA 1 (the big one): scrubbing `r.text` alone does nothing

`references/templates.md` ships this as *the* after-hook pattern:

```ts
on('tool.call', { tool: ['Read', 'Grep'] }, async ($, e, next) => {
  const r = await next(e)
  if (r && typeof r.text === 'string') return { ...r, text: scrub(r.text) }
  return r
})
```

**On 2.1.278 that pattern does not mask anything.** Three controlled `-p` runs, same
fixture, same prompt, only the return statement changed:

| variant returned | what the model quoted back for `line02` |
|---|---|
| `{ ...r, result, text }` (both scrubbed, `ref` kept) | `line02 openai_key=[REDACTED:openai]` |
| `{ ...r, result }` (record scrubbed, core's `text` left raw) | `line02 openai_key=[REDACTED:openai]` |
| `{ ...r, text }` (**text scrubbed, record left raw**) | `line02 openai_key=sk-test1234567890abcdefghij` |

The third run's reply, verbatim (the model noticed by itself):

> 私が受け取った Read の出力では、この値はマスクされずに届いていました。つまり、もしこの確認の
> 目的が「スクラブ処理がツール出力の時点で効いているか」の検証であれば、**この経路では効いていない**
> ことになります。

Conclusion: **core re-maps the model-facing text from `result` with the tool's own mapper.**
`result` is authoritative; a hook's `text` is ignored on this path. Scrub the record.

Corollary, and the opposite of what I expected going in: **keeping `ref` is harmless.**
The d.ts says "A hook that returns the object it got makes core use them verbatim", which
reads like a trap, but a *spread* object with a changed `result` was honoured. The shipped
mod still returns `{ result, text, context }` without `ref`, because that is the shape whose
semantics are documented for a hook's own answer, and it was proven to work.

---

## 4. GOTCHA 2: `String.replace`'s second callback argument is a number

First proof run came back with this (the model quoted it faithfully):

```
line02 openai_key=137[REDACTED:openai]
line03 aws_access_key_id=183[REDACTED:aws]
line04 github_token=221[REDACTED:github]
line05 slack_token=261[REDACTED:slack]
line06 Authorization: Bearer [REDACTED:bearer]
line07 400[REDACTED:pem]
```

`137`, `183`, `221`… are **match offsets**. The callback was written

```ts
(_m: string, keep?: string) => `${keep ?? ''}[REDACTED:${rule.kind}]`
```

because the `bearer` rule has a capture group it needs to keep. For every rule **without**
a capture group, `replace` passes `(match, offset, string)` — so `keep` was the offset,
a `number`, and `??` does not catch a number. TypeScript did not object either, because
`plugin validate` does not typecheck. Fix:

```ts
`${typeof keep === 'string' ? keep : ''}[REDACTED:${rule.kind}]`
```

Note the `bearer` line was correct all along — that is exactly why this survives review:
the one rule you look at works.

---

## 5. GOTCHA 3: `.catch` from templates.md fails *open*, which is wrong here

The template is:

```ts
.catch(($, e, next) => (next.called ? next(e) : { deny: next.error.kind }))
```

`next` inside a `.catch` is replay-safe: when `next.called`, `next(e)` resolves to whatever
the hook's own last call settled to. For a scrubber that is **the unscrubbed result** — the
exact bytes the hook existed to hide, handed over because the hook crashed. This mod denies
unconditionally instead:

```ts
.catch(($, e, next) => ({ deny: `secret-scrub: the scrubber failed (${next.error.kind}), refusing …` }))
```

Budget facts from the d.ts (`HookBudget`): hook `ms: 10_000`, `.catch` grace `catchMs: 1_000`,
`lingerMs: 5_000`. And the clock **stops** while a `next(e)` or any `$` call is in flight, so
a slow tool underneath never burns the hook's 10 s.

---

## 6. Proof runs (commands and results)

Harness for every run:

```sh
cd C:/Users/lifes/kasegu
timeout 170 claude -p "<prompt>" --plugin-dir mods/secret-scrub \
  --output-format text --allowedTools "Bash,Read,Grep" \
  --debug-file mods/secret-scrub/debug.log < /dev/null
```

### Fixture — `fixtures/fake-secrets.txt`

All values invented; none authenticate anywhere.

```
# FAKE credentials, invented for a mod test. None of these authenticate anywhere.
line01 plain text before the secrets
line02 openai_key=sk-test1234567890abcdefghij
line03 aws_access_key_id=AKIAABCDEFGHIJKLMNOP
line04 github_token=ghp_abcdefghijklmnopqrstuvwxyz1234
line05 slack_token=xoxb-1111111111-2222222222-FAKEFAKEFAKEFAKE
line06 Authorization: Bearer faketokenvalue.0123456789.abcdefgh
line07 -----BEGIN RSA PRIVATE KEY-----
line08 MIIBOgIBAAJBAKFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEF
line09 AKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE
line10 -----END RSA PRIVATE KEY-----
line11 plain text after the secrets
```

### Run A — Read

Prompt: *"Read the file …/fake-secrets.txt with the Read tool and quote back exactly every
line that contains the word REDACTED, and separately say whether you can see any real-looking
token starting with sk- or AKIA or ghp_."*

Model reply (the quoted block, verbatim):

```
line02 openai_key=[REDACTED:openai]
line03 aws_access_key_id=[REDACTED:aws]
line04 github_token=[REDACTED:github]
line05 slack_token=[REDACTED:slack]
line06 Authorization: Bearer [REDACTED:bearer]
line07 [REDACTED:pem]
```

and on the second question: *"**見えません。ひとつもありません。** すべての秘密情報の値は
`[REDACTED:...]` というプレースホルダに置き換わっていて、実際の文字列は残っていません。"*

### Run B — Grep and Bash in one run

Prompt: *"(1) Use the Grep tool with pattern 'sk-|AKIA|ghp_|xox' … (2) Use the Bash tool to
run: cat …/fake-secrets.txt. For each, quote the raw output you received…"*

Grep, as the model received it:

```
mods\secret-scrub\fixtures\fake-secrets.txt:3:line02 openai_key=[REDACTED:openai]
mods\secret-scrub\fixtures\fake-secrets.txt:4:line03 aws_access_key_id=[REDACTED:aws]
mods\secret-scrub\fixtures\fake-secrets.txt:5:line04 github_token=[REDACTED:github]
mods\secret-scrub\fixtures\fake-secrets.txt:6:line05 slack_token=[REDACTED:slack]
```

Bash (`cat`), as the model received it:

```
# FAKE credentials, invented for a mod test. None of these authenticate anywhere.
line01 plain text before the secrets
line02 openai_key=[REDACTED:openai]
line03 aws_access_key_id=[REDACTED:aws]
line04 github_token=[REDACTED:github]
line05 slack_token=[REDACTED:slack]
line06 Authorization: Bearer [REDACTED:bearer]
line07 [REDACTED:pem]
line11 plain text after the secrets
```

Two things worth pointing out from that reply. The model reasoned, correctly, that
**Grep matched on disk and the masking happened on the way out**: "検索パターン … は、ファイル
実体にその文字列が存在するからこそ 4 行にヒットしています … ツール出力の段階で `[REDACTED:...]`
に差し替えられている". And it flagged the missing `line08`–`line10`: the multi-line PEM rule
collapses the whole block into one `[REDACTED:pem]`, so line numbers jump. That is by design
but it is a visible side effect, and the model noticed it in every run.

### `PROOF-scrub.log` after both runs (whole file)

```
2026-09-20T16:05:27.817Z tool=Read resultKeys=[ref,result,text] hits(record/text) pem=1/1 bearer=1/1 openai=1/1 aws=1/1 github=1/1 slack=1/1
2026-09-20T16:05:52.545Z tool=Grep resultKeys=[ref,result,text] hits(record/text) openai=1/1 aws=1/1 github=1/1 slack=1/1
2026-09-20T16:05:53.979Z tool=Bash resultKeys=[ref,result,text] hits(record/text) pem=1/1 bearer=1/1 openai=1/1 aws=1/1 github=1/1 slack=1/1
```

The `record/text` pair is there for a reason: the first build used one shared counter and
every kind read `=2`, because the record and `text` are two copies of the same bytes.

---

## 7. Debug-log excerpts

```
[DEBUG] hooks module secret-scrub@inline loaded (worker, environment 1, tier user); events: tool.call
[DEBUG] plugin.register: secret-scrub (user, secret-scrub@inline), judged by core alone: admitted
[ERROR] $.fs.read (secret-scrub): C:\…\PROOF-scrub.log failed: ENOENT: no such file or directory, open 'C:\…\PROOF-scrub.log'
[DEBUG] $.fs.write (secret-scrub): C:\…\PROOF-scrub.log (129 bytes)
[DEBUG] hooks module secret-scrub@inline tool.call settled in 34.4ms (worker hop, next() included)
```

Three things to know:

1. **A `$` call that you handled still logs at `[ERROR]`.** The `$.fs.read(LOG).catch(() => '')`
   read-modify-write is deliberate and the rejection is expected on the first call of a
   session, but the debug log says `[ERROR]` anyway. Do not go hunting for a bug.
2. Per-call cost: `34.4ms` (Read), `69.4ms` (Grep), `989.3ms` (Bash — that one included the
   `cat` underneath, since `next()` is counted in).
3. Claude Code's **own** debug log redacts plugin options: `[DEBUG] Checking plugin
   secret-scrub: [REDACTED], skillsPaths=0 paths`. That `[REDACTED]` is the engine's, not
   this mod's. Confusing when your mod's whole job is to write `[REDACTED:…]`.

Also recorded, harmless: `[WARN] plugin secret-scrub: [REDACTED] requested but its manifest
declares no userConfig; every option reads as absent` — `--plugin-dir` passes an options
object that the manifest never declared.

---

## 8. Tests

`tests/register.test.ts`, run with `claude plugin test .` (verbatim):

```
tests\register.test.ts:
(pass) register > masks a key in both the record and the model-facing text [37.12ms]
(pass) register > leaves a clean Bash result alone and logs nothing [16.67ms]

 2 pass
 0 fail
Ran 2 tests across 1 file. [0.27s]
```

The kit throws if an event the mod raises has no answering hook, so the tests must answer
`fs.read` and `fs.write` too. A `$` call is answered with `{ value: … }`
(`fs.read` → `{ value: '' }`, `fs.write` → `{ value: undefined }`); the event shapes are in
`claude-code.d.ts` around lines 5640 and 5810.

---

## 9. What did NOT work

- **Scrubbing `r.text` only** — section 3. The documented template. Silently ineffective.
- **One shared hit counter for the record and the text** — double-counted every kind.
- **`(_m, keep?: string)` in the replace callback** — section 4; wrote match offsets into
  the output.
- **`next.called ? next(e) : …` in `.catch`** — correct for most mods, wrong for a scrubber;
  it replays the unscrubbed result.
- **Not tried, and it would fail:** returning `{ result }` while expecting core to keep its
  own `text`. Run two above shows core rebuilds the text from `result`, so a hook that
  returns a *partial* record would hand the model a truncated file, not an unchanged one.
