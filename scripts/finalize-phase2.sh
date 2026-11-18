#!/usr/bin/env bash
# Finalize all Phase-2 projects: lint check + git init + commit
# This script does NOT push to GitHub (per the security policy).
set -e

PROJECTS=(
  "16-github-repo-qa-bot|feat: GitHub Repo Q&A Bot — Phase 2 Project #16"
  "17-internal-wiki-ai-search|feat: Internal Wiki AI Search — Phase 2 Project #17"
  "19-personal-crm-ai-memory|feat: Personal CRM with AI Memory — Phase 2 Project #19"
  "51-blog-outline-to-article|feat: AI Blog Outline to Article Generator — Phase 2 Project #51"
  "65-code-search-engine-nl|feat: Code Search Engine (NL) — Phase 2 Project #65"
  "108-coding-interview-prep|feat: AI-Powered Coding Interview Prep Platform — Phase 2 Project #108"
)

ROOT=/home/z/my-project/apps
cd "$ROOT"

for entry in "${PROJECTS[@]}"; do
  slug="${entry%%|*}"
  msg="${entry#*|}"
  dir="$ROOT/$slug"

  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "→ Finalizing: $slug"
  echo "═══════════════════════════════════════════════════════════════"

  if [ ! -d "$dir" ]; then
    echo "  ✗ directory missing — skipping"
    continue
  fi

  cd "$dir"

  # 1. Verify tests pass
  echo "→ Tests..."
  if bun test 2>&1 | tail -3 | grep -q "0 fail"; then
    test_summary=$(bun test 2>&1 | tail -3 | head -2 | tr '\n' ' ')
    echo "  ✓ $test_summary"
  else
    echo "  ✗ tests failing — running verbose:"
    bun test 2>&1 | tail -20
    continue
  fi

  # 2. Lint check
  echo "→ Lint..."
  if bun run lint 2>&1 | tail -1 | grep -qvE "error|fail"; then
    lint_out=$(bun run lint 2>&1 | tail -3 | head -2)
    echo "  ✓ lint clean"
  else
    lint_out=$(bun run lint 2>&1 | tail -10)
    echo "  ⚠ lint warnings (continuing):"
    echo "$lint_out" | sed 's/^/    /'
  fi

  # 3. Ensure .gitignore exists
  if [ ! -f .gitignore ]; then
    echo "→ Creating .gitignore..."
    cat > .gitignore <<'EOF'
node_modules/
.next/
out/
build/
.vercel/
.env
.env.local
.env.*.local
db/
*.db
*.db-journal
*.sqlite
*.sqlite-journal
dev.log
server.log
*.log
.DS_Store
tmp/
state.json
agent-ctx/
EOF
  fi

  # 4. Verify .env is gitignored (don't commit it)
  if [ -f .env ] && ! grep -qE "^\.env$" .gitignore; then
    echo "→ Adding .env to .gitignore (preventing secret leak)..."
    echo ".env" >> .gitignore
  fi

  # 5. git init + commit (skip if .git already exists)
  if [ ! -d .git ]; then
    echo "→ git init + commit..."
    git init -b main -q 2>/dev/null || git init -q
    git config user.email "portfolio@local" 2>/dev/null
    git config user.name "Portfolio Builder" 2>/dev/null
    git add -A
    git commit -q -m "$msg

Phase 2 portfolio project from the 110-Advanced-Portfolio-Projects-2025-2026 plan.

Built with: Next.js 16, TypeScript 5, Tailwind CSS 4, shadcn/ui, Prisma 6 + SQLite,
z-ai-web-dev-sdk for LLM streaming, bun test for unit tests.

See README.md for setup, architecture, case study, and push-to-GitHub instructions."
    echo "  ✓ committed: $(git log --oneline -1)"
    echo "  ✓ files tracked: $(git ls-files | wc -l)"
  else
    echo "  → .git already exists — skipping init"
  fi

  cd "$ROOT"
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "PHASE 2 FINALIZATION COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
