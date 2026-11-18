# Project #108 — AI-Powered Coding Interview Prep Platform

## Task ID
108

## Agent
zai-code

## Status
COMPLETE — 239/239 tests pass across 9 test files. Built in `/home/z/my-project/apps/108-coding-interview-prep/`. Did NOT touch parent project (`/home/z/my-project/prisma/schema.prisma` intact with Note/NoteChunk/ChatSession/ChatMessage models; parent `db/custom.db` unmodified). Did NOT run `bun install` / `db:push` / `git init` / `git commit` per instructions.

## File count
57 files total (excluding node_modules, .next, tmp, db files). Breakdown:
- 9 config files (package.json, tsconfig, next.config, postcss, eslint, tailwind, components.json, .env.example, next-env.d.ts)
- 1 prisma schema
- 2 scripts (seed-problems, run-tests worker)
- 21 src files (1 page.tsx, 1 layout.tsx, 1 globals.css, 8 API routes, 11 lib files, 14 UI components)
- 9 test files
- 1 README

## Test count + pass count
- 239 pass, 0 fail, 753 expect() calls across 9 files (target was 40+).
- Files: scorer (13), feedback-builder (15), interview-prompt (16), behavioral-prompt (15), weakness-tracker (15), test-runner (11), problem-seed (145), ai (7), test-runner-sandbox (5).

## Commit status
NONE — did not commit. User will run `git init && git add -A && git commit -m ...` themselves.

## Brief description (5-10 bullets)
- Mock interview platform: technical (LeetCode-style) + behavioral (STAR) flows in a single-page 3-column dashboard.
- 10 hand-written problems covering easy/medium/hard across arrays/strings/dp/two-pointers/binary-search/graph.
- AI interviewer uses z-ai-web-dev-sdk via the Project #1 ChatProvider pattern (cached singleton + MockProvider fallback when `INTERVIEW_DISABLE_LLM=1` or SDK config missing).
- Progressive hint ladder (served one-at-a-time without an LLM call); AI reveals the full ideal solution only when the user explicitly asks ("show me the solution").
- Live code execution: `runTestsInSandbox` writes user code + test harness to `tmp/<uuid>.test.ts`, spawns `bun <harness>` with 5s timeout, parses a `---TEST-RESULTS---\n{json}` envelope.
- Real-time feedback via `buildFeedbackPrompt` + `---FEEDBACK---\n{json}` footer that the route parses for time/space complexity, code-quality notes, ideal-comparison, strengths, weaknesses.
- Pure-function scorer: `computeScore({ testsPassed, testsTotal, timeTakenSec, hintsRequested, complexity })` → 0-100 with breakdown (Tests 40 / Speed 10 / Hints 10 / Complexity 40). All-tests-pass + fast + 0 hints + O(n) → 95; tests-fail + slow + 3 hints + O(n²) → 30.
- Weakness-targeted practice: `updateCategoryStats` tracks per-category fail counts; `recommendNextProblem` returns the easiest unsolved problem from the user's weakest category.
- All 5 Prisma models (Problem, InterviewSession, InterviewMessage, TestRun, UserStats) live in a separate SQLite file at `apps/108-coding-interview-prep/db/custom.db`.
- Anti-cheat: test cases + idealSolution are stripped from `/api/problems` + `/api/problems/[id]` responses; they only come back through `/api/interviews/[id]/run-tests` and the submit feedback call.

## Limitations / TODOs
- Sandbox runs in the same OS user / fs / network as the dev server — fine for trusted local practice, NOT for production. Needs Docker / firejail / bubblewrap isolation.
- TS/JS only (no Python / Java / C++). Real Judge0 is a documented stretch goal.
- Plain `<textarea>` editor (no Monaco). Voice mode skipped. Company-specific banks skipped. System design interviews skipped.
- The app's `db/` folder is empty — user must run `bun run db:push && bun run seed` before `bun run dev`. README has the setup steps.
- My app's `package.json` declares deps but I did NOT run `bun install`. The deps resolve up the tree from the parent's `node_modules/` for `bun test` to pass; for `bun run dev` the user should run `bun install` inside the app dir first (or symlink to the parent's node_modules).

## Exact push command for the user
```bash
cd /home/z/my-project/apps/108-coding-interview-prep
bun install                  # populate node_modules for the app (optional — deps resolve up the tree)
bun run db:push              # create the SQLite schema
bun run seed                 # seed the 10 problems + UserStats singleton
bun run dev                  # start on http://localhost:3000 (stop the parent's dev server first — port conflict)
# or, to run only tests:
bun test                     # 239 tests pass
```

## Parent DB verification
- Parent prisma schema at `/home/z/my-project/prisma/schema.prisma` UNCHANGED — still has exactly `Note`, `NoteChunk`, `ChatSession`, `ChatMessage` (4 models, last modified before my session).
- Parent SQLite at `/home/z/my-project/db/custom.db` UNCHANGED (mtime Nov 17 20:10 — pre-session).
- My app uses a SEPARATE schema file at `apps/108-coding-interview-prep/prisma/schema.prisma` with NEW models `Problem`, `InterviewSession`, `InterviewMessage`, `TestRun`, `UserStats`.
- My app's `DATABASE_URL` defaults to `file:$(pwd)/db/custom.db` (i.e. `apps/108-coding-interview-prep/db/custom.db`) — a separate file that does NOT exist yet (because I did not run `db:push`).
- My tests are pure-function + subprocess tests — they do NOT touch Prisma at all, so they pass without a DB.
