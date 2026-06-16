# Git hooks

This repo ships a `commit-msg` hook that **strips AI co-author / attribution
trailers** from every commit message before the commit is finalized. It cleans
the message (removing only the offending lines) and never blocks the commit.

## Enable it

Hooks are not auto-installed on clone (git ignores in-repo hooks until you point
git at them). One repo-local command turns them on — it only changes the hooks
path, nothing else:

```bash
git config core.hooksPath .githooks
```

This is wired to run automatically on `pnpm install` via the root `prepare`
script, so in practice you rarely need to run it by hand.

> Note: `core.hooksPath` is a repo-local config for hook discovery only. It does
> **not** touch `user.name` / `user.email` or any identity setting.

## What it strips (case-insensitive)

- `Co-authored-by:` trailers naming `claude | anthropic | copilot | openai | ai assistant`
- `Generated-by:` trailers naming `claude | anthropic`
- Standalone `Claude Code` / `Anthropic` attribution lines
- `Generated with [Claude Code]` / `Generated with Anthropic` trailers

Everything else in the message is left exactly as written.

## Verify it works

```bash
./.githooks/test-commit-msg.sh      # asserts trailers are stripped, content kept
```
