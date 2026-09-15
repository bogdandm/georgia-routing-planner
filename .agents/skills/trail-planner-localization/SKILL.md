---
name: trail-planner-localization
description:
  Localize one Trail Planner feature and its paired Lingui PO catalog without crossing
  feature boundaries.
---

# Trail Planner localization

Use this skill for one feature catalog at a time: `shell`, `map`, `tracks`, `satellite`,
`markers`, `layers`, or `user`.

## Establish the boundary

1. Inspect the complete pull-request diff and the applicable feature sources before
   editing.
2. Classify every string as one of:
   - app-authored visible UI, accessibility copy, tooltip, notice, or presentation
     error: localize it;
   - intentionally invariant brand or technical label: preserve it and use the narrow
     reviewed equality allowlist only when source and target must be identical;
   - user, imported, provider, identifier, URL, or machine/share/export data: preserve
     it as data;
   - deterministic normalization or protocol value: keep its existing locale-independent
     behavior.
3. Keep changes inside the feature production subtree, its matching tests, and
   `src/locales/{en,ru}/<feature>.po`. Stop if another feature or shared localization
   infrastructure must change.
4. Before changing an exported error, message, or formatter signature, run LSP
   references and migrate every caller in the same pull request.

## Wrap source messages

- Use `<Trans>` from `@lingui/react/macro` for JSX content.
- Use `t` from `@lingui/core/macro`, or the macro form of `useLingui`, for string props
  and imperative DOM text.
- Use `msg` from `@lingui/core/macro` for stable state and message descriptors.
- Use ICU plural/select messages with named arguments. Never concatenate translated
  fragments or create singular/plural strings in application code.
- Use generated Lingui IDs for ordinary source messages. Use a feature-prefixed semantic
  ID only for stable error-code maps or imperative non-JSX callers. Add `context` when
  identical English requires feature-specific Russian wording.
- Map unknown external errors to a localized generic feature failure; retain raw details
  only in existing diagnostics.

Run the exact feature audit and fix every finding:

```bash
pnpm i18n:audit <changed-feature-paths>
```

Audit localized `.tsx` files and direct UI-string `.ts` files. Do not audit ID-heavy
controller, style, or protocol modules whose literals are not rendered.

## Extract and translate

1. Run one full extraction:

   ```bash
   pnpm i18n:extract
   ```

2. Verify that only `src/locales/en/<feature>.po` and `src/locales/ru/<feature>.po`
   changed. Stop on edits outside the one-feature boundary.
3. During Russian translation only, read `references/russian-style.md`.
4. Read and edit only `src/locales/ru/<feature>.po`, in bounded blank-line-aligned
   chunks. Never read or paste the complete locale tree.
5. Preserve every message ID, placeholder name, ICU construct, exact-number branch, and
   `select` branch. Russian plurals may add the required `few` and `many` CLDR branches.

## Verify and stop conditions

Run:

```bash
pnpm i18n:check --catalog <feature>
pnpm test <focused-feature-test-file>
```

Stop rather than hand off when any of these remain:

- an empty Russian translation;
- a Russian translation equal to English without a reviewed allowlist entry;
- placeholder, ICU construct, plural, or select drift;
- a source-literal audit finding;
- an edit outside the one-feature boundary;
- a failing focused test.
