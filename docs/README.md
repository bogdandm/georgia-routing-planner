# Project documentation

This directory explains the implemented system and durable approved contracts. It
complements, rather than repeats, the product roadmap and implementation plan; each
document distinguishes current behavior from target contracts where necessary.

| Document                                                                    | Purpose                                                                        | Update when                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| [Project structure](./project-structure.md)                                 | Module boundaries, dependency direction, composition, and state ownership      | Files move, a layer is added, or ownership changes        |
| [Data model](./data-model.md)                                               | MVP entities, attributes, storage authority, privacy, and consistency rules    | A persisted contract, source, cache, or ownership changes |
| [Features](./features.md)                                                   | Implemented behavior, failure handling, diagnostics, tests, and deferred scope | User-visible behavior or a failure mode changes           |
| [Runtime flows](./runtime-flows.md)                                         | Startup, camera, terrain, provider errors, health checks, and export sequences | Cross-module control flow or lifecycle ordering changes   |
| [Map providers](./map-providers.md)                                         | Provider choice, schema, attribution, evidence, and operating limits           | An endpoint, policy, attribution, or provider changes     |
| [Provider configuration example](./map-provider-configuration.example.json) | Valid public configuration accepted by the production Zod boundary             | The configuration schema or defaults change               |

Repository-level references:

- [README](../README.md): setup, commands, current status, and operator quick start.
- [AGENTS](../AGENTS.md): mandatory engineering and documentation rules.

`PLAN.md` and `TOP_LVL_PLAN.md` are temporary planning artifacts. They may be
regenerated or deleted and must never be the only place that records product scope,
project structure, behavior, decisions, operations, or maintenance knowledge.

## Maintenance rule

Documentation changes ship with the behavior they describe. Prefer a short statement of
ownership, invariant, failure behavior, or rationale plus a link to code. Do not copy
implementation details that are already obvious from a function body.
