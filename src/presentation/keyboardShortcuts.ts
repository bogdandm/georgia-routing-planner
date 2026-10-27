import { basemapPresets, type BasemapPreset } from '@/presentation/map/mapTypes';

export type KeyboardShortcutAction =
  | 'focus-search'
  | 'toggle-navigation'
  | 'new-track'
  | 'place-marker'
  | 'select-forecast-point'
  | 'search-satellite'
  | 'fit-track'
  | 'north-up'
  | 'toggle-terrain'
  | 'toggle-ruler'
  | 'geolocate'
  | 'show-sentinel-2'
  | 'toggle-osm-overlay'
  | 'next-basemap'
  | 'previous-basemap'
  | 'undo'
  | 'save'
  | 'import-track'
  | 'download-gpx'
  | 'copy-map-link';

export type KeyboardShortcut =
  | { readonly action: KeyboardShortcutAction }
  | { readonly action: 'select-basemap'; readonly preset: BasemapPreset };

/** `mod` is Cmd on macOS and Ctrl elsewhere; the other key of the pair must not be held. */
type ShortcutModifier = 'none' | 'shift' | 'mod';

interface ShortcutBinding {
  /** Physical key (`KeyboardEvent.code`), so bindings ignore the keyboard layout. */
  readonly code: string;
  readonly modifier: ShortcutModifier;
  /** Whether the binding also fires while focus is in a text field. */
  readonly inEditable: boolean;
  /** Keycap label for the key itself. */
  readonly key: string;
  readonly shortcut: KeyboardShortcut;
}

/* eslint-disable -- Key codes and keycap labels are machine tokens. */
function plain(
  code: string,
  key: string,
  action: KeyboardShortcutAction,
): ShortcutBinding {
  return { code, modifier: 'none', inEditable: false, key, shortcut: { action } };
}

function withMod(
  code: string,
  key: string,
  action: KeyboardShortcutAction,
  inEditable: boolean,
): ShortcutBinding {
  return { code, modifier: 'mod', inEditable, key, shortcut: { action } };
}

const bindings: readonly ShortcutBinding[] = [
  withMod('KeyF', 'F', 'focus-search', true),
  plain('Slash', '/', 'focus-search'),
  plain('BracketLeft', '[', 'toggle-navigation'),
  plain('KeyT', 'T', 'new-track'),
  plain('KeyP', 'P', 'place-marker'),
  plain('KeyW', 'W', 'select-forecast-point'),
  plain('KeyS', 'S', 'search-satellite'),
  plain('KeyM', 'M', 'fit-track'),
  plain('KeyN', 'N', 'north-up'),
  plain('KeyO', 'O', 'toggle-terrain'),
  plain('KeyR', 'R', 'toggle-ruler'),
  plain('KeyL', 'L', 'geolocate'),
  plain('Home', 'Home', 'geolocate'),
  ...basemapPresets.map((preset, index): ShortcutBinding => ({
    code: `Digit${index + 1}`,
    modifier: 'none',
    inEditable: false,
    key: String(index + 1),
    shortcut: { action: 'select-basemap', preset },
  })),
  plain('Digit7', '7', 'show-sentinel-2'),
  plain('Digit8', '8', 'toggle-osm-overlay'),
  plain('Digit0', '0', 'next-basemap'),
  {
    code: 'Digit0',
    modifier: 'shift',
    inEditable: false,
    key: '0',
    shortcut: { action: 'previous-basemap' },
  },
  withMod('KeyZ', 'Z', 'undo', false),
  withMod('KeyS', 'S', 'save', true),
  withMod('KeyO', 'O', 'import-track', true),
  withMod('KeyE', 'E', 'download-gpx', true),
  // Text fields and selected page text keep the native copy.
  withMod('KeyC', 'C', 'copy-map-link', false),
];

export function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.userAgent);
}

function eventModifier(event: KeyboardEvent): ShortcutModifier | null {
  if (event.altKey) return null;
  const mac = isMacPlatform();
  const mod = mac ? event.metaKey : event.ctrlKey;
  const otherMod = mac ? event.ctrlKey : event.metaKey;
  if (otherMod) return null;
  if (mod) return event.shiftKey ? null : 'mod';
  return event.shiftKey ? 'shift' : 'none';
}

/**
 * Resolves a global keydown to an application shortcut, or null when the key is not bound or
 * belongs to the focused control: a modal dialog, a text field (except bindings marked
 * `inEditable`), or a menu/listbox whose typeahead needs plain keys. A menu opts back in with
 * the `data-keyboard-shortcuts` attribute. Mod+C yields to the native copy while page text
 * is selected.
 *
 * Mod+S is reserved: where it is suppressed (a dialog, an auto-repeat, IME composition) this
 * still prevents its default, so the browser's Save page never opens.
 */
export function matchKeyboardShortcut(event: KeyboardEvent): KeyboardShortcut | null {
  if (event.defaultPrevented) return null;
  const modifier = eventModifier(event);
  if (modifier === null) return null;
  const binding = bindings.find(
    (candidate) => candidate.code === event.code && candidate.modifier === modifier,
  );
  if (binding === undefined) return null;

  const target = event.target instanceof Element ? event.target : null;
  if (event.repeat || event.isComposing || target?.closest('[aria-modal="true"]')) {
    if (binding.shortcut.action === 'save') event.preventDefault();
    return null;
  }
  if (
    !binding.inEditable &&
    target !== null &&
    ((target instanceof HTMLElement && target.isContentEditable) ||
      target.closest('input, textarea, select') !== null)
  ) {
    return null;
  }
  if (binding.modifier !== 'mod') {
    const menu = target?.closest('[role="menu"], [role="listbox"]');
    if (menu && !menu.hasAttribute('data-keyboard-shortcuts')) return null;
  }
  if (
    binding.shortcut.action === 'copy-map-link' &&
    window.getSelection()?.isCollapsed === false
  ) {
    return null;
  }
  return binding.shortcut;
}

/** Keycap labels for a shortcut's first binding, using macOS symbols on Apple platforms. */
export function keyboardShortcutKeys(shortcut: KeyboardShortcut): readonly string[] {
  const binding = bindings.find((candidate) =>
    shortcut.action === 'select-basemap'
      ? candidate.shortcut.action === 'select-basemap' &&
        candidate.shortcut.preset === shortcut.preset
      : candidate.shortcut.action === shortcut.action,
  );
  if (binding === undefined) return [];
  const mac = isMacPlatform();
  switch (binding.modifier) {
    case 'mod':
      return [mac ? '⌘' : 'Ctrl', binding.key];
    case 'shift':
      return [mac ? '⇧' : 'Shift', binding.key];
    case 'none':
      return [binding.key];
  }
}
/* eslint-enable */
