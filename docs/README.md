# Project documentation

This directory explains how the application works, the reviewed system concept, current
capability boundaries, and durable technical contracts.

| Document                                                                           | Purpose                                                                                          | Update when                                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| [Project structure](./project-structure.md)                                        | Module boundaries, dependency direction, composition, and state ownership                        | Files move, a layer is added, or ownership changes                   |
| [Data model](./data-model.md)                                                      | Implemented records, storage authority, privacy, and consistency rules                           | A persisted contract, source, cache, or ownership changes            |
| [Features and workspace UX](./features.md)                                         | Penpot-aligned system concept, implemented behavior, capability boundaries, and failure handling | User-visible behavior, layout, navigation, or a failure mode changes |
| [UI design guidelines](./ui-design.md)                                             | Placement, hierarchy, spacing, disclosure, copy, and visual-review defaults                      | A reusable presentation convention or panel pattern changes          |
| [Runtime flows](./runtime-flows.md)                                                | Startup, camera, terrain, provider errors, health checks, and export sequences                   | Cross-module control flow or lifecycle ordering changes              |
| [Map providers](./map-providers.md)                                                | Provider choice, schema, attribution, evidence, and operating limits                             | An endpoint, policy, attribution, or provider changes                |
| [Provider configuration example](./map-provider-configuration.example.json)        | Valid public configuration accepted by the production Zod boundary                               | The configuration schema or defaults change                          |
| [Geocoding configuration example](./geocoding-provider-configuration.example.json) | Valid public place-search configuration accepted by its Zod boundary                             | The geocoding configuration schema or defaults change                |

Repository-level references:

- [README](../README.md): project overview, setup, commands, and operator quick start.
- [AGENTS](../AGENTS.md): mandatory engineering and documentation rules.

## Maintenance rule

Documentation changes ship with the behavior they describe. Prefer a short statement of
ownership, invariant, failure behavior, or rationale plus a link to code. Do not copy
implementation details that are already obvious from a function body.
