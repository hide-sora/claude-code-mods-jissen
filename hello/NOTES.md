# hello-guard — build notes (2.1.278, Windows 11, Git Bash, 2026-09-21)

## validate
```
  ❯ ./register.ts hooks: session.start, tool.call{tool=Bash}
  ❯ ./register.ts calls: $.fs.write
✔ Validation passed
```

## -p run (good version): PROOF.txt
```
session.start at 2026-09-20T16:31:53.468Z cwd=C:\Users\lifes\kasegu surface=null interactive=false plugin=hello-guard
```

## deny run: DENY.txt
```
denied: echo 'rm -rf /'
```

## the failing version ($.plugin.name() called as a function): debug-bad.log excerpt
```
[DEBUG] Read hooks.json for plugin hello-guard (enabled=true): C:\Users\lifes\kasegu\mods\hello\hooks\hooks.json
[DEBUG] Loaded inline plugin from path: hello-guard
[DEBUG] Checking plugin hello-guard: skillsPath=none, skillsPaths=0 paths
[WARN] plugin hello-guard: options requested but its manifest declares no userConfig; every option reads as absent
[DEBUG] hooks module hello-guard@inline loaded (worker, environment 1, tier user); events: session.start,tool.call
[DEBUG] engine.create: no plugin-provided interfaces; $ built for hello-guard,jev-model-router,agents-md
[DEBUG] plugin.register: hello-guard (user, hello-guard@inline), judged by core alone: admitted
[ERROR] hook failed: hello-guard: errorKind=TypeError errorChars=89 (session.start; skipped; its last next() run's result stands)
[DEBUG] [hello-guard] $.ui.log: session.start hook skipped: threw TypeError: $.plugin.name is not a function. (In '$.plugin.name()', '$.plugin.name' is "hello-guard")
[DEBUG] hooks module hello-guard@inline session.start settled in 12.3ms (worker hop, next() included)
```

## good run: debug.log excerpt
```
[DEBUG] Read hooks.json for plugin hello-guard (enabled=true): C:\Users\lifes\kasegu\mods\hello\hooks\hooks.json
[DEBUG] Loaded inline plugin from path: hello-guard
[DEBUG] Checking plugin hello-guard: skillsPath=none, skillsPaths=0 paths
[WARN] plugin hello-guard: options requested but its manifest declares no userConfig; every option reads as absent
[DEBUG] hooks module hello-guard@inline loaded (worker, environment 1, tier user); events: session.start,tool.call
[DEBUG] engine.create: no plugin-provided interfaces; $ built for hello-guard,jev-model-router,agents-md
[DEBUG] plugin.register: hello-guard (user, hello-guard@inline), judged by core alone: admitted
[DEBUG] $.fs.write (hello-guard): C:\Users\lifes\kasegu\mods\hello\PROOF.txt (118 bytes)
[DEBUG] hooks module hello-guard@inline session.start settled in 11.1ms (worker hop, next() included)
```
