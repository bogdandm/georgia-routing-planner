# AGENTS.md

## Scope

These instructions apply to production configuration, migrations, and Edge Functions
under `supabase/`. The root [`AGENTS.md`](../AGENTS.md) also applies. Supabase tests
belong under `tests/` and follow [`tests/AGENTS.md`](tests/AGENTS.md). Browser client
code belongs under `src/` and follows [`../src/AGENTS.md`](../src/AGENTS.md). Keep
durable schema and runtime descriptions in the existing canonical documentation; do not
turn this file into a provider inventory or feature specification.

## Change ownership and deployment boundary

Treat committed files under `supabase/` as the source of truth for the deployed Supabase
project. The GitHub integration deploys them only after the maintainer merges the owning
branch. Agents prepare, test, commit, push, and review changes, but never apply
production migrations, deploy functions, edit the live project through the Dashboard, or
merge into `main`.

Never request, retrieve, print, log, persist, or commit a service-role key, personal
access token, database password, refresh token, or administrative credential. Browser
and ordinary CI paths receive no privileged Supabase credential.

## Migrations and Postgres

- Once a migration has been deployed or merged into the deployment branch, correct it
  with a new forward-only migration. Do not rewrite history to repair a live schema.
- Keep schema, constraints, indexes, RLS policies, grants, storage configuration, and
  stored functions explicit and reviewable in migrations. Do not rely on manual
  Dashboard state for a durable contract.
- Enable RLS on every browser-reachable table. Tenant isolation must derive from
  `auth.uid()`; never accept a caller-supplied user ID as authorization.
- Keep Storage buckets private. Storage policies must isolate the first object-path
  segment by the authenticated user ID and validate the application-owned MIME type and
  size limits.
- Revoke default execution from `public`, `anon`, and `authenticated` before granting
  only the RPCs each role needs. Administrative functions remain unavailable to browser
  roles.
- Every `SECURITY DEFINER` function uses an empty `search_path`, schema-qualified object
  names, explicit privilege grants, and the narrowest practical return contract.
- Enforce quota, revision, reservation, deduplication, and lifecycle invariants inside
  one database transaction with deterministic locking. Do not move concurrency
  correctness into best-effort Edge Function logic.
- Prefer constraints and indexes that match real authorization and query paths. Do not
  add speculative indexes or duplicate invariants in application code.

## Edge Functions and Deno

- Edge Functions run on Deno. Use the pinned `supabase/functions/deno.json` and
  `deno.lock`; do not use Node-only APIs, unpinned remote imports, dynamic dependency
  URLs, or undeclared environment assumptions.
- Authenticate through the project JWT boundary and pass the caller identity to RLS.
  Never trust identity, ownership, quota, revision, or object paths supplied only by the
  request body.
- Validate request methods, content types, action discriminants, payload sizes, hashes,
  revisions, metadata, and Storage responses before use. Return bounded public errors;
  never expose SQL details, JWTs, configuration values, or provider responses.
- Keep upload compensation ownership-safe. Cleanup and release operations must identify
  the exact reservation attempt or object path so a delayed caller cannot delete or
  release a newer caller's work.
- Keep handlers thin: HTTP parsing and response mapping belong in the function; durable
  authorization, concurrency, and accounting belong in Postgres.
