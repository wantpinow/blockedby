import type { Issue, ProjectSnapshot } from '../types'
import { isDone, stateOf } from './state'

export interface PromptContext {
  byId: Map<string, Issue>
  viewerName?: string | null
}

function slugify(s: string, words = 5): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, words)
    .join('-')
}

/**
 * Generates the kickoff prompt for a coding-agent session on this ticket.
 * The graph does the thinking the human usually does by hand: base-branch
 * choice (clean vs stacked on an in-review blocker vs blocked), parent
 * pickup, and downstream awareness — all embedded as explicit instructions.
 */
export function buildAgentPrompt(issue: Issue, snap: ProjectSnapshot, ctx: PromptContext): string {
  const st = stateOf(issue, snap)
  const parent = issue.parentId ? ctx.byId.get(issue.parentId) : undefined
  const blockers = issue.blockedBy
    .map((id) => ctx.byId.get(id))
    .filter((b): b is Issue => Boolean(b))
  const blocking = issue.blocks
    .map((id) => ctx.byId.get(id))
    .filter((b): b is Issue => Boolean(b))

  const unfinished = blockers.filter((b) => !isDone(stateOf(b, snap).type))
  const inFlight = unfinished.filter((b) => stateOf(b, snap).type === 'started')
  const notStarted = unfinished.filter((b) => stateOf(b, snap).type !== 'started')
  const stackBase = unfinished.length === 1 && inFlight.length === 1 ? inFlight[0] : null
  const blocked = notStarted.length > 0 || unfinished.length > 1

  const me = (ctx.viewerName ?? 'me').trim() || 'me'
  const owner = slugify(me, 2) || 'agent'
  const branch = `${owner}/${issue.identifier.toLowerCase()}-${slugify(issue.title)}`

  const fmt = (i: Issue) => `${i.identifier} ("${i.title}" — currently ${stateOf(i, snap).name})`
  const L: string[] = []

  // ---------------------------------------------------------------- header
  L.push(
    `I want you to implement a Linear ticket for me. Work through the phases below in order — phase 2 ends in a hard STOP for my review; do not write implementation code before my go-ahead.`,
    ``,
    `## The ticket`,
    ``,
    `- Ticket: ${issue.identifier} — "${issue.title}" (currently ${st.name})`,
    `- URL: ${issue.url}`,
    `- Project: ${snap.project.name} — ${snap.project.url}`,
  )
  if (parent) L.push(`- Parent ticket: ${fmt(parent)}`)
  if (blockers.length) {
    L.push(`- Blocked by: ${blockers.map(fmt).join(', ')}`)
  }
  if (blocking.length) {
    L.push(
      `- This ticket blocks: ${blocking.map((b) => b.identifier).join(', ')} — keep their needs in mind; don't paint them into a corner.`,
    )
  }
  if (isDone(st.type)) {
    L.push(
      ``,
      `⚠ This ticket is currently ${st.name} — confirm with me that it is genuinely being reopened before changing anything.`,
    )
  } else if (st.type === 'started') {
    L.push(
      ``,
      `⚠ This ticket is already ${st.name} — someone (possibly a previous session) may have started it. Check for an existing branch/PR and existing progress before assuming a clean slate.`,
    )
  }

  // ---------------------------------------------------------------- phase 0
  L.push(
    ``,
    `## Phase 0 — Orient (read-only, no mutations)`,
    ``,
    `1. Read the ticket in full, including every comment.`,
    `2. Map the project: the parent tickets and their subtickets, and each ticket's status — build a picture of what is done, in flight, and still open. Read the tickets most related to this one (its parent, siblings, and the tickets listed above).`,
    `3. Read the associated PRs — open and recently merged — for this project's tickets, to understand the current state and direction of the codebase.`,
    `4. Sweep the codebase, targeted at this ticket: trace the modules and files this work will touch, read their tests, and absorb the local conventions (CLAUDE.md / CONTRIBUTING, lint/format configs, naming and layering patterns). Find one or two recently merged PRs in the same area and treat them as the house style.`,
    `5. Reconcile Linear against reality: does the code already partially implement this? Do the ticket's assumptions still hold?`,
  )

  // ---------------------------------------------------------------- phase 1
  L.push(``, `## Phase 1 — Pick it up`, ``)
  if (blocked) {
    L.push(
      `⚠ Dependency gate: this ticket has unfinished blockers${notStarted.length ? ` — ${notStarted.map(fmt).join(', ')} ${notStarted.length === 1 ? 'has' : 'have'} not even started` : ` — ${unfinished.map(fmt).join(', ')}`}. After Phase 0, STOP and report: whether the blockers are truly prerequisites in the code (or only nominally in Linear), and how you would proceed. Do not change ticket state, create branches, or write code until I respond.`,
    )
  } else {
    const steps: string[] = []
    steps.push(
      `Move ${issue.identifier} to "In Progress" and assign it to me (${me}) in Linear.`,
    )
    if (parent) {
      steps.push(
        `If the parent ticket (${parent.identifier}) is not already In Progress, move it to In Progress and assign it to me as well.`,
      )
    } else {
      steps.push(
        `If the ticket has a parent I haven't listed, apply the same treatment to it (In Progress + assign to me).`,
      )
    }
    if (stackBase) {
      steps.push(
        `Branching — STACKED: the sole unfinished blocker ${fmt(stackBase)} is in flight, so this work stacks on top of it. Find its branch/PR (try \`gh pr list --state open --search "${stackBase.identifier}"\`, or the branch name in the Linear ticket). Verify the PR actually exists and note its head branch. Then: \`git fetch origin && git checkout -b ${branch} origin/<that-head-branch>\` in this worktree. Your eventual PR must use that head branch as its base (a stacked PR). If the base PR merges while you work, re-target your PR to main and rebase. If you cannot find an open PR for ${stackBase.identifier}, STOP and ask me.`,
      )
    } else {
      steps.push(
        `Branching — from main: \`git fetch origin && git checkout -b ${branch} origin/main\` in this worktree (always branch from the freshly fetched remote main, never local).`,
      )
    }
    steps.forEach((s, i) => L.push(`${i + 1}. ${s}`))
  }

  // ---------------------------------------------------------------- phase 2
  L.push(
    ``,
    `## Phase 2 — Plan, then STOP`,
    ``,
    `Think extremely deeply, then post your plan in chat with exactly these sections:`,
    ``,
    `1. **ELI5** — 3–6 sentences a non-engineer could follow: what this ticket does and why it matters.`,
    `2. **Acceptance criteria** — extracted from the ticket (and inferred where implicit) as a checklist. This is the contract; everything later maps back to it.`,
    `3. **Approach** — your chosen design, the main alternative you rejected, and why. Call out any interface/contract other tickets depend on.`,
    `4. **Commit-by-commit plan** — for each commit: message, files touched, what lands, and how you'll verify it. Each commit should leave the suite green and be reviewable on its own.`,
    `5. **Test plan** — which tests you'll add/update, at what level (unit/integration/e2e), and the exact commands to run them scoped and in full.`,
    `6. **Risks & out-of-scope finds** — anything smelly you noticed that you are deliberately NOT doing; propose follow-up tickets instead of expanding scope.`,
    `7. **Questions** — only ones your research genuinely cannot answer, each with your best-guess default so I can just say "defaults fine".`,
    ``,
    `If Phase 0 revealed the ticket can't be done as written (hidden dependencies in the code, stale assumptions, conflicts with in-flight work), lead with that instead of a plan.`,
    ``,
    `**Then stop and wait for my explicit go-ahead. Do not write or edit code until then.**`,
  )

  // ---------------------------------------------------------------- phase 3+4
  L.push(
    ``,
    `## Phase 3 — Implement (only after my go-ahead)`,
    ``,
    `- Follow the agreed plan commit by commit; if reality forces a deviation, note it and carry on — flag it in your final report.`,
    `- Conventional, present-tense commit messages that mention ${issue.identifier}.`,
    `- Match the repo's existing style exactly; no drive-by refactors, no changes outside this ticket's scope, no new dependencies without flagging, never commit secrets or local config.`,
    `- Keep lint, typecheck, and the relevant tests green at every commit, not just at the end.`,
    ``,
    `## Phase 4 — Verify & ship`,
    ``,
    `1. Full pass: lint, typecheck, complete test suite, and a production build.`,
    `2. Self-review the entire diff like a hostile reviewer — then check every acceptance criterion from Phase 2 explicitly.`,
    `3. Push the branch and open a **draft PR** titled "${issue.identifier}: <short description>"${stackBase ? ` with base = ${stackBase.identifier}'s head branch (the stack)` : ' with base = main'}.`,
    `4. PR body: summary, the ELI5, what changed, test evidence (actual output), the acceptance-criteria checklist${stackBase ? `, an explicit note that this PR is stacked on ${stackBase.identifier}'s PR` : ''}, and "Fixes ${issue.identifier}" so Linear links it.`,
    `5. In Linear: comment on ${issue.identifier} with the PR link + one-paragraph summary of the approach, and move the ticket to "In Review".`,
    `6. Report back to me: what shipped, any deviations from the agreed plan, and where you'd focus review attention.`,
  )

  return L.join('\n')
}
