# model-router

`turn.step` を使って、モデルへのリクエストを 1 回ずつ振り分ける Mod。

## ルール

| # | 条件 | 書き換え |
|---|---|---|
| 1 | `e.agentId` がある（サブエージェントのループ） | `model` を `claude-haiku-4-5-20251001` に |
| 2 | メインループで `e.index === 0`、直前のプロンプトが 80 文字未満 | `effort` を `low` に |
| 3 | `/route <model>` で上書きが設定済み | メインループの `model` をその値に |

ルール 3 の上書きは `$.store` に残るので、次のセッションでも効く。`/route auto` で解除。

## 使い方

```sh
claude --plugin-dir C:/Users/lifes/kasegu/mods/model-router
```

グローバル設定の `env` に `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` が必要。

## 証拠ログ

`turn.step` が 1 回走るたびに `PROOF-steps.log` に 1 行追記される。

```
index=0 | loop=a16bed91c0e2520c2 | rule=subagent | model=claude-opus-5[1m] -> claude-haiku-4-5-20251001 | effort=high -> high | messages=10 | answered=claude-haiku-4-5-20251001 | stop=end_turn | tools=0 | trace=jev-model-router/user:returned > engine/core:returned
```

`answered=` は結果の `usage.model`、つまり **実際に答えたモデル**。ここが書き換え後の
id になっていれば、書き換えが API まで届いたということ。

## 注意（重要）

`turn.step` の `model` は **そのまま API に送られる**。`'haiku'` のようなエイリアスは
解決されず、リクエストが 404 (`not_found_error, model: haiku`) で落ちる。だから
この Mod は `MODEL_IDS` で id に直してから渡している。詳細は `NOTES.md`。

## テスト

```sh
claude plugin validate .
claude plugin test .
```
