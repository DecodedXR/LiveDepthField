---
name: autopilot-fable
description: Token-lean autopilot for Fable-class models on the 3DViewer / Live Depth Field repo — same contract as `autopilot` (pick ONE unblocked task from STATUS.md, test-first, independent adversarial verification, PR that auto-merges ONLY if CI is green, bail over guess) but single-agent depth instead of multi-agent breadth. No Workflow fan-outs, no verifier panels, no budget loops; at most 2 subagents per run (3 if implementation is delegated). Matches spend to intensity — Fable takes the most demanding eligible pick directly; a low-level pick still ships but its hands-on work is delegated to a cheaper worker model (sonnet/haiku) while Fable keeps every gate and the merge decision. Use when the user asks for an efficient/lean/cheap autonomous run — "autopilot fable", "lean autopilot", "autopilot but cheap", "efficient autopilot". Invoking it IS the standing authorization to open and auto-merge the PR. Never auto-sends email (draft only); never touches a milestone gated on an unconfirmed model-API / tensor-shape / WebGPU fact or an open human checkpoint; if asked for `ultra`, use the `autopilot` skill instead.
version: 0.3.0
---

# Autopilot (Fable) — Ship the Next Unblocked Task, Lean

Adapted for the **Live Depth Field / 3DViewer** repo (Vanilla JS + Three.js 0.185 +
Vite + Playwright; **STATUS.md is the task queue**; fully client-side, one milestone
per PR/run). Ported from the fticr-V2 `autopilot-fable` v0.3.0.

Identical **contract** to the `autopilot` skill: one tracked task per run, carried to
landed-on-`main` with zero human decisions, proven by verification you did not
author, merged only on green CI, and **bailed cleanly on any doubt**. What changes is
the **spend model**: `autopilot ultra` bought assurance through multi-agent breadth
(perspective-diverse verifier panels, dimensioned Workflow reviews, loop-until-dry)
because the author model's blind spot needed many independent eyes. On Fable, buy the
same assurance with **one deep pass per gate** and hard caps on everything that fans
out.

**Token discipline (the point of this variant):**
- **Never use the `Workflow` tool.** No panels, no pipelines, no budget machinery.
- **≤ 2 subagents per run** (≤ 3 when implementation is delegated per §3-D): at most
  one `Explore` during selection (only if STATUS.md doesn't localize the task), at
  most one lower-model worker, and exactly one adversarial verifier (§4).
- **Full test suite exactly twice**: the §0 baseline and once before push (§3). During
  iteration run only the targeted test file(s) — but rebuild first (see below).
- **Selection reads STATUS.md, not the corpus**: `## NEXT (the one actionable task)`
  and `## BLOCKED`, plus the `MEMORY.md` index (follow a link only if it names the
  picked task). No source-tree dives unless the fix itself needs a specific fact —
  then read the one file that settles it.
- **Rebuild before any behavioral/visual check.** A bare `npx playwright test` serves
  the **stale** prebuilt `dist/`; only `npm test` / `npm run build` regenerate it.
  After editing `src/`, rebuild before trusting any screenshot or targeted run
  (`[[rebuild-before-visual-check]]`).

## Hard off-limits — never select, never touch

Anything tied to a milestone gated on an **unconfirmed external fact or an open human
checkpoint**: STATUS.md `## BLOCKED` items, any milestone whose entry still carries an
uncleared ⚠️ HUMAN CHECKPOINT, and anything that would require **guessing a
transformers.js output shape / value range, a WebGPU (or WASM-fallback) capability, a
tensor layout, or a Three.js 0.185 API** — CLAUDE.md's rule is "ask before assuming
anything about model APIs, tensor shapes, or Three.js versions." Never guess one of
these to keep a task alive. Also off-limits autonomously: **adding or editing
dependencies** (e.g. M3's `@huggingface/transformers` add is a human-approved gate —
see STATUS.md). Everything else is fair game, guarded by the verifier + CI gate, not
carve-outs.

## Eligibility

Only tasks finishable and provable green with zero human intervention via `npm test`
(Vite build + headless-WebGL Playwright smoke). Skip BLOCKED / human-checkpoint /
dependency-gated items. A task hinging on a judgment call the user should own may be
built but must **not** auto-merge — leave the PR open. If nothing is eligible, report
the top blocked need and stop; never invent busywork. (After a milestone lands, the
next NEXT is often gated — if so, bail per §8 rather than manufacture work.)

## 0. Pre-flight gates (bail if any fails)

- Working tree **clean**; `git fetch origin` and fast-forward local `main` first
  (a stale STATUS mis-reads eligibility — `[[autopilot-milestone-workflow]]`).
- Full local suite green once (`npm test` = `vite build && playwright test`); latest
  `main` CI run green (`gh run list --branch main -L1`).
- Invoked **interactively** — never from `/loop` or `/schedule`.

## 1–2. Select and confirm it is still real

Read `STATUS.md` `## NEXT` — by design it is the single actionable task (one milestone
per run). Confirm it's still real: re-read the cited code **as it is now** and check
`git log` — STATUS prose can lag the code by a session. If already done, update STATUS
and re-pick (or bail if nothing remains).

**Effort ↔ pick match (uncertainty gate).** This skill may run at reduced session
effort. That's fine for a bounded, test-only, doc, or pure-shading/GUI pick. But a
pick whose fix touches the **render / inference-decoupling core** (the `src/main.js`
render loop, the depth-inference↔render decoupling, the `window.__app` debug-hook) **or
depends on an unverified external assumption** (transformers.js output, WebGPU/WASM
availability, a tensor shape, a Three.js 0.185 API) gets full reasoning depth or
nothing: proceed **only if session effort is known to be high** (an `/effort` result
visible this session). Otherwise — medium/low or unknown — do **not** start it: defer,
pick the next eligible lower-risk task, and if the risky task was the only eligible
pick, bail clean. Name the deferred task in the report and ask the user to re-run at
`/effort high`. Test-only changes don't trigger this gate — it keys on the production
diff, not the file's neighborhood.

**Capability-match triage (spend Fable where it pays).** After confirming the pick,
judge its intensity. **Intensive** — take it yourself; this is what the expensive
model is for: multi-file or cross-module fixes, non-obvious root cause, anything
shader/GLSL-correctness, render-loop or inference-decoupling, numeric/coordinate
mapping, or design-altitude calls. **Low-level** — bounded single-spot fixes,
test-only or doc/STATUS work, mechanical renames/sweeps: the pick still ships
(STATUS's ordering decides *what* ships, never skipped for being easy), but its
hands-on work is **delegated to a lower-model worker** per §3-D instead of burning
Fable tokens. When two eligible tasks tie in priority, break toward the **more
intensive** one. **Never delegate a render/decoupling-core or external-API-integration
diff** — that is Fable-direct at known-high effort (gate above) or deferred.

## 3. Plan, then implement — test-first, non-tautological

State the plan in your reply before the first edit (root cause, fix altitude +
rejected alternatives, files, RED-test design, preserved invariants) — **show, don't
pause**; no approval checkpoint. Skip a `Plan` subagent unless the fix is genuinely
multi-file/non-obvious.

Then:
- **RED repro first** (a Playwright assertion in `tests/smoke.spec.js`, or the
  existing suite); confirm it fails **for the right reason** via `npm test` (which
  rebuilds). Minimal correct fix; cover failure paths (thrown errors, rejected
  async/await, WebGL/shader-compile failures — which surface as `console.error` the
  smoke test captures — and model-load failures). Centralize any guard/constant used
  at ≥2 sites; every doc/contract promise becomes a test.
- **Non-tautology proof**: commit (or stash) the fix FIRST, then revert → **rebuild**
  (`npm test` or `npm run build`) → confirm RED → restore → rebuild → green. The
  rebuild is mandatory: a bare `npx playwright test` runs against the stale `dist/`
  and will falsely pass (`[[rebuild-before-visual-check]]`).
- **Preserve the repo invariants** (CLAUDE.md): **fully in-browser** (no network calls
  but model weights); **30fps orbit** even when inference is slower; **depth inference
  and rendering stay DECOUPLED** (the render loop never blocks on inference — post the
  latest depth map, render consumes newest, drop frames, never queue); the
  render/camera scaffold and `OrbitControls`/resize/rAF loop in `src/main.js` stay
  put; the `window.__app` debug-hook contract holds; **ship a working thing at every
  milestone**.
- Full local suite to green **once, at the end** (`npm test`). Never weaken/skip/delete
  a test or `--no-verify` to reach green. For a **visual milestone**, also eyeball a
  real render (screenshot via a throwaway spec on a **fresh build**, then delete the
  spec) — CI's `smoke` job can't fully prove a visual change and may be flaky.

**§3-D Delegated implementation (low-level picks only, per the triage in §1–2).** You
author the plan and the RED-test design yourself — delegation covers the typing, not
the thinking. Hand the worker (Agent tool, `model: "sonnet"`; `"haiku"` only for
purely mechanical text-level changes) the plan verbatim plus the invariant bullets
above, and have it implement test-first on the shared tree — serially, never concurrent
with your own edits or test runs. When it returns:
- **re-diff the tree** (`git diff --stat`) and read the **actual diff**, not the
  worker's summary — watch for stray characters (e.g. a backtick inside a `/* glsl */`
  shader template literal silently terminates it and breaks the Vite build)
  (`[[worktree-isolation-unreliable-here]]`);
- re-run RED → rebuild → green and the **non-tautology proof yourself** — never accept
  the worker's claim that it did;
- proceed through §4–6 unchanged: the verifier, the review, every gate, and the merge
  decision stay with you at full rigor.
If the worker flounders twice, take over and finish directly rather than looping it —
a third worker round costs more than doing the work.

## 4. Independent adversarial verification — one deep verifier

Spawn **one** verifier agent that did not see your implementation reasoning, prompted
to **refute** the change — find an input, interleaving, or fault that breaks it — not
to bless it. Give it the **lens the diff actually needs** (pick from:
correctness/contract, render-loop/decoupling, failure-paths, external-API- or
Three.js-faithfulness, adversarial boundaries) instead of running all lenses.
**Read-only on the main worktree — do NOT use `isolation:'worktree'`**: isolated agents
here come up without the feature-branch commit or `node_modules` and silently check the
wrong (empty-scaffold) code (`[[worktree-isolation-unreliable-here]]`). Commit the
change to the feature branch first, tell the verifier the branch name and that deps
live in the main worktree. It may run targeted tests (which rebuild via `npm test`) but
not concurrently with your own runs. For behavior it should exercise the real WebGL
path via Playwright + the `window.__app` hook, not freshly-authored stubs. After it
returns, **re-diff the tree** (`git diff --stat`) — read-only is not self-enforcing. A
hole → fix and re-verify (targeted tests only); can't close it → bail per §8.

## 5. Review — one local pass, scaled to the diff

One `/code-review` over the diff, **local only — never the billed cloud `ultra`
review**: **high** effort for a bounded/test-only/doc diff, **max** only when the diff
touches the render/inference-decoupling core or a milestone boundary. Apply confirmed
fixes, re-run targeted tests (rebuild first). A judgment-call finding blocks
auto-merge — carry it to the PR.

## 6. Land via PR — auto-merge ONLY if CI is green

Record the pre-change HEAD (for the rollback line). Then: branch off `main`
(`fix/...` / `feat/...`); stage **only the files this task touched** (never
`git add -A`; re-check `HEAD` before commit in case a parallel session moved it);
commit via `git commit -F <file>` with footer `Co-Authored-By: Claude Fable 5
<noreply@anthropic.com>` and an `Autopilot: <STATUS ref>` trailer. Fold the `STATUS.md`
update (milestone → DONE, next milestone promoted, rollback HEAD noted) into the **same
branch** so it lands atomically. Push the **branch, never `main`** (a direct push to
`main` is rejected by the auto-mode classifier — always go through a PR), `gh pr create`
(body: task + why, RED test, verifier verdict, review outcome, rollback HEAD), then
watch CI to conclusion (`gh pr checks <pr> --watch`).

**Auto-merge (`gh pr merge --merge --delete-branch`) ONLY IF all of:** full local suite
green + RED test proven non-tautological; verifier passed; review left no unresolved or
judgment-call finding; **CI green**; genuine confidence. CI has two jobs — **`build`**
(the reliable gate) and **`smoke`** (headless WebGL under SwiftShader, which may be
flaky across Chromium). If `smoke` is red for a **real** reason, treat it as a failure.
If `build` is green, local `npm test` passed, and `smoke` looks like a known flake,
re-run it **once**; if it's still red, that's a judgment call → **leave the PR open**
for a human, do not force the merge. Any miss — including plain doubt — leave the PR
open and report. **Never fall back to a direct push to `main`.**

## 7. After a successful merge only

1. Save a `project-update-email` **Gmail draft** reflecting what landed. **Never
   send.**
2. **No full `prepare-for-next-session` pass** (lean close-out): write at most one
   memory, only if the run produced a durable, non-obvious lesson; otherwise skip.
If the PR did not merge, skip both and report the open PR.

## Forbidden operations (identical to `autopilot`)

Weakening/skipping/deleting tests or `--no-verify`; force-push/squash/history rewrite;
editing dependencies (incl. adding `@huggingface/transformers` without human approval),
CI config (`.github/workflows/`), git hooks, `settings.json`, or skill/memory infra;
`git add -A`; committing secrets/large binaries; running on a schedule/loop. Any of
these → stop and ask.

## 8. Stop / bail

**Done & merged:** report task, diff, test/verifier/review/CI results, merge commit,
rollback HEAD, and the email draft — plus the run's approximate token footprint and
**which tier executed** (Fable-direct vs delegated to sonnet/haiku, and why) so the
user can compare runs and re-tune the triage. **Bail (clean):** nothing eligible; an
off-limits / human-checkpoint / dependency-gated item is all that remains; tests won't
converge; a verifier hole you can't close; CI/merge blocked. Revert or stash so the
tree is clean; report where you stopped and the decision needed. Never merge a
half-done or guessed change; never force a green.
