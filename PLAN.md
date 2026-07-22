# UI consistency sweep

## Existing code to reuse

- Existing MUI `Stack`, `FormControlLabel`, `Checkbox`, `TextField`, `Button`, and
  dialog composition.
- The typography and spacing conventions documented in `docs/ui-design.md` and already
  applied in `LayersPanel`.
- Existing WorkspaceShell interaction tests for Settings, sharing, Satellite, and Layers
  behavior.

## Replace or remove

- Replace remaining switch controls with checkboxes where they represent independent
  boolean options.
- Replace ad hoc dialog margins and inconsistent default control sizes with explicit
  compact sizes and Stack-based spacing.
- Remove empty or redundant layout gaps discovered during the presentation audit.

## New production structure

No new production file, abstraction, state owner, or dependency is required. Changes
remain in the components that already own each surface.

## Commit sequence

1. Normalize control type, sizing, hierarchy, and spacing across the existing compact
   panels and dialogs; update focused interaction tests and UI guidance.
2. Remove this plan after final verification.

## Verification

- Focused WorkspaceShell tests for Settings, sharing, Satellite, and Layers.
- Full test suite, lint, formatting, type checking, and production build.
- Browser review of the Share dialog and affected compact panels at the same desktop
  viewport.
