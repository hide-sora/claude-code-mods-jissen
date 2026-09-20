# band-meter

プロンプトの真上（`AbovePrompt` バンド）に 1 行だけ描く Claude Code の function-hooks mod です。

```
ctx ███░░░░░ 42%  5h 61%  7d 18%  $0.42   [ hide ]
```

- `ctx` … コンテキストウィンドウの使用率（8 セルのバー付き）
- `5h` / `7d` … 5 時間・7 日のレート制限ウィンドウの使用率
- `$` … このセッションの累計コスト（ホストが記録している場合のみ）
- `[ hide ]` … 押すとバンドを消す

数値は `session.start` で `$.session.usage()` を 1 回読み、以降は `session.measure`
イベントで更新します。描画のたびに計算はしません。

## 使い方

```sh
claude --plugin-dir /path/to/band-meter
```

`/meter` で表示・非表示を切り替えます。状態は `$.store` の `shown` キーに残るので、
次のセッションでも消えたままです（既定は表示）。

関数フックが有効な対話セッションでのみ描画されます。`claude -p` では `ui.render`
自体が発生しないため、何も描かれません（フック自体は動きます）。

## 開発

```sh
claude plugin validate .   # フックと $ 呼び出しの棚卸し
claude plugin test .       # tests/register.test.tsx
npx tsc -p .               # 型チェック
```

型は `/plugin-types` が `.claude/types/` に書き出します（git 管理外）。

## 到達範囲

Claude Code 2.1.278 で検証:

    ❯ ./register.tsx hooks: session.start, command.run{command=meter}, session.measure, ui.render{component=AbovePrompt}
    ❯ ./register.tsx calls: $.command.register, $.session.usage, $.store.get, $.store.set, $.ui.invalidate, $.ui.log, $.ui.resolve

ファイル・ネットワーク・プロセスには一切触りません。読むのはこのセッション自身の
使用量だけ、書くのは自分の `$.store` だけです。

MIT
