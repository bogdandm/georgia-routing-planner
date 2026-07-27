# AGENTS.md

In Code Mode, within each bounded stage, run independent, functions.exec-available tool
calls concurrently in one functions.exec call. Use await Promise.allSettled([...]) when
partial results are useful, and inspect every result; use await Promise.all([...]) only
when any failure should abort the batch. Keep dependencies, waits/resumes, approvals,
conflicting or interdependent mutations, and adaptive investigations where each result
may change the next step sequential. Do not split otherwise batchable inspections across
outer tool calls.

## Scope

These instructions apply to the entire Georgia Routing Planner repository.
Directory-specific instructions live in:

- [`src/AGENTS.md`](src/AGENTS.md) for production architecture, source-code boundaries,
  TypeScript, React, state, persistence, diagnostics, MapLibre, and imported-data rules.
- [`tests/AGENTS.md`](tests/AGENTS.md) for Vitest unit, component, and integration
  tests.
- [`e2e/AGENTS.md`](e2e/AGENTS.md) for Playwright Chromium and accessibility workflows.

Within those directories, the nested file supplements this root file and takes
precedence where it is more specific.

## Canonical documentation

[`README.md`](README.md) owns the stable project overview and developer setup.
[`docs/features.md`](docs/features.md) owns the durable workspace and interaction
contract. [`docs/ui-design.md`](docs/ui-design.md) owns reusable presentation guidance.
[`docs/project-structure.md`](docs/project-structure.md) and
[`docs/runtime-flows.md`](docs/runtime-flows.md) own the durable architecture and
runtime description. [`docs/map-providers.md`](docs/map-providers.md) owns provider
choice, schema, attribution, evidence, and operating limits.
[`docs/README.md`](docs/README.md) indexes permanent project documentation and must stay
current when documentation files are added, renamed, or removed.

Keep `AGENTS.md` files focused on agent workflow and engineering constraints. Do not
copy the product roadmap, full feature catalog, provider inventory, or detailed visual
specification into these files.

## Git workflow and approval gate

`main` is the protected approval branch. All implementation, documentation,
configuration, data, test, and maintenance changes must be made on a feature branch.

### Absolute main-integration prohibition for agents

Agents must never merge a pull request or any branch into `main`. Only the maintainer
may perform the final merge through GitHub or another maintainer-controlled interface.
This prohibition applies even when the maintainer has approved the branch, asks to
"update main", says to "integrate" or "go ahead", or uses other wording that could be
interpreted as merge authorization. Agents may prepare, verify, push, and update the
feature branch and pull request, then must stop and leave the final merge to the
maintainer.

Agents must never use `--admin` with any command. They must not bypass, override,
disable, weaken, or work around branch protection, required reviews, required status
checks, merge queues, or repository rules through a CLI, API, connector, web interface,
or other mechanism. If GitHub reports that a pull request is blocked by policy, report
the blocked state and stop; do not enable auto-merge or attempt a privileged merge.

Agents must not push directly to `main` or merge, cherry-pick, rebase, or fast-forward
feature work into a local or remote `main` branch. Fetching `origin/main`, reading it,
and creating or updating a feature branch from it remain allowed. A local `main`
checkout may be fast-forwarded to an already maintainer-merged `origin/main` only when
the maintainer explicitly asks to refresh that checkout; this never authorizes merging
or pushing feature work.

## Parallel-agent worktrees

Every agent starting a new workstream must create and use a fresh, dedicated Git
worktree and purpose-specific branch. Follow-up prompts, review rounds, CI fixes, and
other continuation work for that workstream must reuse its existing branch and worktree.
Do not create another branch or worktree for continuation work unless the maintainer
directly instructs you to do so. Creating a pull request does not end the workstream.
Within the same task, prompts such as “one more fix”, “also change”, “small follow-up”,
review feedback, and reported CI failures must update the existing branch, worktree, and
pull request. Create a new branch or worktree only after the previous pull request was
merged or closed, or when the maintainer explicitly requests a new branch or workstream.
When the maintainer names an existing branch or worktree, keep all requested work there.
Never reuse the main repository checkout or another agent's worktree. The maintainer
commonly runs four to six agents in parallel; separate worktrees keep independent
workstreams isolated without fragmenting one workstream across repeated review branches.

The only exception is when the maintainer directly instructs that agent to use the main
repository checkout for the current task. Treat the main checkout as
maintainer-controlled in every other case: do not switch its branch, edit its files, or
run implementation commands there. The only repository-level Git operations allowed
against the main checkout when starting a workstream are read-only inspection, fetching
the intended base, and `git worktree list` or `git worktree add`. Run them with
`git -C <main-root>` so the target is explicit.

Before modifying files:

1. Run `git status --short --branch` and identify the current branch and existing user
   changes.
2. If the current branch is `main`, create or switch to a purpose-specific branch before
   the first write.
3. Use branch names such as `feature/<short-description>`, `fix/<short-description>`,
   `docs/<short-description>`, or `chore/<short-description>`.

### Creating a branch and worktree on Windows

First run `git worktree list` and inspect local branches. If the workstream, branch, or
worktree already exists, reuse it for continuation work. Do not create a second one.

For a genuinely new workstream, resolve the main checkout through Git's common directory
instead of assuming the current directory is the main checkout:

```powershell
$commonGitDir = (git rev-parse --path-format=absolute --git-common-dir).Trim()
$mainRoot = Split-Path $commonGitDir -Parent
$workstream = 'short-workstream-slug'
$branch = 'feature/short-workstream-slug'
$worktreesRoot = [IO.Path]::GetFullPath((Join-Path $mainRoot '.codex-worktrees'))
$worktreePath = [IO.Path]::GetFullPath((Join-Path $worktreesRoot $workstream))
$worktreeParent = [IO.Path]::GetDirectoryName($worktreePath)

if (![string]::Equals($worktreeParent, $worktreesRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Worktree must be a direct child of ${worktreesRoot}: $worktreePath"
}

if (Test-Path -LiteralPath $worktreePath) {
  throw "Worktree path already exists: $worktreePath"
}
git -C $mainRoot show-ref --verify --quiet "refs/heads/$branch"
if ($LASTEXITCODE -eq 0) {
  throw "Branch already exists: $branch"
}
git -C $mainRoot fetch origin main
git -C $mainRoot worktree add $worktreePath -b $branch origin/main
Set-Location $worktreePath
$actualWorktreePath = [IO.Path]::GetFullPath((git rev-parse --show-toplevel).Trim())
if (![string]::Equals($actualWorktreePath, $worktreePath, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Git created or selected the wrong worktree: $actualWorktreePath"
}
git status --short --branch
```

In managed Codex, run the fetch and `worktree add` operations with host permission from
the start. The sandbox identity may otherwise reject the maintainer-owned main checkout
as dubious ownership and cannot write linked-worktree metadata. Do not modify global
`safe.directory`, ownership, or Git security configuration to bypass that boundary.

Choose the branch prefix that matches the work. Replace both placeholder values; do not
copy them literally. Before `worktree add`, confirm the path does not exist and the
branch name is unused. Do not nest a worktree under any linked worktree except the
repository's intentionally ignored main-checkout `.codex-worktrees/<workstream>`
directory. This is the only valid location for an agent-created worktree. A writable
directory offered by the Codex host does not override this rule. Never create the
worktree under `.codex/visualizations`, another session-owned directory, a temporary
directory, the repository's parent directory, or another linked worktree.

Before `worktree add`, print and inspect `$worktreePath`. Its direct parent must be the
exact absolute `$worktreesRoot` path. If it is not, stop and correct the command instead
of trying an alternate location. After creation, require `git rev-parse --show-toplevel`
to equal `$worktreePath`; a successful Git command at a different path is not a
successful setup. Only reuse a non-canonical existing worktree when the maintainer
explicitly names that exact worktree for continuation work; never choose such a path for
a new workstream.

Keep the local worktree directory slug at 20 characters or fewer. Windows package paths
can exceed filesystem cleanup limits even when Git accepts a longer worktree path.

The combined `worktree add -b` command creates the branch directly in its worktree
without switching `main`. After creation, every edit, install, test, commit, and server
command must use the new worktree as its working directory. Verify both
`git rev-parse --show-toplevel` and `git status --short --branch` before the first
write.

Do not automatically prune, remove, or repair other worktrees. Remove a worktree and its
branch only when it was created as a disposable validation fixture or the maintainer
explicitly requests removal. Resolve and verify the exact absolute target before
removing it.

### Node, pnpm, PATH, and dependencies

Each worktree has its own `node_modules`. Never copy, move, junction, or symlink
`node_modules` from the main checkout or another worktree, and never invoke a binary
from another worktree's `node_modules/.bin`. pnpm's content-addressed store already
shares package data safely.

Before running JavaScript tooling in a new worktree:

1. Read `.node-version`, `package.json#engines`, and `package.json#packageManager`.
2. Run `Get-Command node.exe`, `node.exe --version`, `Get-Command pnpm.cmd`, and
   `pnpm.cmd --version`.
3. Confirm Node satisfies the declared engine and pnpm matches the declared major and
   pinned package-manager version.
4. If the task needs dependencies, run `pnpm.cmd install --frozen-lockfile` from the
   worktree with network permission available from the start. Even with a frozen
   lockfile and warm pnpm store, missing package archives may require registry access.
   Documentation-only tasks do not need an install unless the required formatter is
   unavailable in the worktree.
5. Prefer repository scripts through `pnpm.cmd <script>`. In managed Windows shells, do
   not use `pnpm exec`: duplicate PATH variables can prevent it from finding the current
   worktree's `.bin` directory. When no repository script exists, invoke the current
   worktree binary explicitly as `.\node_modules\.bin\<tool>.CMD <arguments>`.

On Windows, use `pnpm.cmd`, not the PowerShell `pnpm.ps1` shim; managed shells may block
the latter through execution policy. Do not change machine execution policy to make the
shim work. If `pnpm.cmd` is absent but `corepack.cmd` exists, use `corepack.cmd pnpm`
with the repository-pinned version. If no compatible Node or package manager is
available, report the exact command lookup and version results; do not download or
install a machine-wide runtime during an unrelated task.

If an install or executable lookup fails, verify the current directory and executable
source before changing files:

```powershell
git rev-parse --show-toplevel
Get-Command node.exe
Get-Command pnpm.cmd
pnpm.cmd config get store-dir
```

Delete and reinstall only the current worktree's ignored `node_modules` when evidence
shows it is incomplete or stale. Do not delete the shared pnpm store, another worktree's
dependencies, or the lockfile as a troubleshooting shortcut.

### Repository safety rules

- When asked directly for code review, review code only. Do not run tests, E2E tests, or
  other pnpm automatic checks.
- An explicit request to remove, postpone, or take a feature out of scope authorizes
  staging and committing the corresponding tracked-file deletions on the feature branch.
- Do not create a new remote, change branch protection, publish, or deploy unless the
  user requests it.
- Do not force-push, rewrite shared history, or use destructive Git commands to remove
  user work.
- Use the installed GitHub CLI (`gh`) directly for GitHub repository and remote
  workflows, including pull requests. Verify `gh auth status` before contacting GitHub.
- In managed Codex runs, immediately rerun a sandboxed `gh` authentication or likely
  network failure with required elevated sandbox permission. Treat the elevated result
  as authoritative.
- Preserve unrelated modifications and untracked files. If they overlap the task,
  inspect and incorporate them rather than discarding them.

### Live development servers

Agents must not start or keep a Vite development server running by default. Prefer
source inspection, focused automated tests, production builds, and the bounded
Playwright runner described in [`e2e/AGENTS.md`](e2e/AGENTS.md).

Start a live development server only when the maintainer explicitly requests it or when
a specific verification cannot be completed through those alternatives. Stop it as soon
as that check is complete. Do not create or maintain repository port reservations. For
an explicitly authorized one-off server, use a currently free explicit port with
`--strictPort`; never rely on automatic fallback or terminate an unknown listener.

### CI failure authorization

When the maintainer points to a red or failing current pull request, asks the agent to
check its status, or provides a failing check, test output, CI log, or failure artifact,
treat that as an explicit instruction to inspect the current status and fix any failure
on the existing branch. A status request is not a read-only reporting task when the
current pull request is failing: continue through authoritative log inspection,
diagnosis, the smallest relevant correction, focused verification, commit, push, and one
final pull-request status recheck. Do not merely report the failure or ask for approval
to implement the focused fix; the maintainer's prompt already supplies that
authorization.

Use discrete status and log queries needed for that repair. Do not start a watch
command, polling loop, recurring monitor, or wait command. If the inspected current pull
request has no failure, report its status without waiting for future changes.

Ask for direction only when the proposed response would materially expand the pull
request's scope, requires a destructive or separately protected action, or the failure
cannot be associated with the current workstream. A generic tool or skill workflow that
normally pauses for fix approval does not require a second approval in this specific
maintainer-reported current-PR case.

### Incremental commit cadence and optional planning

Commit implementation incrementally. Group commits around independently reviewable
behavior or one focused structural change, with directly relevant tests and permanent
documentation. Keep intermediate states buildable and internally consistent.

Create or update a branch-local `PLAN.md` only when the work is substantive and
multi-step, or when the intended commit sequence, work split, or verification plan is
not obvious from the task. `PLAN.md` is optional for small features, bug fixes,
documentation-only changes, and single atomic changes.

When a plan is used, each planned commit should:

1. Complete one independently reviewable behavior or focused structural change.
2. Run only the focused checks needed for that commit.
3. Review the staged diff and commit it before starting the next planned scope.

Do not split commits merely to mirror architectural layers, and do not spread one
coherent simplification across unnecessary commits. Do not wait for the final
verification round before committing completed, reviewable work. Treat approximately
1,000 changed handwritten lines in an uncommitted implementation diff as a checkpoint
warning; inspect whether a completed part can be committed without creating a broken or
misleading intermediate state.

### Complexity, implementation, and refactoring

Optimize for simplicity, explicit control flow, strong typing, shallow dependency
graphs, discoverability, and low cognitive load. Prefer changing, reusing, simplifying,
or deleting existing code over adding a parallel implementation.

Before adding a production file, abstraction, service, hook, adapter, state owner, or
dependency:

1. Search for the existing owner of the responsibility.
2. Extend or simplify that owner when doing so preserves clarity.
3. Add an abstraction only when it solves a concrete present-day problem and materially
   improves the code.
4. Record the reason and immediate consumer in `PLAN.md` when a plan is required.

Do not add abstractions for consistency, architectural purity, design-pattern
conformity, possible future reuse, or possible future implementations. Shared code must
have a real shared responsibility or multiple real consumers. Avoid interfaces with one
implementation unless the boundary isolates meaningful external or imperative
complexity. Avoid modules that mostly forward arguments and return values unchanged. Do
not wrap an API unless the wrapper substantially simplifies it or isolates important
complexity.

File count, navigation cost, call depth, dependency count, state duplication, and the
number of concepts needed to understand a feature are forms of complexity. Line count is
a review signal, not a target. Do not reduce it through compressed control flow,
oversized modules, weakened types, removed behavioral coverage, or merged unrelated
responsibilities.

When behavior is replaced, remove the superseded implementation, obsolete compatibility
paths, unused exports, redundant tests, and stale documentation in the same workstream.
Do not keep old and new implementations together unless a concrete, documented runtime
migration requires both.

Before final verification, review the complete diff and remove unnecessary files, dead
branches, wrappers, adapters, interfaces, fallbacks, defensive logic, duplicate helpers,
and temporary compatibility code. Collapse trivial single-consumer abstractions when
they provide no meaningful boundary, lifecycle, or test seam.

Keep production and test measurements separate. Exclude tests, fixtures, generated
files, documentation, scripts, tooling, lockfiles, and formatting-only changes from
production LOC.

- A bug fix makes the smallest semantic change that fixes the demonstrated problem. It
  must not introduce a new architectural layer or unrelated refactoring.
- Refactoring must reduce complexity rather than redistribute it. Prefer deleting code
  over moving, renaming, wrapping, extracting, or splitting it.
- Prefer negative production LOC for simplification work unless added code is necessary
  to preserve required behavior or clarity.
- Preserve valuable existing boundaries when removing them would make the code less
  clear or less safe.

### Feature finalization and pull request

A workstream is not finished until final verification passes and its branch is available
in a GitHub pull request targeting `main`. By final verification, the work should
already be distributed across coherent commits.

After final verification:

1. Commit only cleanup caused by final verification or documentation corrections.
2. Remove branch-local `PLAN.md`, if present, and commit its removal. It must not appear
   in the final pull-request state or on `main`.
3. Push the branch and open a ready-for-review pull request, or update the existing pull
   request for that branch.
4. Immediately after PR creation or update, and again after the final push, run
   `gh pr view --json mergeable,mergeStateStatus,url`. Do not hand off while `mergeable`
   is `CONFLICTING` or `mergeStateStatus` is `DIRTY`. Merge the latest `origin/main`
   into the feature branch without rebasing, resolve every conflict, rerun only
   invalidated checks, push, and query the PR again. If GitHub temporarily reports
   `UNKNOWN`, wait for mergeability calculation and query the same PR once more rather
   than assuming it is conflict-free.
5. Give the user the pull-request link and report the active branch, commits, checks
   run, checks skipped as not applicable, and whether the branch is awaiting approval.

This standing instruction authorizes feature-completion push and pull-request creation
without another prompt. Never create a duplicate pull request for the same branch. After
PR creation or update and the mergeability check, report to the maintainer immediately.
Do not look up workflow runs, run `gh run watch`, poll checks, or wait for CI
completion. The maintainer tracks CI status and will provide a failure when agent action
is needed.

### Final handoff format

Every completed-workstream report must present these fields together and in this order:

- `PR link:` the clickable pull-request URL.
- `Branch:` the exact branch name.
- `Worktree path:` the absolute path to the worktree that owns the branch.
- `Commits:` every workstream commit as a short hash and subject, oldest first.
- `Verification:` every command run and its result, plus checks skipped as
  `Not applicable` with the reason.
- `Status:` current mergeability and whether the branch is awaiting maintainer approval.

Do not include a live-server startup command unless the maintainer explicitly requested
a live server for the handoff.

### Pull request title and description

Pull-request titles must use `<type>(<scope>): <imperative summary>`. The type must be
one of `feat`, `fix`, `refactor`, `docs`, `test`, `perf`, `build`, `ci`, or `chore`.
Scope is mandatory, short, and lowercase kebab-case. The summary starts with an
imperative verb, names the concrete outcome, has no trailing period, and keeps the
complete title at 72 characters or fewer.

Every pull-request description must use these headings in order:

1. `## Outcome`
2. `## Changes`
3. `## Verification`
4. `## UI evidence`, only when presentation behavior changes
5. `## Risk and rollback`
6. `## Review guidance`

Description rules:

- Describe the final branch state, not chronology or planned work.
- Keep Outcome to one through three concrete bullets.
- Group Changes by behavior or responsibility and name removed or replaced code.
- Report handwritten production additions and deletions, test additions and deletions,
  production and test files added, removed, and moved, new runtime dependencies, every
  new abstraction with its concrete current justification, and significant abstractions
  removed.
- State whether the result could be smaller without losing required behavior or clarity.
- Use `Not applicable - no production code changed` for production LOC on documentation,
  test-only, or configuration-only work.
- Verification must be a table naming every required command and manual check. Results
  are `Passed`, `Failed`, `Not run`, or `Not applicable`, with concise evidence or a
  reason.
- UI evidence includes before/after screenshots or recordings, viewport details, and
  comparison notes against the documented UI contracts.
- State a real risk and concrete rollback path.
- Tell reviewers where to start and what invariant or tradeoff deserves attention.
- Update the title and description whenever scope, evidence, risk, or reviewer focus
  materially changes.

## Documentation ownership: system description vs planning

Keep stable system documentation independent from work breakdown and delivery progress:

| Location          | Owns                                                                                                                                | Must not contain                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `README.md`       | Stable project overview, current capabilities, setup, and commands                                                                  | Feature stages, task IDs, estimates, branch/commit/PR status, or progress tracking              |
| `docs/`           | Stable feature concepts, implemented behavior, architecture, and operation                                                          | Task ordering, estimates, branch/commit/PR status, or delivery history                          |
| `AGENTS.md` files | Repository-wide or directory-specific agent workflow and engineering constraints                                                    | Product roadmap, duplicated feature specifications, or detailed design documentation            |
| `TOP_LVL_PLAN.md` | TO-BE product roadmap, feature ordering, dependencies, broad acceptance, and high-level progress                                    | Detailed durable technical contracts that belong in `docs/`, code, or tests                     |
| `PLAN.md`         | Optional branch-local tasks, work splits, commit sequence, verification plan, and detailed progress for substantive multi-step work | The only explanation of a feature's meaning, runtime contract, ownership, or operating behavior |

Rules:

- `README.md` and `docs/` may describe unavailable features needed to explain the
  reviewed system concept, but must not say when, in which stage, or through which task
  or branch they will be implemented.
- Roadmap sequencing, estimates, branch tracking, approval progress, and implementation
  history belong only in `TOP_LVL_PLAN.md` or in a temporary `PLAN.md` when one is used.
- Stable documentation must not depend on a planning section, task number, or
  implementation split to explain a lasting contract.
- Move durable facts discovered during implementation into `README.md`, `docs/`, code
  contracts, or tests in the same change.
- When reviewed UI direction conflicts with stale repository prose, update the stable
  feature documentation rather than expanding `AGENTS.md` with product or design detail.

## Maintainer context

The maintainer is a backend developer and technical lead. Optimize for explicit control
flow, discoverable structure, strong typing, shallow dependencies, and readable code. Do
not assume deep familiarity with modern frontend conventions; document non-obvious React
behavior and explain frontend-specific tradeoffs in pull requests and handoffs. Do not
introduce backend-style layering merely because it may look familiar.

## Repository boundaries

Do not restate the complete product concept here. Treat `README.md` and `docs/` as the
source of truth. Unless the maintainer approves a change, preserve these engineering
boundaries:

- TypeScript and React functional components in a static GitHub Pages application.
- Current stable desktop Google Chrome as the supported browser target.
- Local-first user data and no automatic diagnostic or telemetry upload.
- No application server, accounts, cloud synchronization, OAuth, SSR, or automatic
  trail-following routing in the current scope.

Existing diagnostics and developer-support behavior may be simplified only in a focused
refactor that preserves privacy and the reviewed support capability. Do not expand it by
default in unrelated work.

## Documentation-only verification

When only Markdown or other non-executable documentation changes, do not run TypeScript,
ESLint, tests, coverage, Playwright, or builds. Run Prettier against every changed
Markdown file, including `AGENTS.md`, once after the final edits and before handoff. Use
`.\node_modules\.bin\prettier.CMD --write <changed-markdown-files>` when formatting is
needed, then require `.\node_modules\.bin\prettier.CMD --check <changed-markdown-files>`
to pass, then run `git diff --check`.

Documentation-only pull requests must keep required CI conclusive while skipping
Playwright installation and execution. Classification must inspect the complete diff; do
not use top-level path filters that leave a required check pending.

## CI policy

GitHub Actions runs on every pull request and protected-branch push. Required checks
include frozen-lockfile installation, the repository audit, formatting, linting, type
checking, Vitest coverage, a production build, and Chromium/axe checks against the built
application. Documentation-only diffs report an explicit successful E2E skip. Required
checks block merging.

## Commands

`package.json` is the canonical command list. On managed Windows, invoke pnpm as
`pnpm.cmd`; examples below use the shorter cross-platform spelling.

- `pnpm repo:audit`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm diagnostics:inspect -- <bundle.json>` when support-bundle work requires it
- `pnpm build`
- `pnpm check`

Vitest commands are documented in [`tests/AGENTS.md`](tests/AGENTS.md). Playwright
commands are documented in [`e2e/AGENTS.md`](e2e/AGENTS.md). A live development server
is not part of normal agent verification.

## Environment troubleshooting and self-repair

Agent workflow instructions must improve when a reproducible repository-specific
environment problem is discovered. Do not leave the next agent to rediscover a known
PATH, worktree, dependency, shell, browser, or command-wrapper failure.

When the documented primary path fails:

1. Reproduce it with the smallest safe command and capture the exact symptom.
2. Determine whether the cause belongs to the repository/worktree, the managed shell, or
   the host machine. Do not hide a machine problem with a source-code change.
3. Apply the smallest safe fix to the current worktree or invocation.
4. Verify the fix from the affected worktree; use a disposable worktree when the problem
   concerns worktree creation or first-time setup.
5. Correct the relevant root or nested `AGENTS.md` instruction so its primary command
   path works without encountering the same failure. Delete the broken command and
   superseded alternatives in the same edit.
6. Update `README.md` instead when the solution is a stable developer setup or operator
   workflow, and update the appropriate `docs/` file when it changes a lasting runtime
   or architecture contract.

Do not append a known-problems list, incident diary, fallback ladder, or collection of
commands to try. Those make every agent replay failures before finding the working path.
The authoritative section must contain one tested primary sequence and only unavoidable
decision branches. Do not include dates, task IDs, branch names, transient logs,
personal paths, secrets, or machine-only workarounds that other agents cannot use.

## Final verification and definition of done

Run one final verification round after implementation and expected quick follow-up
changes are complete.

1. Review the complete branch diff. Confirm behavior, tests, and permanent documentation
   agree. Apply the complexity and cleanup rules above before running broad checks.
2. For documentation-only changes, follow the documentation-only verification section
   and do not run executable checks.
3. For executable code, run `pnpm format:check`, `pnpm typecheck`, and `pnpm lint` once,
   unless a broader aggregate already includes them.
4. Read and apply [`tests/AGENTS.md`](tests/AGENTS.md) when the changed behavior or
   selected verification requires Vitest. Read and apply
   [`e2e/AGENTS.md`](e2e/AGENTS.md) only when the browser scope is justified. Do not run
   Playwright merely because the change touches UI code.
5. Run `pnpm repo:audit`, diagnostics inspection, or a production build only when the
   changed scope requires it. If `pnpm check` is the chosen aggregate, do not also run
   the checks it already contains.
6. If a check fails and code changes to fix it, rerun the failed check first. Rerun only
   broader checks invalidated by that fix.
7. Do not start a live development server or perform open-ended manual browsing as a
   normal final-verification step. Use bounded automated evidence unless the maintainer
   explicitly requests live review.
8. Confirm no secret, private GPX metadata, generated debug file, or unrelated artifact
   is included. Confirm non-obvious exported contracts and invariants have accurate,
   compact comments.
9. Report handwritten production LOC added/removed; test LOC added/removed; production
   and test files added/removed/moved; runtime dependencies; new abstractions and their
   current justification; significant abstractions removed; and whether the result could
   be smaller without losing behavior or clarity.

Do not duplicate successful checks. If files change after the final round, rerun only
invalidated checks. Do not mark work complete while a required check fails; report an
external or pre-existing failure precisely and preserve unrelated user changes.
