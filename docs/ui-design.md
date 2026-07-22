# UI design guidelines

The workspace contract in [Features and workspace UX](./features.md) is authoritative
for layout, feature placement, and interaction hierarchy. These guidelines define the
default treatment for presentation details and keep adjacent feature surfaces visually
coherent.

## Place controls with their feature

- Put a control in the contextual feature panel where its result is visible. Reserve
  Settings for application-wide preferences that do not belong to one feature.
- Do not expose the same control in both Settings and a feature panel.
- Group controls by the source or capability they affect. Use the provider or data
  source as the section heading when that context helps users understand the result.
- Place a dependent control immediately after its parent. For example, isoline distance
  follows the Elevation isolines toggle.
- Put advanced repair, diagnostic, or exceptional-behavior controls at the end of their
  group unless they must be handled before the primary controls.

## Maintain a clear visual hierarchy

Use the existing MUI typography variants consistently:

| Element                    | Treatment                        |
| -------------------------- | -------------------------------- |
| Panel title                | Existing shell heading treatment |
| Section or source heading  | `subtitle2`, bold                |
| Control title              | `body2`, regular                 |
| Description or helper copy | `caption`, secondary text color  |

Control labels must not be larger or visually stronger than their section heading.
Descriptions align with the text of the control they explain, not with the checkbox or
switch edge.

Compact checkboxes use a small glyph with no root padding and an 8 px gap before their
label. The glyph aligns with the section content edge; any description aligns with the
label text.

Use checkboxes for independent boolean options throughout the application, including
layer visibility, rendering options, corrective processing, and developer controls. Do
not mix switches and checkboxes when they represent the same kind of choice.

## Use an 8 px spacing rhythm

Prefer MUI `Stack` spacing and theme units over unrelated one-off margins.

- Separate major sections by 16 px and a divider when the source or responsibility
  changes.
- Keep a section heading close to its description, then leave 8 px before its controls.
- Use 12 px between repeated control-and-description rows.
- Use 8 px between a parent control and a compact dependent row.
- Keep a label, slider, and current value on one line when they fit without crowding.
- Do not render empty layout wrappers with margins or gaps; conditional wrappers must be
  conditional with their content.
- Check spacing at the actual panel width. A mathematically consistent gap can still be
  visually excessive when a slider or MUI control contributes internal height.

## Keep contextual panels stable

- Satellite and Layers use the same responsive sidebar width: 420 px normally and 464 px
  at the extra-large breakpoint.
- Switching feature tabs must not move the map because adjacent panels use arbitrary
  widths.
- A different width requires a concrete workflow need and visual review against the
  neighboring panels.

## Use disclosure for secondary controls

- Put infrequent tuning controls behind a collapsed MUI disclosure when the primary
  workflow does not require them.
- Place the disclosure at the end of the section so it does not interrupt primary
  controls.
- Give the summary a specific name, expose `aria-expanded`, and keep the contents out of
  the accessibility tree while collapsed.
- Do not hide primary actions, required error recovery, or a control users need to
  understand the current map state.

## Keep helper text useful

- Keep helper copy only when it prevents a likely mistake, explains a non-obvious
  consequence, or communicates a limitation.
- Remove text that merely repeats selected values, nearby labels, visible ordering, or
  obvious slider behavior.
- Prefer one concise sentence. Avoid stacking several low-value help lines between
  controls.
- Keep provider and capability wording concrete; avoid generic labels when the data
  source matters.

## Review presentation changes

For a changed contextual panel:

1. Compare it with the adjacent feature panel at the same viewport.
2. Confirm panel widths, heading hierarchy, label sizes, text insets, and repeated-row
   spacing.
3. Exercise collapsed and expanded disclosures and verify keyboard access and accessible
   names.
4. Check that removed or moved help copy has not left an empty gap.
5. Capture browser evidence and inspect console errors before handoff.

Prefer focused interaction tests for placement, accessible names, disclosure state, and
ordering. Avoid assertions against generated MUI class names.
