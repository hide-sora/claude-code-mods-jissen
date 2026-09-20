# band-meter — build notes

Environment: Claude Code **2.1.278**, Windows 11, Git Bash. Function hooks enabled
globally. Types copied by hand from
`C:/Users/lifes/kasegu/ref/claude-code/mods/types/claude-code.d.ts` into
`.claude/types/claude-code.d.ts`; **that file's first line says it was written by
Claude Code 2.1.277**, one patch behind the binary that ran the tests. Nothing in
the surface used here disagreed with the running build, but the honest way to get
them is `/plugin-types` inside a session in this folder.

## 1. `claude plugin validate .` — verbatim

```
Validating plugin manifest: C:\Users\lifes\kasegu\mods\band-meter\.claude-plugin\plugin.json

Validating hooks: C:\Users\lifes\kasegu\mods\band-meter\hooks\hooks.json

  ❯ ./register.tsx hooks: session.start, command.run{command=meter}, session.measure, ui.render{component=AbovePrompt}
  ❯ ./register.tsx calls: $.command.register, $.session.usage, $.store.get, $.store.set, $.ui.invalidate, $.ui.log, $.ui.resolve

✔ Validation passed
```

There is **no `surface modules:` line**. The validator prints that line only when
the module draws a `Client`, and band-meter draws none — it is `Box` / `Text` /
`Button` from `$.ui.resolve(e)` and nothing else. (Confirmed against
`gotchas.md` item 8: "prints `hooks:` and `calls:` per module and
`surface modules:` when Client modules exist".)

Note what the `calls:` line does **not** list: no `$.fs.*`, no `$.process.*`, no
`$.fetch`. That inventory is the mod's whole reach.

## 2. `claude plugin test .` — verbatim (final, green)

```
tests\register.test.tsx:
(pass) band-meter > draws the meter and hides it when the button is pressed [58.18ms]
(pass) band-meter > draws on every surface whose table has Box, Text and Button [30.33ms]
(pass) band-meter > /meter hides the row and shows it again [26.99ms]
(pass) band-meter > a measurement moves the figures and redraws [22.11ms]

 4 pass
 0 fail
Ran 4 tests across 1 file. [0.38s]
```

## 3. Every kit error hit, verbatim, and the fix

### 3.1 No bottom for `ui.render`

First run, all four tests:

```
Error: $.ui.mount: no implementation for ui.render

nothing beneath the plugins answers ui.render: a test answers it with on('ui.render', ...)
```

`$.ui.mount` raises the real `ui.render` chain, and the chain needs a bottom. The
engine itself draws nothing in the band, so the test stands in for it with an
empty `Box`:

```ts
const EMPTY: RenderElement = { type: 'Box', children: [] }
on('ui.render', { component: 'AbovePrompt' }, () => EMPTY)
```

Returning `undefined` is not an option: `ResultOf['ui.render']` is
`RenderElement`, and the diff mod's own fixture does the same thing for
`PromptHint` (`tests/fixtures/hint-drawn.ts`).

### 3.2 No bottom for `session.measure`

```
Error: no implementation for session.measure

nothing beneath the plugins answers session.measure: a test answers it with on('session.measure', ...)
```

Fixed with the core echo the declarations describe (`SessionMeasureResult` is
`{ changed }`):

```ts
on('session.measure', ($, e) => ({ changed: e.changed }))
```

### 3.3 A failure that was the test's fault, not the mod's

```
(fail) band-meter > draws on every surface whose table has Box, Text and Button [23.04ms]
  Error: desktop

  expect(received).toBeDefined()

  Expected: defined
  Received: undefined
```

`shown` is module state. Inside **one** test the module is loaded once, so the
`terminal` iteration pressing `hide` left `shown === false` and the `desktop`
mount drew nothing. Across separate `test()` bodies the module *is* fresh (test 3
found the row drawn after test 1 had hidden it). Fix: put the state back between
surfaces with `await $.command.run(METER)` (the `/meter` toggle) rather than
reaching into the module.

This is worth keeping in the book: **the kit gives each test a fresh plugin
environment, but not each `mount`.**

### 3.4 Events that needed **no** bottom hook

- `ui.invalidate` — the diff mod's fixtures answer it
  (`on('ui.invalidate', () => ({ value: undefined }))`), so I expected to need it.
  Under `$.ui.mount` it is **already answered**: the mounted drawing follows the
  plugin's own invalidation before the next read, exactly as `MountedMembers.redraw`
  documents ("A plugin's own `$.ui.invalidate` needs no call"). Adding the hook is
  unnecessary here.
- `ui.press` — `ui.press({ key })` is served by the kit; no lower hook needed.
- `ui.log` — never reached, because `$.store.set` never failed under `mock.store`.
- `$.session.usage` and `command.register` **did** need bottoms
  (`on('session.usage', () => ({ value: USAGE }))`,
  `on('command.register', ($, e) => ({ value: { command: e.name } }))`) — both are
  "op" events, so the answer is wrapped in `{ value }`, unlike `session.start`'s
  `{ cwd }` echo.

## 4. The exact API calls that worked

Mount (`EngineMount.mount` / `MountTarget`), one helper generic over the surface:

```ts
const band = <P extends RenderSurface>(surface: P): MountTarget<P, 'AbovePrompt'> => ({
  plugin: 'band-meter',
  surface,
  component: 'AbovePrompt',
  requestId: 'band',
  viewport: { columns: 100, rows: 40 },
  props: {
    hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 }, view: {},
  },
})

const ui = await $.ui.mount(band('terminal'))
```

`surface` is never defaulted — leaving it out is a rejection, by design ("one body
run over several surfaces is what shows independence").

Find, press, re-read:

```ts
const meter = await ui.find({ type: 'Text', text: /ctx/ })
expect(meter?.text).toBe('ctx ███░░░░░ 42%  5h 61%  7d 18%  $0.42')
expect((await ui.find({ key: 'hide' }))?.props.label).toBe('hide')

expect(await ui.press({ key: 'hide' })).toEqual({ element: 'hide' })

expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
```

**There is no `rerender()` step.** `MountedMembers` says each act "resolves once
the loop settled and what a plugin invalidated was drawn again", so the `find`
after `press` already reads the new tree. `ui.redraw(props)` exists but is for
*new props* from the engine, not for a redraw the plugin asked for itself.

`ui.press` returns `UiPressResult`, i.e. `{ element: 'hide' }` — the Button's key,
not the mod's own value.

The band's exact drawn text is asserted with `toBe`, and it is the string above:
`bar(42)` fills `round(42/100*8) = 3` of 8 cells.

## 5. The `AbovePrompt` props type, as declared

From `RenderPropsOf` (claude-code.d.ts around line 8117), with the comment that
matters most first — **"Raised on the terminal surface only."**

```ts
AbovePrompt: {
  hasSurvey: boolean    // true while a survey holds the band; a hook yields to it
  isWorking: boolean    // true while a model turn is running
  maxRows: number       // rows the band may take; the slot is capped at half the terminal
  bodyColumns: number   // cells across the band (the transcript column's width if a Pane is docked)
  scroll: SiteScroll    // { offset, bodyRows } — engine-owned window over a taller tree
  view: SiteView        // { agentId? } — which transcript is on screen above the band
}
```

All six are read-only. `maxRows` and `bodyColumns` are the two a drawing hook must
respect; the declaration is explicit that a table or rule should be sized to
`bodyColumns` and **not** to `viewport.columns` (they differ when a Pane is
docked). band-meter draws one row and slices the string to
`Math.max(12, e.props.bodyColumns - 10)`, leaving room for `[ hide ]`.

## 6. `ui.press` hook vs the Button's `onPress` — the finding

**`onPress` is the right form on this build.** The declarations settle it:

- `ButtonProps.onPress: () => void` — "What the press runs, in the plugin's own
  environment: **the bottom of the `ui.press` chain**."
- `'ui.press': UiPressArgument` — "`next(e)` runs the hooks beneath, then core:
  the element's own `onPress` closure, in its plugin's environment, resolving to
  `{ element }`."

So a `ui.press` hook matched on `{ plugin: 'band-meter', element: 'hide' }` is an
**interception** point (for watching or taking another plugin's presses), not the
way to answer your own Button. Registering one here would add a hook to the
validator's `hooks:` line and buy nothing. band-meter therefore has **no**
`ui.press` hook, and `ui.press({ key: 'hide' })` in the test still reaches the
closure, which is the proof that the chain bottoms out in `onPress`.

One consequence worth writing down: the `onPress` closure must do the visible work
**synchronously** before it awaits anything. band-meter sets `shown = false` and
calls `$.ui.invalidate('ui.render')` first, and only then fires the `$.store.set`
without awaiting it:

```tsx
onPress={() => {
  shown = false
  $.ui.invalidate('ui.render')
  $.store.set('shown', false).catch(() => $.ui.log('…', { to: 'debug' }))
}}
```

An `async` `onPress` that awaited the store before invalidating would leave the
kit's `press` act racing the redraw.

## 7. The `-p` harness — the render hook is never raised

```sh
cd C:/Users/lifes/kasegu && timeout 170 claude -p "Say OK" \
  --plugin-dir C:/Users/lifes/kasegu/mods/band-meter \
  --output-format text --debug-file C:/Users/lifes/kasegu/mods/band-meter/debug.log < /dev/null
```

Output: `OK`. `grep band-meter debug.log` (11 lines, the interesting ones):

```
[DEBUG] Read hooks.json for plugin band-meter (enabled=true): …\hooks\hooks.json
[DEBUG] Loaded inline plugin from path: band-meter
[WARN] plugin band-meter: options requested but its manifest declares no userConfig; every option reads as absent
[DEBUG] hooks module band-meter@inline loaded (worker, environment 1, tier user); events: session.start,command.run,session.measure,ui.render
[DEBUG] plugin.register: band-meter (user, band-meter@inline), judged by core alone: admitted
[DEBUG] $.command.register (band-meter): /meter listed
[DEBUG] hooks module band-meter@inline session.start settled in 40.1ms (worker hop, next() included)
[DEBUG] hooks module band-meter@inline session.measure settled in 5.3ms (worker hop, next() included)
```

`grep -c "ui.render" debug.log` → **1**, and that one line is the module's
*registration* list above. There is no `ui.render` **dispatch**, no `AbovePrompt`,
no `ui.invalidate` and no `ui.press` anywhere in the log.

**Confirmed, as expected: the render hook is never raised in a `-p` run.** The
lower hooks do fire — `session.start` ran, `/meter` was registered, and
`session.measure` fired once — so `-p` proves loading and non-drawing behaviour and
nothing about drawing. That is exactly why `claude plugin test` exists.

The `[WARN] … options requested but its manifest declares no userConfig` line is
**not** about band-meter's code. A second `-p` run with the unrelated `hello` mod
produced the identical warning under its own name:

```
[WARN] plugin hello-mod: options requested but its manifest declares no userConfig; every option reads as absent
```

So it is what `--plugin-dir` prints for any inline plugin whose manifest has no
`userConfig` block. Harmless.

## 8. `npx tsc -p .`

```
$ npx -p typescript@5.9 tsc -p .
$ echo $?
0
```

Zero output, exit 0, TypeScript 5.9.3, with `.claude/types/claude-code.d.ts` in
place. Without that file `tsc` fails on `Cannot find module 'claude-code'` — the
types are never committed (`.gitignore`).

Two details that made it compile clean:

- `$.ui.resolve(e)` is declared **synchronous**
  (`resolve: <E>(e: E) => Elements[E['surface']]`), so `await` is unnecessary;
  cc-arcade and `templates.md` both write `await $.ui.resolve(e)`, which also
  type-checks but is misleading.
- The `ui.render` matcher narrows `component`, not `surface`, so `e` stays a union
  over all four surfaces and `$.ui.resolve(e)` returns the **union** of element
  tables. Destructuring `{ Box, Button, Text }` works because every table has all
  three. Reaching for `Svg` or `Client` there would not type-check without
  narrowing `e.surface` first.

## 9. What did not work, and why

- **A `desktop` mount of `AbovePrompt` draws, but the real engine never raises it
  there.** The declaration says "Raised on the terminal surface only", and
  `gotchas.md` item 12 says nothing draws in the desktop app. The kit will still
  mount it, because the desktop element table has `Box`/`Text`/`Button` and the
  kit exercises *the mod*, not a surface's paint. The second test therefore proves
  the tree is surface-independent, **not** that a desktop user will see it. Do not
  read that test as a product claim.
- **`mobile` and `vscode` were not tested.** Both tables would draw this tree, but
  adding them would make the same non-claim four times over.
- **No interactive proof.** The band cannot be seen in `claude -p` (section 7) and
  an interactive session was out of scope here, so the only evidence that the row
  draws and hides is `claude plugin test`.
- **`$.ui.status` was considered and dropped.** It would pin the same figures under
  the prompt without any drawing at all, which would work in more places — but it
  is one line per plugin and would make the `AbovePrompt` exercise pointless.
- **`hotkey` on the Button was deliberately left off.** `ButtonProps.hotkey` warns
  that a bare digit typed into an empty composer presses a band Button; cc-arcade
  refuses hotkeys in the band for exactly that reason.
