# usage-watch

セッションの使用量をステータス行に出し、プラン枠が埋まってきたら警告する Mod。

## 何をするか

- `session.measure` を購読して、`ctx 42% | 5h 61% | 7d 18% | $0.42` という 1 行を
  `$.ui.status()` でプロンプト下にピン留めする。
- レート制限の窓 (`five_hour` / `seven_day` / `spend_limit`) が **80% / 90% を上向きに
  跨いだ瞬間だけ** `$.ui.toast()` で警告する。跨いだ段は `$.store` に保存するので、
  再起動しても同じ段で二度鳴らない。下がれば再武装する。
- `session.start` で `$.session.usage()` を 1 回だけ読み、その戻り値そのままを
  `PROOF-usage.json` に書く (本の中で実物の形を見せるため)。
- `session.measure` が走るたびに `PROOF-measure.log` へ 1 行追記する。

## 読み込み方

関数フックは早期アクセス機能なので `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` が要る。

```sh
claude --plugin-dir C:/Users/lifes/kasegu/mods/usage-watch
```

ヘッドレスで確かめるなら:

```sh
claude -p "hello" --plugin-dir C:/Users/lifes/kasegu/mods/usage-watch --output-format text
```

`-p` では画面に何も描かれない (`$.ui.status` はデバッグログに
`no status row in a headless session` と残るだけ)。証拠はプルーフファイルで見る。

## 手が届く範囲 (Claude Code 2.1.278 で検証済み)

```
❯ ./register.ts hooks: session.start, session.measure
❯ ./register.ts calls: $.fs.exists, $.fs.read, $.fs.write, $.session.usage, $.store.get, $.store.set, $.ui.status, $.ui.toast
✔ Validation passed
```

観測専用のイベントしか取らない。ツール呼び出しもプロンプトも見ないし、書き込むのは
自分のディレクトリ配下の 2 つのプルーフファイルだけ。ネットワークには一切触れない。

## テスト

```sh
claude plugin test .
```

`tests/register.test.ts` が、ステータス行の文字列・プルーフログの追記・
80/90% の立ち上がりエッジ (79 → 83 → 88 → 91 で 2 回だけ鳴ること) を検証する。
