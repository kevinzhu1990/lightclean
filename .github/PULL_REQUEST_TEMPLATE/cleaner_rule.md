<!-- This template is for PRs that add or modify cleaner rules in rules/ -->

## New cleaner rule

**App name:** <!-- e.g. Notion -->
**Category:** <!-- apps / browsers / gaming / gpu-cache / system / databases -->
**Platforms:** <!-- Windows / macOS / Linux -->

## Paths added

```
<!-- List the paths you added, e.g.: -->
<!-- win32: ${APPDATA}/Notion/Cache/Cache_Data -->
<!-- darwin: ${CACHES}/notion.id -->
```

## Safety checklist

- [ ] Paths **only** target cache, temp, or log data — no user documents, settings, passwords, or session tokens
- [ ] Verified paths exist on my machine and contain only disposable data
- [ ] Used forward slashes in all paths (the loader converts to backslashes on Windows)
- [ ] App ID is lowercase with hyphens (e.g. `my-app`)
- [ ] `npm run validate:rules` passes
- [ ] `npm test` passes

## How I verified

<!-- Briefly describe how you confirmed these paths are safe to clean -->

Fixes # <!-- Link to issue if applicable -->
