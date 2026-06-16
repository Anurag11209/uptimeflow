#!/usr/bin/env bash
#
# Self-contained test for the commit-msg hook. Feeds a sample message containing
# several AI attribution trailers through the hook and asserts they are gone
# while the real content survives. No commit is made.
#
#   ./.githooks/test-commit-msg.sh   # exits 0 on pass, 1 on fail
#
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
hook="$here/commit-msg"

sample="$(mktemp)"
cat > "$sample" <<'EOF'
feat(thing): do the thing

A real body paragraph that mentions the word generated in normal prose
and must be preserved exactly as written.

Co-authored-by: A Real Human <human@example.com>
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Co-authored-by: Copilot <copilot@github.com>
Generated-by: Claude
🤖 Generated with [Claude Code](https://claude.com/claude-code)
Claude Code
Anthropic
EOF

bash "$hook" "$sample"

fail=0
assert_absent() {
  if grep -iqE "$1" "$sample"; then echo "FAIL: still present -> $1"; fail=1; fi
}
assert_present() {
  if ! grep -qF "$1" "$sample"; then echo "FAIL: missing -> $1"; fail=1; fi
}

# AI trailers must be gone
assert_absent 'co-authored-by:.*(claude|anthropic|copilot|openai|ai assistant)'
assert_absent 'generated-by:.*(claude|anthropic)'
assert_absent 'generated with.*(claude code|anthropic)'
assert_absent '^[[:space:]]*claude code[[:space:]]*$'
assert_absent '^[[:space:]]*anthropic[[:space:]]*$'

# Real content must survive
assert_present 'feat(thing): do the thing'
assert_present 'mentions the word generated in normal prose'
assert_present 'Co-authored-by: A Real Human <human@example.com>'

rm -f "$sample"

if [ "$fail" -eq 0 ]; then
  echo "PASS: AI attribution stripped, human content preserved."
else
  echo "TEST FAILED"; exit 1
fi
