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

Buttons use the shared theme hover treatment: text and outlined variants receive a
clearly visible color-aware background, outlined buttons strengthen their border, and
contained buttons darken with a stronger shadow. Feature code must not weaken this
feedback without a reviewed interaction-specific reason.

Keep a section's heading and source description on the panel content edge. Put the
section's interactive content in a deliberate, balanced 8 px horizontal inset; checkbox
padding must not create that indentation accidentally. Full-width spatial controls such
as the acquisition calendar are explicit exceptions when an inset would reduce clarity
or usable width.

Use checkboxes for independent boolean options throughout the application, including
layer visibility, rendering options, corrective processing, and developer controls. Do
not mix switches and checkboxes when they represent the same kind of choice.

## Use consistent metric iconography

- Use the horizontal double arrow (`SwapHoriz`) for route distance everywhere. Do not
  substitute a ruler or a one-way arrow in charts, tooltips, summaries, or list rows.
- Use a neutral terrain icon for elevation. Elevation icons do not inherit grade-band
  colors.
- Use northeast and southeast arrows for ascent and descent.
- Use a triangle for grade, rotating it downward for a negative grade. Pair the icon
  directly with the signed percentage; omit redundant `Grade` and `Average` labels in
  compact metric rows.
- Keep the same metric-to-icon mapping across panels. A compact row may wrap as complete
  icon-value pairs, but an icon must never become separated from its value.

## Use a 4 px spacing grid

Prefer MUI `Stack` spacing and theme units over unrelated one-off margins. Use half
steps of the theme's 8 px unit when 4 px precision is necessary.

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
- Dense spatial grids such as the acquisition calendar may use a tighter internal gap,
  but their surrounding section spacing still follows the 4 px grid.

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

## Capture map-layer preset previews reproducibly

Layer preset previews are committed presentation assets under
`src/presentation/map/layer-previews/`. Keep every preview on one identical map viewport
so the images compare layer content rather than different geography.

1. Start the application from the owning worktree:
   `./node_modules/.bin/vite --port 5173 --strictPort`.
2. Open `http://127.0.0.1:5173/?map=2&lat=43.043&lon=42.720&z=12&view=2d` in Chromium
   with a 1440×1000 CSS-pixel viewport and device scale factor 2. This fixed Mestia view
   centers the river confluence and the mountain contours that separate its valleys.
3. Apply the required layer combination through the running application's Layers
   controls. Wait until the visible raster and vector sources have finished loading; for
   Sentinel, wait until scene application and 100% full-coverage rendering have
   completed.
4. Capture the center 96×96 CSS-pixel map square as PNG. At the fixed viewport, the
   browser screenshot clip is `{ x: 672, y: 452, width: 96, height: 96 }`; more
   generally, center it with `x = (viewportWidth - 96) / 2` and
   `y = (viewportHeight - 96) / 2`. Resolve the output path inside
   `src/presentation/map/layer-previews/`. Device scale factor 2 produces the required
   192×192 asset without upscaling.
5. Stop Vite after the capture run.

Use these current combinations:

| Asset                             | Google | NAPR | Sentinel | OpenStreetMap opacity |
| --------------------------------- | ------ | ---- | -------- | --------------------- |
| `vector-osm.png`                  | Off    | Off  | Hidden   | 100%                  |
| `google-satellite-hybrid.png`     | On     | Off  | Off      | 100%                  |
| `google-satellite.png`            | On     | Off  | Off      | 0%                    |
| `napr-orthophoto-2025-hybrid.png` | Off    | On   | Off      | 100%                  |
| `napr-orthophoto-2025.png`        | Off    | On   | Off      | 0%                    |
| `sentinel-2-hybrid.png`           | Off    | Off  | On       | 100%                  |

For a new preset, use the same URL, viewport, device scale, center crop, output format,
and loading checks. Add only the layer-state combination and filename needed by that
preset. If a previously used Sentinel scene is unavailable, run the existing Satellite
search and apply the first enabled result in the application's newest-first order; use
that one scene throughout the capture run.

Verify each committed file is a 192×192 RGB PNG and inspect it at native resolution. The
square must contain map pixels only: no controls, sidebar, search field, attribution,
blank or unloaded tile strip, border, or baked-in rounded corners. Rounded corners
remain CSS presentation so the source image retains all pixels. Do not resize a
lower-resolution screenshot or fabricate missing imagery. Runtime provider attribution
remains authoritative; the preview is decorative and always appears beside its text
label.

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
