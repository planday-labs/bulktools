# Issue conventions

Planday Bulk Employee Uploader. Issues are filed on GitHub by a small group of people — and the people filing them aren't always good at describing them. So this doc has two jobs:

1. **Define what a finished, well-formed issue looks like** — so a fresh Claude session can pick it up cold and start work.
2. **Define the triage workflow** — how a rough, under-described issue gets fleshed out into that finished form, by reading the code and asking the right questions.

## The guiding principle

**Describe the situation richly. Suggest lightly. Don't dictate.**

A finished issue is read by a fresh session that wasn't in the room when it was filed. That session plans its own implementation, and the issue should leave room for it:

- Be **thorough** about what happens now, what should happen, and why it matters to the user.
- **Suggestions and alternatives are welcome** — but frame them as options, not orders. "One approach could be…" / "Probably lives near `mappingService.ts`, but validate that" / "We considered X and ruled it out because…" — these hand over prior thinking without locking it in.
- Avoid step-by-step plans, pseudocode, or "just go edit `foo.ts:42`" framing. That collapses planning into rote execution, and the next session may know more than the filer did.

The line: *suggesting* is fine, *prescribing* isn't.

## The triage workflow (how a rough issue becomes a good one)

This is the part that matters most here, because most issues arrive thin. When the user links an issue and asks for review:

1. **Read the raw issue.** Take it as a symptom report, not a spec. The filer is usually describing what they *saw*, often without knowing the cause or the right vocabulary.
2. **Reproduce it in the code.** Trace the reported behavior through the actual workflow — the 7 steps (Auth → Upload → Map → Validate → Correct → Preview → Upload), the services (`plandayApi.ts`, `excelParser.ts`, `mappingService.ts`), and the parsers (`dateParser.ts`, `phoneParser.ts`, `numericParser.ts`). Find where the behavior is produced before deciding what the issue "really" is.
3. **Separate symptom from cause.** Filers describe symptoms ("upload aborted", "ambiguous date error"). State both: what they saw, and what the code is actually doing. They can diverge — e.g. an "ambiguous date" complaint may really be about Excel cell display value vs. underlying serial.
4. **Ask before assuming.** When the issue is ambiguous, ask the user targeted questions rather than guessing. Good questions reference concrete behavior: "Does this happen on every file or only ones exported from a particular system?" / "When you say 'aborted', does the whole batch stop or just the failing rows?" Prefer a couple of sharp questions over a vague "can you clarify?".
5. **Rewrite the issue body** into the structure below, folding in what you learned from the code and the answers. Post it back as a comment, or hand the rewritten body to the user to update the issue — whichever they prefer.

The goal: turn "the date thing is broken" into an issue a cold session can act on without re-discovering everything.

## Title

`[area] verb-led summary`

- `area` = which part of the app. Pick from: `auth`, `upload`, `mapping`, `validation`, `correction`, `preview`, `bulk-upload`, `edit`, `api`, `parsing`, `ui`, `docs`, `build`. Add a new area only when none of these genuinely fit.
- Start the summary with an imperative verb ("add", "fix", "read", "rearrange").
- Aim for under ~80 chars.

Examples (drawn from real issues in this repo):

- `[parsing] read visible Excel cell value, not underlying date serial`
- `[validation] let user refresh portal field options without restarting upload`
- `[mapping] filter unsupported field definitions from the mapping UI`
- `[ui] move Skills to the end of the Excel template`

Don't put Conventional Commit prefixes (`feat(...)`, `fix(...)`) in the title — those belong on the commit. The title is for triage.

## Body

Three sections, in this order, with these exact headers. Two are heavy, one is light:

```markdown
## Context        ← go deep here
## Outcome        ← what "done" looks like from the user's side
## Notes          ← optional; links, ruled-out paths, open questions
```

### Context (heavy)

Aim for "a fresh session can pick this up cold." Cover what's relevant:

- **Current behavior** — what actually happens now. For bugs, give reproduction steps: what file/data, which step in the workflow, what the user clicked, what they saw. For features, describe the current user experience.
- **Expected / desired behavior** — what should happen instead, and why.
- **Why it matters** — user impact, how often it hits, severity. Does it block an upload entirely, or is it cosmetic? Don't bury the motivation.
- **Scope** — which step(s), service(s), or file(s) are in play. (File paths here are orientation, *not* a directive to edit them.)
- **Triage findings** — what you learned tracing it through the code: the real cause vs. the reported symptom, edge cases, related issues.
- **Hard constraints** — invariants the next session must honor. For this project that often includes: **client-side only** (Excel data never leaves the browser), **respect Planday rate limits / 429 handling**, **don't break the per-row validation+correction flow**, **token/OAuth refresh must keep working**.

Use sub-headers (`### Current behavior`, `### Why it matters`) when the context is long. A short issue can be one paragraph.

### Outcome (light)

What "done" looks like **from the user's side** — observable behavior.

- Bullet list of outcomes, not steps.
- "User sees X" / "the app no longer aborts the whole batch when Y" / "the date format prompt shows the user's own format, not the payload format".
- Keep it about the *result*. Implementation thoughts go in Notes.

If the outcome is just "this should stop crashing", one bullet is fine. Don't pad.

### Notes (optional)

Where suggestions and prior thinking live. Frame everything as take-it-or-leave-it.

- Links to related issues, PRs, commits, screenshots.
- **Suggested approaches** — as options: "one path could be reading `cell.text` instead of `cell.value` in `excelParser.ts`", "might belong in the existing validation pass".
- **Alternatives considered and ruled out** — state the path *and why* it was dropped, so nobody re-litigates it.
- Open questions you didn't resolve during triage.

Omit this section if empty. Keep `Context` and `Outcome` even when sparse — consistent shape keeps issues skimmable.

## Labels

This repo uses GitHub's default label set. Pick the one that fits; don't invent new ones.

| Label           | Use for |
|-----------------|---|
| `bug`           | Behaves wrong vs. intended. |
| `enhancement`   | New capability or improvement to an existing feature. |
| `documentation` | Docs / README / this kind of doc. |
| `question`      | Needs more info before it's actionable — often the state a freshly-filed, under-described issue sits in until triage. |
| `duplicate`     | Already covered by another issue (see below). |
| `wontfix`       | Decided not to act on. |

If you find yourself wanting a label that doesn't exist, that's a signal — raise it with the user rather than inventing one.

For duplicates: close with a reference to the canonical issue (`Duplicate of #N`) and apply `duplicate`.

## Closing issues

Every resolved issue gets a **comprehensive closing comment** — what was actually done. Commit messages alone don't carry enough context, and the issue is the first place anyone (human or agent) looks when re-encountering the topic later. It's the mirror of the body: the body is "describe richly, don't dictate"; the closing comment is "explain richly what we ended up doing."

### What goes in the comment

Cover whichever apply — be thorough, not perfunctory:

- **Commit SHA(s)** that resolved it (list all if several).
- **What changed** — which step/service/file and the shape of the change, as readable narrative.
- **How it compared to the issue** — if the path differed from a suggested approach, or scope grew/shrank, say so and why.
- **Side effects, gotchas, follow-ups** — anything notable. New issues spawned (link them). Things left out of scope.
- **Verification** — how it was confirmed. Since there's **no automated test framework** here (manual testing only), name the manual repro: which file/data, which workflow steps, what you observed. If you couldn't test the UI yourself, say so.

### How to close

**Case A — resolved via a PR with `Closes #N` in the body.** GitHub auto-closes on merge. Post the closing comment **separately** with `gh issue comment <N> --body "..."`. Do **not** use `gh issue close --comment` — the auto-close fires first and the comment then drops silently.

**Case B — committed directly (no PR).** Do both, in order:
1. `gh issue comment <N> --body "..."` — the comprehensive summary.
2. `gh issue close <N>`.

Don't leave resolved issues open waiting to be noticed. If the work is done, close it.
