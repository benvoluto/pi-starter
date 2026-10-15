#!/usr/bin/env bash
# Fails if tracked files look like they contain secrets or org-specific values.
# Run before pushing; CI runs it too.
set -euo pipefail
cd "$(dirname "$0")/.."

files=$(git ls-files | grep -v -e '^scripts/check-no-secrets.sh$')
fail=0
check() { # label, regex
  if hits=$(grep -nIE "$2" $files 2>/dev/null); then
    echo "✗ $1:"; echo "$hits" | sed 's/^/    /'; fail=1
  fi
}

check "API key-looking values"      '(sk-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})'
check "literal apiKey / secret / token values (use \${VAR})" '"(apiKey|clientSecret|token|password)"[[:space:]]*:[[:space:]]*"[^"$!{]'
check "org-specific hostnames"      '[a-z0-9-]+\.glean\.com'
check "numeric OAuth client IDs (put them in org.env)" '"clientId"[[:space:]]*:[[:space:]]*"[0-9.]{8,}"'
check "personal home paths"         '/Users/[a-z]+/|/home/[a-z]+/'
git ls-files --error-unmatch org.env >/dev/null 2>&1 && { echo "✗ org.env is tracked"; fail=1; }

[ $fail -eq 0 ] && echo "✓ no secrets or org-specific values found"
exit $fail
