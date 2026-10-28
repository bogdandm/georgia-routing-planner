import { Box, Tooltip } from '@mui/material';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useState } from 'react';

import { KeycapHint } from '@/presentation/KeyboardShortcutKeys';
import {
  keyboardShortcutKeys,
  type KeyboardShortcut,
} from '@/presentation/keyboardShortcuts';

/** MapLibre's own buttons and their keys; the zoom keys are MapLibre's, not app shortcuts. */
const controls: readonly (
  | { readonly selector: string; readonly keys: readonly string[] }
  | { readonly selector: string; readonly shortcut: KeyboardShortcut }
)[] = [
  { selector: '.maplibregl-ctrl-zoom-in', keys: ['+'] },
  { selector: '.maplibregl-ctrl-zoom-out', keys: ['−'] },
  { selector: '.maplibregl-ctrl-compass', shortcut: { action: 'north-up' } },
  { selector: '.maplibregl-ctrl-geolocate', shortcut: { action: 'geolocate' } },
];
const controlSelector = controls.map(({ selector }) => selector).join(', ');

function controlButton(target: EventTarget | null): HTMLButtonElement | null {
  return target instanceof Element
    ? target.closest<HTMLButtonElement>(controlSelector)
    : null;
}

/**
 * Replaces the native `title` tooltips of MapLibre's zoom, compass, and geolocation buttons
 * with the app's tooltip, which adds the button's keys. The label stays MapLibre's localized
 * `aria-label`. The title is removed on hover because MapLibre writes it again whenever a
 * button's state changes. Touch pointers get no tooltip, like the app's own buttons.
 */
export function MapLibreControlTooltip({ map }: { readonly map: MapLibreMap | null }) {
  const [button, setButton] = useState<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (map === null) return;
    const container = map.getContainer();
    const show = (target: HTMLButtonElement) => {
      target.removeAttribute('title');
      setButton(target);
    };
    const handlePointerOver = (event: PointerEvent) => {
      const target = controlButton(event.target);
      if (target !== null && event.pointerType === 'mouse') show(target);
    };
    const handleFocusIn = (event: FocusEvent) => {
      const target = controlButton(event.target);
      if (target?.matches(':focus-visible')) show(target);
    };
    const handleLeave = (event: PointerEvent | FocusEvent) => {
      const target = controlButton(event.target);
      if (target === null || controlButton(event.relatedTarget) === target) return;
      setButton((current) => (current === target ? null : current));
    };
    container.addEventListener('pointerover', handlePointerOver);
    container.addEventListener('pointerout', handleLeave);
    container.addEventListener('focusin', handleFocusIn);
    container.addEventListener('focusout', handleLeave);
    return () => {
      container.removeEventListener('pointerover', handlePointerOver);
      container.removeEventListener('pointerout', handleLeave);
      container.removeEventListener('focusin', handleFocusIn);
      container.removeEventListener('focusout', handleLeave);
      setButton(null);
    };
  }, [map]);

  const control =
    button === null
      ? undefined
      : controls.find(({ selector }) => button.matches(selector));
  return (
    <Tooltip
      open={button?.isConnected === true && control !== undefined}
      disableInteractive
      title={
        button === null || control === undefined ? (
          ''
        ) : (
          <>
            {button.getAttribute('aria-label')}
            <KeycapHint
              keys={
                'shortcut' in control
                  ? keyboardShortcutKeys(control.shortcut)
                  : control.keys
              }
            />
          </>
        )
      }
      slotProps={{ popper: { anchorEl: button } }}
    >
      <Box component="span" hidden />
    </Tooltip>
  );
}
