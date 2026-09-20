export function register(on) {
  // 起動を証拠として残す。-p 実行では画面に何も出ないので、ファイルに書く
  on("session.start", async ($, e, next) => {
    const r = await next(e)
    const line =
      `session.start at ${new Date().toISOString()} ` +
      `cwd=${e.cwd} surface=${e.surface} interactive=${e.isInteractive} ` +
      `plugin=${$.plugin.name}\n`
    await $.fs.write(`${$.plugin.root}/PROOF.txt`, line)
    return r
  })

  // 危険なコマンドを拒否する。next を呼ばずに返すと、ツールは実行されない
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    if (typeof e.command === "string" && e.command.includes("rm -rf /")) {
      await $.fs.write(`${$.plugin.root}/DENY.txt`, `denied: ${e.command}\n`)
      return { deny: "hello-guard: blocked a destructive command" }
    }
    return next(e)
  })
}
