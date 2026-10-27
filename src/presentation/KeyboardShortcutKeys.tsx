import { Box, useMediaQuery } from '@mui/material';

import {
  keyboardShortcutKeys,
  type KeyboardShortcut,
} from '@/presentation/keyboardShortcuts';

/** Devices whose primary pointer is coarse usually have no keyboard, so they show no keys. */
export const touchFirstQuery = '(pointer: coarse)';

/** One key; its border uses currentColor to read on light and dark surfaces alike. */
export function Keycap({ label }: { readonly label: string }) {
  return (
    <Box
      component="kbd"
      sx={{
        border: '1px solid currentColor',
        borderRadius: 0.5,
        fontFamily: 'inherit',
        fontSize: 11,
        lineHeight: '16px',
        minWidth: 18,
        opacity: 0.85,
        px: 0.5,
        textAlign: 'center',
      }}
    >
      {label}
    </Box>
  );
}

/**
 * Keycaps for a shortcut. Hidden from assistive technology so tooltip and menu accessible
 * names stay unchanged. Touch-first devices show none.
 */
export function KeyboardShortcutKeys({
  shortcut,
}: {
  readonly shortcut: KeyboardShortcut;
}) {
  const touchFirst = useMediaQuery(touchFirstQuery);
  if (touchFirst) return null;
  return (
    <Box
      component="span"
      aria-hidden
      sx={{ display: 'inline-flex', gap: 0.5, ml: 1, verticalAlign: 'middle' }}
    >
      {keyboardShortcutKeys(shortcut).map((key) => (
        <Keycap key={key} label={key} />
      ))}
    </Box>
  );
}

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
