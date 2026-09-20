export function register(on: any) {
  on("session.start", async ($: any, e: any, next: any) => {
    const r = await next(e);
    const line = `session.start fired at ${new Date().toISOString()} cwd=${e.cwd} surface=${e.surface} interactive=${e.isInteractive} plugin=${$.plugin.name}\n`;
    await $.fs.write("C:/Users/lifes/kasegu/mods/hello/PROOF.txt", line);
    return r;
  });
  on("tool.call", { tool: "Bash" }, async ($: any, e: any, next: any) => {
    if (typeof e.command === "string" && e.command.includes("rm -rf /")) {
      await $.fs.write("C:/Users/lifes/kasegu/mods/hello/DENY.txt", `denied: ${e.command}\n`);
      return { deny: "hello-mod: blocked a destructive command" };
    }
    return next(e);
  });
}
