#!/usr/bin/env bash
# Finalize Phase 3 projects: lint check + git init + commit
set -e

PROJECTS=(
  "32-autonomous-browser-agent|feat: Autonomous Browser Agent — Phase 3 Project #32"
  "33-mcp-server-marketplace|feat: MCP Server Marketplace — Phase 3 Project #33"
  "75-multimodal-rag|feat: Multimodal RAG (Text + Image + Table) — Phase 3 Project #75"
  "95-cicd-pipeline-builder|feat: AI-Powered CI/CD Pipeline Builder — Phase 3 Project #95"
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

  echo "→ Tests..."
  if bun test 2>&1 | tail -3 | grep -q "0 fail"; then
    test_summary=$(bun test 2>&1 | tail -3 | head -2 | tr '\n' ' ')
    echo "  ✓ $test_summary"
  else
    echo "  ✗ tests failing:"
    bun test 2>&1 | tail -20
    continue
  fi

  echo "→ Lint..."
  lint_out=$(bun run lint 2>&1)
  lint_exit=$?
  if [ $lint_exit -eq 0 ]; then
    echo "  ✓ lint clean"
  else
    echo "  ⚠ lint warnings (continuing):"
    echo "$lint_out" | tail -10 | sed 's/^/    /'
  fi

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

  if [ -f .env ] && ! grep -qE "^\.env$" .gitignore; then
    echo "→ Adding .env to .gitignore..."
    echo ".env" >> .gitignore
  fi

  if [ ! -d .git ]; then
    echo "→ git init + commit..."
    git init -b main -q 2>/dev/null || git init -q
    git config user.email "portfolio@local" 2>/dev/null
    git config user.name "Portfolio Builder" 2>/dev/null
    git add -A
    git commit -q -m "$msg

Phase 3 portfolio project from the 110-Advanced-Portfolio-Projects-2025-2026 plan.

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
echo "PHASE 3 FINALIZATION COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
