# AGENTS.md

## Scope

These instructions apply to production code and runtime assets under `src/`. The root
[`AGENTS.md`](../AGENTS.md) also applies. Tests must remain outside `src/`. Read
[`../tests/AGENTS.md`](../tests/AGENTS.md) only when adding, changing, or running Vitest
tests. Read [`../e2e/AGENTS.md`](../e2e/AGENTS.md) only when adding, changing, or
running Playwright workflows.

Use [`../docs/project-structure.md`](../docs/project-structure.md) and
[`../docs/runtime-flows.md`](../docs/runtime-flows.md) for the durable system
explanation. Keep this file focused on implementation boundaries rather than repeating
product or visual specifications.

## Current source layout and dependency direction

The current repository shape is:

```text
src/
  main.tsx          browser entry and provider nesting
  bootstrap/        composition root and React runtime-service context
  domain/           framework-independent values and calculations
  application/      use cases and framework-independent ports
  infrastructure/   HTTP, storage, worker, clock, and ID adapters
  diagnostics/      bounded logging, redaction, health, snapshots, and export
  presentation/     React shell, map, feature UI, theme, and styles
```

`src/bootstrap/createRuntimeServices.ts` is the composition root that constructs runtime
adapters. `src/main.tsx` installs the top-level providers. Do not construct browser
adapters in feature components or add another composition root.

Dependencies point toward contracts. Existing ESLint rules keep `src/domain/` and
`src/application/` independent of React, MUI, MapLibre, Dexie, `ky`, Zustand,
infrastructure, and presentation code. Preserve those boundaries. Presentation and
infrastructure may depend on application ports; application and domain code must not
depend on UI or browser adapters.

## Technology and dependency policy

Core technologies to preserve:

- React functional components, strict TypeScript, and Vite.
- Material UI and MUI Icons for the existing UI system.
- MapLibre GL JS through `react-map-gl/maplibre`.
- pnpm with a committed lockfile.

Use installed libraries only where they fit an existing or concrete responsibility: `ky`
for HTTP transport, Zod at genuinely untrusted boundaries, Zustand for suitable
cross-feature transient state, Dexie for IndexedDB persistence, focused Turf packages
for geospatial calculations, and the existing GeoTIFF, projection, worker, diagnostics,
and support tooling where already owned.

A feature does not need to use every installed state, transport, persistence,
validation, or diagnostics library. Do not add another component library, CSS framework,
global state framework, HTTP client, map engine, or utility grab-bag without documenting
the concrete gap.

Dependency rules:

- Pin reproducible versions through `pnpm-lock.yaml`.
- Prefer current stable, maintained packages with TypeScript types.
- Avoid release candidates, nightlies, deprecated packages, and unnecessary utilities.
- Inspect licenses before addition and explain every new runtime dependency.
- Prefer browser APIs when their ergonomics and failure handling are adequate.
- Audit and check bundle impact for significant additions.

## Architecture and production organization

Architecture serves concrete current requirements. Organize production code primarily
around features and meaningful subsystems, and keep closely related code together. A
feature should normally be understandable without tracing a long chain of layers,
forwarding abstractions, or dependency-registration entries.

Prefer cohesive modules and plain functions. Use classes only when lifecycle, identity,
encapsulated mutable state, or management of a complex imperative API clearly justifies
them. Preserve the repository's existing domain, application, port, infrastructure, and
composition boundaries where they protect real dependencies, but do not reproduce the
full layer set mechanically for every feature. Do not add named use-case classes,
constructor injection, repositories, gateways, adapters, services, facades, factories,
managers, controllers, providers, interfaces, or dependency injection by default.

Do not split cohesive logic merely to maintain formal layer boundaries or
one-export-per-file conventions. Production structure must reflect actual ownership, not
a predefined directory diagram. Do not create directories for features or subsystems
that do not exist. A small number of genuinely shared runtime subsystems is appropriate
when their responsibility is real and their consumers are known.

Preserve deliberate isolation around genuinely complex imperative systems and
external-data boundaries, including MapLibre integration and untrusted imported or
remote data. Do not generalize those exceptions into a repository-wide architecture.
Avoid circular dependencies and barrel exports that hide ownership, dependency
direction, or cycles.

## React and TypeScript

- Keep JSX declarative and components small enough to remain feature-focused.
- Keep business rules in cohesive feature code and preserve existing application/domain
  ownership; do not add classes or another layer solely for consistency.
- Isolate complex imperative MapLibre lifecycle and event handling behind the smallest
  useful boundary.
- Do not store mutable class instances in Zustand or other serializable state stores.
- Do not use React class components or UI inheritance hierarchies.
- Keep strictness flags enabled, including `strict`, `noUncheckedIndexedAccess`, and
  `exactOptionalPropertyTypes`.
- Do not use `any`. Use `unknown` at untrusted boundaries and narrow it.
- Use readonly data where mutation is not intentional and discriminated unions for
  useful finite states.
- Name ambiguous primitives, especially GeoJSON `[longitude, latitude]` coordinates.
- Prefer exhaustive handling, type-only imports, and consistent descriptive file names.

## TypeScript object construction

Avoid building objects with long chains of conditional spreads.

Do not write patterns like:

```ts
return {
  requiredField,
  ...(value === undefined ? {} : { optionalField: value }),
  ...(getValue() === undefined ? {} : { anotherField: getValue() as string }),
};
```

Rules:

- Do not use `...(condition ? { key: value } : {})` repeatedly to populate optional
  properties.
- When an object has more than two conditional properties, create the base object first
  and assign optional properties with explicit `if` statements.
- Compute derived values once. Do not repeat parsing, DOM lookup, trimming, validation,
  or function calls for the same property.
- Do not use type assertions to compensate for repeated expressions or missing type
  narrowing.
- Prefer natural TypeScript narrowing after assigning a value to a local variable.
- Validate untrusted strings before treating them as string-literal unions.
- Preserve semantic differences between `undefined`, `null`, empty strings, and other
  falsy values.
- Prefer readable, debuggable code over compact object-expression tricks.

Preferred:

```ts
const name = boundedText(firstChild(metadata, 'name'));

const result: ParsedMetadata = {
  version,
  links: parseLinks(metadata),
};

if (creator !== undefined && creator.length > 0) {
  result.creator = creator;
}

if (name !== undefined) {
  result.name = name;
}

return result;
```

Conditional spreads are acceptable for one or two simple properties when each value has
already been computed and the result remains easier to read than explicit assignment.

## Control flow, external data, and errors

- Prefer `async`/`await` and explicit control flow over nested callback workflows.
- Pass `AbortSignal` through operations where cancellation is materially required.
- Keep retry ownership in one place and avoid duplicate automatic retries.
- Clean up map listeners, object URLs, workers, and subscriptions deterministically.
- Validate genuinely untrusted external data at the boundary where it enters trusted
  code. Do not repeat validation, mapping, normalization, result wrapping, or error
  conversion when it adds no meaningful behavior.
- Handle demonstrated and realistic failure modes. Do not add speculative fallbacks,
  compatibility paths, recovery frameworks, or distinct typed error layers when the UI
  treats the failures identically.
- Render intentional loading, empty, partial, and error states where the interaction
  needs them.
- Set explicit HTTP timeouts where appropriate, treat failures differently only when
  callers can act differently, and keep public endpoint configuration replaceable.
- Do not put secrets in Vite environment variables; `VITE_*` values are public.
- Respect OSM, imagery, STAC, and elevation-provider attribution and usage rules.

## State ownership and persistence

Choose the smallest state or persistence mechanism appropriate to the current
responsibility. Keep ownership local and obvious:

- Use component state or reducers for local visual and interaction state.
- Use Zustand only for genuinely cross-feature transient, serializable state.
- Use URL state for intentionally shareable camera or filter state.
- Use Dexie through the existing infrastructure adapters and application-facing ports.
  Extend the current owner rather than adding a parallel repository or duplicating
  persistence access in presentation code.
- Keep imperative MapLibre objects, workers, caches, and subscriptions inside their
  existing runtime owners; expose only serializable snapshots to React and Zustand.

Do not duplicate authoritative state across React, Zustand, Dexie, the URL, MapLibre, or
worker-owned caches. Document a non-obvious owner. Business rules may be plain functions
or cohesive modules; use existing application/domain boundaries where they already own
the responsibility rather than adding a parallel implementation.

## Proportional diagnostics and privacy

Diagnostics, logging, health checks, redaction, support exports, schema versioning,
correlation IDs, and troubleshooting tools must be proportional to current product and
support needs. Do not require every feature or ordinary operation to participate in a
repository-wide diagnostics framework or emit start, completion, failure, cancellation,
correlation, and duration events.

Do not require support-bundle compatibility, diagnostics schema migrations, a
diagnostics CLI, a health-check framework, or bootstrap-level export recovery unless it
remains an explicit current product requirement for the changed scope. User-visible
error states do not require a parallel exported diagnostic representation. Focused
development diagnostics may use `console` directly when centralized structured logging
provides no concrete benefit; remove temporary noisy logging before handoff.

Preserve these privacy boundaries:

- Never log or export secrets, authorization headers, tokens, cookies, private user
  data, raw imported content, arbitrary query strings, local paths, or complete
  environment objects.
- Do not export raw GPX, full geometry, timestamps, descriptions, or filenames by
  default. Geometry export requires explicit user opt-in.
- Keep retained diagnostic data bounded when retention exists.
- Never upload diagnostics or telemetry automatically.
- Logging and diagnostics must not make the primary operation fail.

When changing currently implemented diagnostic export, redaction, or telemetry
boundaries, add focused tests proving private data is excluded.

## UI and CSS

Material UI is the default for application chrome and controls. Follow
[`../docs/ui-design.md`](../docs/ui-design.md) for placement, hierarchy, spacing,
disclosure, copy, and presentation review; do not duplicate those details here.

- Use the shared theme and prefer MUI layout primitives and components over handwritten
  widgets.
- Use `sx` for small one-off details and CSS modules for map sizing or complex layout.
- Keep feature-specific controls with their feature and application-wide preferences in
  Settings; do not duplicate the same control in multiple surfaces.
- Do not leave empty layout or status wrappers that still contribute spacing.
- Remove helper text that repeats visible values, labels, order, or obvious behavior.
- Do not add Tailwind, Bootstrap, another design system, or another CSS-in-JS library.
- Maintain keyboard access, labels, tooltips where needed, contrast, and adequate hit
  areas.

## Map boundary

`presentation/map/MapWorkspace.tsx` translates React state and user commands.
`MapLibreFacade.ts` owns the native map, listeners, camera lifecycle, WebGL state, and
cleanup. `MapLibreLayerController` owns native sources, layers, ordering, terrain, and
satellite commands. Pure style construction and stable identifiers belong in
`mapStyleFactory.ts`, `mapIds.ts`, and the shared map palette owner.

- Isolate MapLibre's complex imperative lifecycle and events within the map feature.
- Keep layer, source, and protocol IDs centralized and typed.
- Use GeoJSON layers for many tracks and DOM/MUI markers only for a small number of
  interactive waypoints.
- Throttle high-frequency events before updating React, serializable stores, or URL
  state.
- Do not recreate the map because unrelated panel state changed.
- Keep required provider attribution visible.
- Test required layer ordering and do not leak the native map object to unrelated code.
- Keep provider URLs, worker state, parsed DEM data, and native caches inside their
  existing owners rather than exposing them through React state or application ports.

## GPX and imported-data rules

- Never alter the original GPX collection in place during auditing or indexing.
- Generate published copies and metadata into a separate output directory.
- Validate coordinate ranges, segment sizes, XML structure, and resource limits.
- Keep generated metadata deterministic and load full-resolution GPX only on demand.
- Version schemas or calculation policies when compatibility is a current requirement.
- Record rejected or suspicious tracks in a machine-readable validation report.
- Preserve attribution and provenance. Remove private metadata only under an explicit
  documented publishing policy.

## Source-change verification

Changed production behavior requires proportionate automated coverage outside `src/`.
Use the smallest public boundary that demonstrates the behavior, then follow the final
verification rules in the root file and the focused commands in the nested test files.

For executable source changes, run formatting, type checking, and linting once in the
final round unless a broader aggregate already includes them. Do not start a live
development server merely to confirm that the application opens.
