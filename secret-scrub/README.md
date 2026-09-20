# secret-scrub

Read / Grep / Bash の**ツール結果**から、モデルが読む前に秘密情報を伏せ字にする mod。

隠すもの: OpenAI 形式のキー (`sk-…`)、AWS のアクセスキー ID (`AKIA…`)、GitHub トークン
(`ghp_…` など)、Slack トークン (`xox?-…`)、PEM の秘密鍵ブロック、`Authorization: Bearer` の値。
それぞれ `[REDACTED:openai]` のように種別つきで置き換える。

## 仕組み

`tool.call` を `{ tool: ['Read', 'Grep', 'Bash'] }` で受け、`await next(e)` で下から返ってきた
結果を書き換えて返す。ツールごとに結果の形が違う (Read は `result.file.content`、
Bash は `result.stdout`、Grep は型なし) ので、**構造体の中の文字列を全部たどって**置換する。

重要: モデルが実際に読むのは `result` (構造化レコード) のほう。`text` だけ書き換えても
素通しになる (NOTES.md の Gotcha 1 を参照)。

置換が 1 件でも起きた呼び出しは `PROOF-scrub.log` に 1 行記録する。

## 設定

不要。伏せ字のルールは `hooks/register.ts` の `RULES` 配列。

## 届く範囲 (Claude Code 2.1.278 で検証)

    ❯ ./register.ts hooks: tool.call{tool=Read|Grep|Bash}
    ❯ ./register.ts calls: $.fs.read, $.fs.write

Read / Grep / Bash の結果しか見ない。ネットワークもプロセスも触らない。書き込みは
自分のログ 1 ファイルだけ。**失敗時は fail closed** (伏せ字にできなければ結果を deny する)。

## 動かし方

```sh
cd mods/secret-scrub
claude plugin validate .
claude plugin test .
```

`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` が要る。フック非対応ビルドでは
`hooks/hooks.json` の `modules` が無視され、何もしない。

## 限界

- 正規表現に書いた形だけ。社内独自形式のトークンや base64 に包まれた鍵は素通しする。
- PEM ブロックは複数行まとめて 1 個の `[REDACTED:pem]` に畳まれるので、行番号が飛ぶ。
- ディスク上のファイル自体は書き換えない。伏せるのは**モデルに渡る結果だけ**。
