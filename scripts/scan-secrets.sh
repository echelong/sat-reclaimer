#!/usr/bin/env bash
#
# Scan the Git history (or the working tree) for committed secrets, key material
# and wallet artefacts.
#
# This is the gate that runs before the repository is published and on every push
# afterwards. History mode scans every blob in every commit, not the latest tree:
# removing a secret from the latest commit does not remove it from the history
# that GitHub serves, so a working-tree-only check would be worthless as a
# publication gate.
#
# It needs only git and grep, so it works offline and in any CI environment.
#
# Usage:
#   ./scripts/scan-secrets.sh            # scan all history (the publication gate)
#   ./scripts/scan-secrets.sh --tree     # scan tracked files in the working tree
#
# Exit status is non-zero if anything matched.

set -euo pipefail

MODE="${1:-history}"
if [ "$MODE" != "--tree" ] && [ "$MODE" != "history" ]; then
  echo "usage: $0 [--tree]" >&2
  exit 2
fi

FAILED=0

# Every pattern is either a real secret format or a phrase whose presence in a
# commit needs a human to confirm it is only prose. They are matched
# case-insensitively unless noted.
PATTERNS=(
  'BEGIN (RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY'
  'BEGIN (mnemonic|seed)'
  'xprv[0-9a-zA-Z]{20,}'
  'tprv[0-9a-zA-Z]{20,}'
  'yprv[0-9a-zA-Z]{20,}'
  'zprv[0-9a-zA-Z]{20,}'
  'vprv[0-9a-zA-Z]{20,}'
  'gh[pousr]_[A-Za-z0-9]{16,}'
  'github_pat_[A-Za-z0-9_]{20,}'
  'sk-ant-[A-Za-z0-9-]{20,}'
  'sk-[A-Za-z0-9]{32,}'
  'AKIA[0-9A-Z]{16}'
  'ASIA[0-9A-Z]{16}'
  'aws_secret_access_key'
  'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.'
  'postgres(ql)?://[^[:space:]]*:[^[:space:]]*@'
  'mongodb(\+srv)?://[^[:space:]]*:[^[:space:]]*@'
  'redis://[^[:space:]]*:[^[:space:]]*@'
  '(api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'[:space:]]{8,}'
)

# Files that must never be committed at all. Anchored on a path separator so
# `src/lib/env.ts` is not mistaken for an environment file.
FORBIDDEN_FILES='(^|/)\.env$|(^|/)\.env\.local$|(^|/)\.env\.development$|(^|/)\.env\.production$|(^|/)\.npmrc$|(^|/)\.netrc$|(^|/)id_(rsa|dsa|ecdsa|ed25519)$|\.(pem|pfx|p12|keystore)$|(^|/)wallet\.dat$|(^|/)\.DS_Store$|(^|/)\.dev\.vars$|(^|/)tsconfig\.tsbuildinfo$'

# The scanner contains these patterns as data, so it would always match itself.
# It is excluded by pathspec rather than by weakening a pattern.
SELF=':!scripts/scan-secrets.sh'

say() { printf '%s\n' "$*"; }

run_grep() {
  local pattern="$1"
  local out
  if [ "$MODE" = "--tree" ]; then
    # `git grep` without a revision searches tracked files in the working tree,
    # so .gitignore'd local files such as .env.local are correctly skipped.
    out="$(git grep -InE -i -e "$pattern" -- . "$SELF" 2>/dev/null || true)"
  else
    out="$(git grep -InE -i -e "$pattern" "$(git rev-list --all | tr '\n' ' ')" -- "$SELF" 2>/dev/null || true)"
  fi
  # Truncate aggressively: a matched line in a minified bundle is megabytes long
  # and printing it hides every other finding.
  printf '%s\n' "$out" | cut -c1-200 | head -n 5
}

say "==> scanning for forbidden files ($MODE mode)"
if [ "$MODE" = "--tree" ]; then
  FILES="$(git ls-files || true)"
else
  FILES="$(git log --all --pretty=format: --name-only | sort -u | grep -v '^$' || true)"
fi
MATCHED_FILES="$(printf '%s\n' "$FILES" | grep -E "$FORBIDDEN_FILES" || true)"
if [ -n "$MATCHED_FILES" ]; then
  say "FAIL: forbidden files are tracked:"
  printf '%s\n' "$MATCHED_FILES"
  FAILED=1
else
  say "ok: no env files, key files, wallet files or build caches"
fi

say "==> scanning for key material, tokens and credentials ($MODE mode)"
for pattern in "${PATTERNS[@]}"; do
  HITS="$(run_grep "$pattern")"
  if [ -n "$HITS" ]; then
    say "FAIL: pattern matched: $pattern"
    printf '%s\n' "$HITS"
    FAILED=1
  fi
done

say "==> scanning deployment configuration for an enabled Mainnet flag"
# A committed env file or deployment manifest that turns Mainnet on would ship a
# public site with real BTC enabled. The README and the docs legitimately show the
# flag in prose, so this check is scoped to configuration file types rather than
# to every file, and a committed .env file is independently forbidden above.
if [ "$MODE" = "--tree" ]; then
  FLAG_HITS="$(git grep -InE -i \
    -e 'NEXT_PUBLIC_ENABLE_MAINNET(_BROADCAST)?[[:space:]]*[:=][[:space:]]*["\x27]?true' \
    -- '*.yml' '*.yaml' '*.json' '*.toml' '*.env*' '*.sh' '*.conf' '*.ini' 'Dockerfile*' "$SELF" \
    2>/dev/null || true)"
else
  FLAG_HITS="$(git grep -InE -i \
    -e 'NEXT_PUBLIC_ENABLE_MAINNET(_BROADCAST)?[[:space:]]*[:=][[:space:]]*["\x27]?true' \
    "$(git rev-list --all | tr '\n' ' ')" \
    -- '*.yml' '*.yaml' '*.json' '*.toml' '*.env*' '*.sh' '*.conf' '*.ini' 'Dockerfile*' "$SELF" \
    2>/dev/null || true)"
fi
FLAG_HITS="$(printf '%s\n' "$FLAG_HITS" | cut -c1-200 | head -n 5)"
if [ -n "$FLAG_HITS" ]; then
  say "FAIL: a deployment or environment file enables Mainnet:"
  printf '%s\n' "$FLAG_HITS"
  FAILED=1
else
  say "ok: no configuration file enables Mainnet"
fi

if [ "$FAILED" -ne 0 ]; then
  say ""
  say "Secret scan FAILED. Do not publish, do not push."
  say "If a match is documentation that talks ABOUT seed phrases rather than"
  say "containing one, narrow the pattern in this script and say so in the commit"
  say "message. Never delete a real secret from the latest commit and call it"
  say "fixed: the history is what gets published, so rewrite it instead."
  exit 1
fi

say "ok: no key material, credential or token pattern matched"
say "Secret scan PASSED ($MODE mode)."
