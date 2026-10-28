import type { SvgIconComponent } from '@mui/icons-material';
import KeyboardCommandKeyIcon from '@mui/icons-material/KeyboardCommandKey';
import KeyboardControlKeyIcon from '@mui/icons-material/KeyboardControlKey';
import { Box, useMediaQuery } from '@mui/material';
import { createSvgIcon } from '@mui/material/utils';

import {
  keyboardShortcutKeys,
  type KeyboardShortcut,
} from '@/presentation/keyboardShortcuts';

/** Devices whose primary pointer is coarse usually have no keyboard, so they show no keys. */
export const touchFirstQuery = '(pointer: coarse)';

// Material Symbols "shift" outline (Apache-2.0), the family of the other modifier icons.
const ShiftKeyIcon = createSvgIcon(
  <path d="M8 21v-8H3l9-11l9 11h-5v8zm2-2h4v-8h2.775L12 5.15L7.225 11H10zm2-8" />,
  'ShiftKey',
);

/**
 * The macOS modifier symbols, drawn as icons: text fonts render ⌘, ⌃, and ⇧ at uneven
 * sizes, or not at all. The names are the keys' own English names.
 */
const macModifierIcons: Readonly<
  Partial<Record<string, { readonly icon: SvgIconComponent; readonly name: string }>>
> = {
  '⌘': { icon: KeyboardCommandKeyIcon, name: 'Command' },
  '⌃': { icon: KeyboardControlKeyIcon, name: 'Control' },
  '⇧': { icon: ShiftKeyIcon, name: 'Shift' },
};

/** One key; its border uses currentColor to read on light and dark surfaces alike. */
export function Keycap({ label }: { readonly label: string }) {
  const modifier = macModifierIcons[label];
  return (
    <Box
      component="kbd"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid currentColor',
        borderRadius: 0.5,
        boxSizing: 'border-box',
        fontFamily: 'inherit',
        fontSize: 11,
        height: 18,
        lineHeight: '16px',
        minWidth: 18,
        opacity: 0.85,
        px: 0.5,
      }}
    >
      {modifier === undefined ? (
        label
      ) : (
        <modifier.icon titleAccess={modifier.name} sx={{ fontSize: 12 }} />
      )}
    </Box>
  );
}

/**
 * Keycaps beside a label. Hidden from assistive technology so tooltip and menu accessible
 * names stay unchanged. Touch-first devices show none.
 */
export function KeycapHint({ keys }: { readonly keys: readonly string[] }) {
  const touchFirst = useMediaQuery(touchFirstQuery);
  if (touchFirst) return null;
  return (
    <Box
      component="span"
      aria-hidden
      sx={{ display: 'inline-flex', gap: 0.5, ml: 1, verticalAlign: 'middle' }}
    >
      {keys.map((key) => (
        <Keycap key={key} label={key} />
      ))}
    </Box>
  );
}

/** Keycaps of a registered application shortcut. */
export function KeyboardShortcutKeys({
  shortcut,
}: {
  readonly shortcut: KeyboardShortcut;
}) {
  return <KeycapHint keys={keyboardShortcutKeys(shortcut)} />;
}

/**
 * Tooltip title with a shortcut. An element title makes MUI's open tooltip label its child
 * through `aria-labelledby`, replacing the control's own name, so pass `describeChild` to
 * the Tooltip: the title then describes the control instead.
 */
export function ShortcutTooltipTitle({
  label,
  shortcut,
}: {
  readonly label: string;
  readonly shortcut: KeyboardShortcut;
}) {
  return (
    <>
      {label}
      <KeyboardShortcutKeys shortcut={shortcut} />
    </>
  );
}
