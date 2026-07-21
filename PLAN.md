# AGENTS.md Workflow Cleanup Plan

## Commit sequence

1. **Clarify incremental commit cadence**
   - Replace the informal anti-mega-commit language with explicit planning, checkpoint,
     focused-verification, and commit-boundary rules.
   - Integrate `PLAN.md` cleanup and pull-request handoff into one finalization contract.

2. **Consolidate verification policy**
   - Separate focused development feedback from one final verification round.
   - Define when successful verification may be reused.
   - Remove duplicate CI-shaped E2E instructions and make local Playwright scope-driven.

3. **Finalize documentation**
   - Review the complete diff for contradictions and unnecessary repetition.
   - Run only documentation verification required by `AGENTS.md`.
   - Remove this temporary plan before the final pull-request state.

## Verification

- Format-check `AGENTS.md` with the repository's documentation formatter.
- Run the documentation-boundary search required by `AGENTS.md`.
- Run `git diff --check`.
- Do not run TypeScript, ESLint, Vitest, coverage, build, or Playwright commands.
