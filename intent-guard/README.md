# intent-guard

危なそうな Bash コマンドを **LLM に意図判定させて**止める mod。

正規表現だけのガードは言い換えで抜けられる。この mod では正規表現は「判定にかける価値が
あるか」だけを決め、実行するかどうかは Haiku が `safe` / `destructive` で判定する。

## 仕組み

1. `tool.call` を `{ tool: 'Bash' }` で受ける。
2. 安価なトリガ正規表現 (`rm` / `git push --force` / `DROP TABLE` / `mkfs` / `curl … | sh` など)
   に当たらなければ、そのまま `next(e)`。モデル呼び出しは**一切しない**。
3. 当たったら `$.model.classify(…, ['safe', 'destructive'], { model: 'haiku' })` にかける。
4. `destructive` なら `{ deny: … }` で拒否。`safe` / ラベル無しなら `next(e)`。
5. judge が失敗 (API エラー等) したら **deny**。判定できないものは通さない (fail closed)。

判定したコマンドは所要時間つきで `PROOF-guard.log` に記録する。実測でおよそ 500〜750 ms。

## 判定文の作り方が要

コマンド文字列をそのまま classify に渡すと、Haiku は `rm -rf <フォルダ>` を **safe** と
答えた (実測)。`destructive` / `safe` の定義を短く添えた文に包んで初めて `destructive` に
なる。`hooks/register.ts` の `question` を参照。

## 届く範囲 (Claude Code 2.1.278 で検証)

    ❯ ./register.ts hooks: tool.call{tool=Bash}
    ❯ ./register.ts calls: $.fs.read, $.fs.write, $.model.classify

Bash の呼び出ししか見ない。コマンド文字列は判定のためセッション自身の API クライアントへ
送られる (外部サービスへは出ない)。書き込みは自分のログ 1 ファイルだけ。

## 動かし方

```sh
cd mods/intent-guard
claude plugin validate .
claude plugin test .
```

`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` が要る。

## 限界

- **トリガ正規表現に当たらないものは judge にすら届かない。** 実測で
  `find <dir> -type f -delete` は素通りしてファイルを消した (`\bdel\b` は `delete` に
  当たらないため)。言い換え耐性があるのは「judge に届いた後」だけ。
- judge は 1 回のモデル呼び出し。同じコマンドでも答えがぶれる可能性がある。
- Bash 1 回につき最大 1 回のモデル呼び出しぶん遅くなる (実測 500〜750 ms)。
