#!/usr/bin/env bash
set -e
PROJECTS=(
  "87-legal-document-analyzer|feat: AI Legal Document Analyzer — Phase 4 Capstone Project #87"
  "109-tutoring-platform-live|feat: AI-Powered Tutoring Platform (Live) — Phase 4 Capstone Project #109"
)
ROOT=/home/z/my-project/apps
cd "$ROOT"
for entry in "${PROJECTS[@]}"; do
  slug="${entry%%|*}"; msg="${entry#*|}"; dir="$ROOT/$slug"
  echo ""; echo "═══════════════════════════════════════════════════════════════"
  echo "→ Finalizing: $slug"
  echo "═══════════════════════════════════════════════════════════════"
  cd "$dir"
  echo "→ Tests..."
  if bun test 2>&1 | tail -3 | grep -q "0 fail"; then
    echo "  ✓ $(bun test 2>&1 | tail -3 | head -2 | tr '\n' ' ')"
  else
    echo "  ✗ tests failing:"; bun test 2>&1 | tail -20; continue
  fi
  echo "→ Lint..."
  if bun run lint 2>&1 | tail -1 | grep -qvE "error|fail"; then
    echo "  ✓ lint clean"
  else
    echo "  ⚠ lint warnings:"; bun run lint 2>&1 | tail -10 | sed 's/^/    /'
  fi
  if [ ! -f .gitignore ]; then
    cat > .gitignore <<'EOF'
node_modules/ .next/ out/ build/ .vercel/ .env .env.local .env.*.local
db/ *.db *.db-journal *.sqlite *.sqlite-journal dev.log server.log *.log
.DS_Store tmp/ state.json agent-ctx/
EOF
  fi
  if [ -f .env ] && ! grep -qE "^\.env$" .gitignore; then echo ".env" >> .gitignore; fi
  if [ ! -d .git ]; then
    echo "→ git init + commit..."
    git init -b main -q 2>/dev/null || git init -q
    git config user.email "portfolio@local" 2>/dev/null
    git config user.name "Portfolio Builder" 2>/dev/null
    git add -A
    git commit -q -m "$msg

Phase 4 capstone portfolio project from the 110-Advanced-Portfolio-Projects-2025-2026 plan.

Built with: Next.js 16, TypeScript 5, Tailwind CSS 4, shadcn/ui, Prisma 6 + SQLite,
z-ai-web-dev-sdk for LLM streaming, bun test for unit tests.

See README.md for setup, architecture, case study, and push-to-GitHub instructions."
    echo "  ✓ committed: $(git log --oneline -1)"
    echo "  ✓ files tracked: $(git ls-files | wc -l)"
  fi
  cd "$ROOT"
done
echo ""; echo "═══════════════════════════════════════════════════════════════"
echo "PHASE 4 FINALIZATION COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
