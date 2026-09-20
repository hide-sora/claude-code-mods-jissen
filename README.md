# Claude Code Mods 実践ガイド ― コード

Zenn 本『Claude Code Mods 実践ガイド ― 関数フックで本体を改造する、動く Mod 7本』のコードです。
Claude Code 2.1.278 で `claude plugin validate` / `claude -p` の証拠ファイル / `claude plugin test` を通しています。各フォルダの `NOTES.md` に検証ログの全文があります。

| 章 | Mod | 何をするか |
|---|---|---|
| 2 | `hello/`（hello-guard） | 起動を記録し、`rm -rf /` を含む Bash を拒否する練習台 |
| 4 | `usage-watch/` | 使用量とレート制限をステータス行に常駐、80/90% でトースト |
| 5 | `secret-scrub/` | Read / Grep / Bash の結果から秘密情報をマスクしてからモデルに渡す |
| 6 | `intent-guard/` | 危険そうな Bash を小さなモデルに判定させて拒否 |
| 7 | `work-log/` | ターンごとの作業日誌と `/worklog` |
| 8 | `model-router/` | `turn.step` でモデルと effort を振り分け、`/route` で固定 |
| 9 | `notes-tool/` | モデルに `note_add` / `note_list` ツールを渡す |
| 10 | `band-meter/` | プロンプト上のバンドに使用量バーと hide ボタンを描く（テストキットで検証） |

- `_docs/slash-commands-in-p.md` — `claude -p` とスラッシュコマンドの実測（Git Bash の MSYS パス変換）
- `_badshapes/` — バリデータが拒否する 4 つの書き方と、その出力

使い方: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` を設定し、`claude --plugin-dir ./usage-watch` のように読み込みます。関数フックは early access で、API はリリースごとに変わり得ます。

ライセンス: MIT
