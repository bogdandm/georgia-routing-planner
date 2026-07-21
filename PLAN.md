# AGENTS.md Follow-up Plan

## Commit sequence

1. **Add a code-growth budget**
   - Require reuse, replacement, and deletion analysis before adding production code.
   - Add simplification checkpoints and review triggers for large net growth.

2. **Standardize pull requests**
   - Define one mandatory PR title format.
   - Define one mandatory PR description structure and evidence rules.

3. **Finalize the follow-up**
   - Format and verify the changed documentation.
   - Remove this temporary plan.
   - Push the branch and update the existing PR title and description.

## Verification

- Check `AGENTS.md` with the repository-pinned Prettier version.
- Run the documentation-boundary search required by `AGENTS.md`.
- Run `git diff --check`.
- Do not run executable-code checks for this documentation-only follow-up.
