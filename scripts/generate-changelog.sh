#!/usr/bin/env bash
# generate-changelog.sh — Generate CHANGELOG.md from conventional commits
# Usage: ./scripts/generate-changelog.sh [--since <tag>] [--output <file>]
#
# Conventional commit prefixes supported:
#   feat:     New features
#   fix:      Bug fixes
#   docs:     Documentation
#   style:    Formatting, no logic change
#   refactor: Code refactor
#   perf:     Performance improvement
#   test:     Tests
#   chore:    Build, deps, tooling
#   ci:       CI/CD changes

set -euo pipefail

OUTPUT="${CHANGELOG_OUTPUT:-CHANGELOG.md}"
SINCE=""
REPO_URL=""

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --since)   SINCE="$2";  shift 2 ;;
    --output)  OUTPUT="$2"; shift 2 ;;
    --help)
      echo "Usage: $0 [--since <tag|commit>] [--output <file>]"
      exit 0
      ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# Detect remote URL for commit links
if git remote get-url origin &>/dev/null; then
  REPO_URL=$(git remote get-url origin \
    | sed 's/git@github.com:/https:\/\/github.com\//' \
    | sed 's/\.git$//')
fi

# Git log range
GIT_RANGE=""
if [[ -n "$SINCE" ]]; then
  GIT_RANGE="${SINCE}..HEAD"
fi

# Collect commits
ALL_COMMITS=$(git log $GIT_RANGE --pretty=format:"%H|%s|%as" --no-merges 2>/dev/null || true)

if [[ -z "$ALL_COMMITS" ]]; then
  echo "⚠️  No commits found (range: ${GIT_RANGE:-all})"
  exit 0
fi

# Section arrays
declare -a FEATS FIXES DOCS STYLES REFACTORS PERFS TESTS CHORES CIS OTHERS

while IFS='|' read -r hash subject date; do
  short="${hash:0:7}"
  # Build commit link if repo URL known
  if [[ -n "$REPO_URL" ]]; then
    link="[\`${short}\`](${REPO_URL}/commit/${hash})"
  else
    link="\`${short}\`"
  fi

  # Strip prefix from subject for display
  display=$(echo "$subject" | sed -E 's/^[a-z]+(\([^)]+\))?!?: //')

  entry="- ${display} (${link})"

  case "$subject" in
    feat:*|feat\(*) FEATS+=("$entry") ;;
    fix:*|fix\(*)   FIXES+=("$entry") ;;
    docs:*|docs\(*) DOCS+=("$entry") ;;
    style:*|style\(*) STYLES+=("$entry") ;;
    refactor:*|refactor\(*) REFACTORS+=("$entry") ;;
    perf:*|perf\(*) PERFS+=("$entry") ;;
    test:*|test\(*) TESTS+=("$entry") ;;
    chore:*|chore\(*) CHORES+=("$entry") ;;
    ci:*|ci\(*)     CIS+=("$entry") ;;
    *)              OTHERS+=("$entry") ;;
  esac
done <<< "$ALL_COMMITS"

# Determine version
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
TODAY=$(date +%Y-%m-%d)

if [[ -n "$LATEST_TAG" ]]; then
  VERSION_HEADER="## [$LATEST_TAG] — $TODAY"
else
  VERSION_HEADER="## [Unreleased] — $TODAY"
fi

# --- Write output ---
{
  echo "# 📋 Changelog"
  echo ""
  echo "> Generated automatically from conventional commits"
  echo "> Last updated: $TODAY"
  echo ""

  # Append existing content below (skip old header if regenerating)
  if [[ -f "$OUTPUT" ]]; then
    echo "---"
    echo ""
  fi

  echo "$VERSION_HEADER"
  echo ""

  print_section() {
    local title="$1"; shift
    local entries=("$@")
    if [[ ${#entries[@]} -gt 0 ]]; then
      echo "### $title"
      echo ""
      for e in "${entries[@]}"; do
        echo "$e"
      done
      echo ""
    fi
  }

  print_section "✨ Features"       "${FEATS[@]+"${FEATS[@]}"}"
  print_section "🐛 Bug Fixes"      "${FIXES[@]+"${FIXES[@]}"}"
  print_section "⚡ Performance"    "${PERFS[@]+"${PERFS[@]}"}"
  print_section "📝 Documentation"  "${DOCS[@]+"${DOCS[@]}"}"
  print_section "♻️ Refactoring"    "${REFACTORS[@]+"${REFACTORS[@]}"}"
  print_section "🧪 Tests"          "${TESTS[@]+"${TESTS[@]}"}"
  print_section "🔧 Chores"         "${CHORES[@]+"${CHORES[@]}"}"
  print_section "🎨 Style"          "${STYLES[@]+"${STYLES[@]}"}"
  print_section "🚀 CI/CD"          "${CIS[@]+"${CIS[@]}"}"

  print_section "📌 Other" "${OTHERS[@]+"${OTHERS[@]}"}"

  # Append old content if file existed
  if [[ -f "$OUTPUT" ]]; then
    echo "---"
    echo ""
    # Skip old header lines (first 4 lines)
    tail -n +5 "$OUTPUT" 2>/dev/null || true
  fi

} > "${OUTPUT}.tmp"

mv "${OUTPUT}.tmp" "$OUTPUT"

echo "✅ Changelog written to: $OUTPUT"

# Summary
count_arr() { echo "${#@}"; }
total=$(( $(count_arr "${FEATS[@]+"${FEATS[@]}"}") + $(count_arr "${FIXES[@]+"${FIXES[@]}"}") + $(count_arr "${DOCS[@]+"${DOCS[@]}"}") + $(count_arr "${OTHERS[@]+"${OTHERS[@]}"}") + $(count_arr "${CHORES[@]+"${CHORES[@]}"}") + $(count_arr "${REFACTORS[@]+"${REFACTORS[@]}"}") + $(count_arr "${PERFS[@]+"${PERFS[@]}"}") + $(count_arr "${TESTS[@]+"${TESTS[@]}"}") + $(count_arr "${CIS[@]+"${CIS[@]}"}") + $(count_arr "${STYLES[@]+"${STYLES[@]}"}") ))
echo "   ${#FEATS[@]} features, ${#FIXES[@]} fixes, ${#DOCS[@]} docs, $total total commits"
