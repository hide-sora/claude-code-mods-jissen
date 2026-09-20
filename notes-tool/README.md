# notes-tool

モデルに道具を 2 つ、人にスラッシュコマンドを 1 つ足す Mod。中身は `$.store`。

| 名前 | 誰が使う | 何をする |
|---|---|---|
| `mcp__notes-tool__note_add` | モデル | `{ text }` を 1 件保存する |
| `mcp__notes-tool__note_list` | モデル | 保存済みのメモを番号付きで返す |
| `/notes` | 人 | 保存済みのメモを保存時刻つきで表示する |

`$.tool.register` で登録した道具の正式名は `mcp__<plugin>__<name>`。つまり
プラグイン名 `notes-tool` なので `mcp__notes-tool__note_add` になる。

## 使い方

```sh
claude --plugin-dir C:/Users/lifes/kasegu/mods/notes-tool
```

グローバル設定の `env` に `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` が必要。

## 保存場所

`$.store` は Claude Code の設定ディレクトリ配下にある、この Mod 専用の JSON ファイル。

```
C:\Users\lifes\.claude\plugins\store\notes-tool_inline-0716ddbdc635.json
```

セッションをまたいで残る（`claude -p` を 2 回に分けても `note_list` は前回のメモを返す）。

## 実装の要点

`tool.call` フックが `next` を呼ばずに `{ result: ... }` を返すと、そのフック自身が
道具の本体になる。拒否したいときは `{ deny: '<理由>' }`。`{ text }` や `{ content }`
ではない。詳細は `NOTES.md`。

## テスト

```sh
claude plugin validate .
claude plugin test .
```
