# Track folders

## Commits

1. Add the local folder domain, IndexedDB schema, migrations, atomic persistence
   operations, and focused persistence tests.
2. Add the Postgres folder contract, Edge Function actions, browser synchronization, and
   focused database/function/worker tests.
3. Add the shared icon picker, responsive folder UI, accessible drag-and-drop, component
   tests, localization, and durable documentation.

## Verification

- Run focused persistence tests before commit 1.
- Run focused synchronization, Edge Function, and database tests before commit 2.
- Run focused Tracks workspace tests and bounded desktop/mobile browser verification
  before commit 3.
- Run the repository final verification matrix once after cleanup.
- Run the mandatory read-only reviewer against `origin/main...HEAD`, resolve material
  findings, then push and open the pull request.
