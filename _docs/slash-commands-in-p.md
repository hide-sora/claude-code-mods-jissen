## `claude -p` にスラッシュコマンドは渡るのか（実測）

検証者: 三宅ショウ / 日付: 2026-09-21 / Claude Code 2.1.278 / Windows 11 / Git Bash (MINGW64, MSYS)
手順: `../_shared/projects/zenn-mods-book/HARNESS.md` の 1（validate）→ 2（`-p` 動作証明）
対象 Mod: `C:/Users/lifes/kasegu/mods/work-log`（`/worklog` を `$.command.register` で登録し、`on('command.run', { command: 'worklog' }, ...)` で `next()` を呼ばずに答える）

### 0. 前提の確認

```
$ claude plugin validate .
  ❯ ./register.ts hooks: session.start, turn.start, tool.call, turn.complete, command.run{command=worklog}
  ❯ ./register.ts calls: $.command.register, $.fs.exists, $.fs.read, $.fs.write
✔ Validation passed
```

MSYS のパス変換が実在することを、claude を通さずに先に確認した（node の argv で見る）。

```
$ node -e 'console.log(JSON.stringify(process.argv.slice(1)))' "/worklog" "/cost" "/help"
["C:/Program Files/Git/worklog","C:/Program Files/Git/cost","C:/Program Files/Git/help"]

$ MSYS_NO_PATHCONV=1 node -e 'console.log(JSON.stringify(process.argv.slice(1)))' "/worklog" "/cost" "/help"
["/worklog","/cost","/help"]
```

つまり **`claude` が受け取る前に、シェルが引数を書き換えている**。これは Claude Code の挙動ではない。

### 1. 実行したコマンド（6 本 + 追加 1 本）

```bash
cd C:/Users/lifes/kasegu
[MSYS_NO_PATHCONV=1] timeout 170 claude -p "<PROMPT>" \
  --plugin-dir C:/Users/lifes/kasegu/mods/work-log \
  --output-format text --debug-file <desk>/dbg-N.log < /dev/null
```

全 7 本とも exit 0、`grep -i "hook failed"` は全ログで 0 件。

### 2. debug.log のイベント計数

`grep -nE "command.run|prompt.submit|answered"` を全ログにかけた結果を計数したもの。

| # | プロンプト | MSYS_NO_PATHCONV | prompt.submit | turn.start / complete | command.run | 標準出力の中身 |
|---|---|---|---|---|---|---|
| 1a | `/worklog` | なし | 1 | 1 / 1 | 0 | 散文（「MSYS のパス変換で化けています」と説明された） |
| 1b | `/worklog` | =1 | 0 | 0 / 0 | **1** | `work-log: # 2026-09-21 ...`（Mod が返した本文） |
| 2a | `/cost` | なし | 1 | 1 / 1 | 0 | 散文（`/cost` は組み込みなので実行できない、という説明） |
| 2b | `/cost` | =1 | 0 | 0 / 0 | 0 | **本物の使用量レポート**（`Current session: 29% used ...`） |
| 3a | `/help` | なし | 1 | 1 / 1 | 0 | 散文（`I'm ready to help.`） |
| 3b | `/help` | =1 | 0 | 0 / 0 | 0 | `/help isn't available in this environment.` |
| 4 | `//worklog` | なし | 0 | 0 / 0 | **1** | `work-log: # 2026-09-21 ...`（1b と同じ） |

### 3. 決定的なログ行

変換ありの回（1a）— `command.run` は 1 行も出ず、`prompt.submit` だけが走る。

```
dbg-1a.log:290 hooks module jev-model-router@skills-dir prompt.submit settled in 756.1ms (worker hop, next() included)
```

変換なしの回（1b）— A の報告どおりの行がそのまま出る。

```
dbg-1b.log:270 work-log (user) answered command.run without next() in 1.7ms; nothing beneath it ran for this dispatch
dbg-1b.log:271 hooks module work-log@inline command.run settled in 2.1ms (worker hop, next() included)
```

`prompt.submit` に「何が届いたか」の物証は、work-log 自身の turn ログにある。`turn.start` が受けた `e.text` がそのまま書かれている。

```
$ cat C:/Users/lifes/kasegu/mods/work-log/worklog/2026-09-21.md
- 01:18:38 (12.0s, answer) Glob x2, PowerShell, 3 errored — C:/Program Files/Git/worklog
- 01:19:04 (8.0s, answer) no tools — C:/Program Files/Git/cost
- 01:19:21 (4.2s, answer) no tools — C:/Program Files/Git/help
```

届いたのは「スラッシュを削った文」ではなく、**`C:/Program Files/Git/` を頭に付けた絶対パス文字列**。だから通常のプロンプトとして扱われ、散文が返る。

### 4. 結論（2×2 表）

引数が素通りする条件（`MSYS_NO_PATHCONV=1` を付ける、`//worklog` と二重スラッシュにする、あるいは PowerShell / cmd から起動する）を満たした場合の表。

| | `-p` で動く | `-p` で動かない |
|---|---|---|
| **プラグイン登録コマンド**（`/worklog`） | ○ ディスパッチされ、`command.run` フックが発火し、返した `text` が stdout に出る。`prompt.submit` / `turn.start` は走らない | — |
| **組み込みコマンド**（`/cost`） | ○ ディスパッチされ、本物の出力が stdout に出る。ただし `command.run` フックは発火しない（この経路は Mod から見えない） | △ `/help` のように対話 UI 前提のものは `/help isn't available in this environment.` と明示的に断られる（＝ディスパッチはされた上での拒否） |

Git Bash で変換を止めなかった場合は、上の 4 マス全部が「動かない」に落ちる。ただし原因は Claude Code ではなくシェルで、症状は「スラッシュコマンドが無視される」ではなく「別の文字列に化けた通常プロンプトが送られる」。

補足として、Mod 作者にとって重要な区別が 1 つある。**`command.run` はプラグインが登録したコマンドにしか流れない。** `/cost` は正しくディスパッチされているのに `command.run` は 0 件だった（dbg-2b）。組み込みコマンドを Mod からフックすることは、この経路ではできない。

### 5. A と B のどちらが正しいか（3 行）

1. A が正しい。MSYS のパス変換は実在し（`/worklog` → `C:/Program Files/Git/worklog`）、`MSYS_NO_PATHCONV=1` を付ければ `-p` でもプラグイン登録コマンドはディスパッチされ、`work-log (user) answered command.run without next()` が debug.log に出る（dbg-1b:270）。
2. B は観測は正確だが原因の切り分けを誤っている。`-p` が組み込みをディスパッチしないのではなく、B の Git Bash では `/cost` が `C:/Program Files/Git/cost` に化けて claude に届いていた（work-log の turn ログに現物が残っている）。変換を止めれば `/cost` は本物の使用量レポートを返す（dbg-2b）。
3. ただし B の「スラッシュを削った文が来る」という記述だけは不正確で、実際に来るのは Git のインストール先を前置した絶対パス文字列。また `/help` は変換を止めても `isn't available in this environment` と断られるので、「組み込みなら全部動く」とも言えない。

### 6. 本に書くときの推奨

- 検証コマンドは Git Bash 依存を避け、`--` の後ろに置くのではなく **`MSYS_NO_PATHCONV=1` を明示するか `//worklog` と書く**。後者は環境変数不要で、PowerShell / cmd / Linux でも壊れない書き方ではないため、本文では `MSYS_NO_PATHCONV=1` を正とし、`//` は脚注にする。
- HARNESS.md の 2 節に「スラッシュコマンドを `-p` に渡すときは `MSYS_NO_PATHCONV=1` を付ける」を追記すべき（編集長判断）。
