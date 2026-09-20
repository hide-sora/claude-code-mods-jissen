# work-log

1 ターンにつき 1 行の作業ログを、毎日の Markdown ファイルに自動で書き溜める Mod。

## 何をするか

- `turn.start` でターン ID とプロンプト本文を覚える。
- `tool.call` (マッチャなし) でツール名ごとの回数を数える。`await next(e)` を先に
  実行してから数えるので、拒否 (`deny`) とエラー (`isError`) も結果から拾える。
  ツールの**引数は一切読まない** — 名前と結果だけ。
- `turn.complete` で `<logDir>/YYYY-MM-DD.md` に 1 行追記する:

```markdown
# 2026-09-21

- 01:07:01 (6.2s, answer) Bash x2 — Run the bash command: echo work-log-proof . Then run it a se
- 01:07:36 (16.4s, answer) Glob, PowerShell, 1 errored — C:/Program Files/Git/worklog
```

  時刻 / 所要時間 / 終了理由 / ツール内訳 / プロンプト先頭 60 文字。

- `session.start` で `/worklog` を `$.command.register` し、`command.run` で
  今日のファイルの中身を返す (無ければ `work-log: no log yet (<path>)`)。

## 書き出し先の設定

`plugin.json` の `userConfig.logDir` で変えられる。空のままなら
`<プラグインのディレクトリ>/worklog`。設定値は `register(on, options)` の
**第 2 引数**に届く。届く経路はユーザー設定 / `--settings` / 管理設定のみで、
**プロジェクト設定は読まれない**。

```json
{ "pluginConfigs": { "work-log@inline": { "options": { "logDir": "D:/logs" } } } }
```

## 読み込み方

```sh
claude --plugin-dir C:/Users/lifes/kasegu/mods/work-log
```

ヘッドレスでも動く。スラッシュコマンドも `-p` から実行できる (Git Bash では
先頭スラッシュがパスに変換されるので `MSYS_NO_PATHCONV=1` が要る):

```sh
MSYS_NO_PATHCONV=1 claude -p "/worklog" --plugin-dir <この Mod> --output-format text
```

## 手が届く範囲 (Claude Code 2.1.278 で検証済み)

```
❯ ./register.ts hooks: session.start, turn.start, tool.call, turn.complete, command.run{command=worklog}
❯ ./register.ts calls: $.command.register, $.fs.exists, $.fs.read, $.fs.write
✔ Validation passed
```

`tool.call` をマッチャなしで取るため、**すべてのツール呼び出しが見える**。ただし
記録するのはツール名と成否だけで、引数も出力もログには残らない。書き込みは
`logDir` 配下のみ。ネットワークには一切触れない。

## テスト

```sh
claude plugin test .
```

ターン行の生成 (ツール回数と deny の計上) と、`/worklog` の 2 状態を検証する。
