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

interface ActiveControl {
  readonly button: HTMLButtonElement;
  readonly label: string;
}

/**
 * Replaces the native `title` tooltips of MapLibre's zoom, compass, and geolocation buttons
 * with the app's tooltip, which adds the button's keys. The label is MapLibre's localized
 * `aria-label`. MapLibre rewrites `title` and `aria-label` whenever a button's state or the
 * language changes, so an observer strips every new title and refreshes the shown label.
 * Touch pointers get no tooltip, like the app's own buttons.
 */
export function MapLibreControlTooltip({ map }: { readonly map: MapLibreMap | null }) {
  const [active, setActive] = useState<ActiveControl | null>(null);

  useEffect(() => {
    if (map === null) return;
    // MapLibre creates this container with the map; controls are added into it later.
    const container = map
      .getContainer()
      .querySelector<HTMLElement>('.maplibregl-control-container');
    if (container === null) return;
    const stripTitles = () => {
      for (const button of container.querySelectorAll(
        `:is(${controlSelector})[title]`,
      )) {
        button.removeAttribute('title');
      }
    };
    stripTitles();
    const observer = new MutationObserver((records) => {
      stripTitles();
      for (const { target } of records) {
        const button = controlButton(target);
        if (button === null) continue;
        const label = button.getAttribute('aria-label') ?? '';
        setActive((current) =>
          current?.button === button && current.label !== label
            ? { button, label }
            : current,
        );
      }
    });
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title', 'aria-label'],
    });
    const show = (button: HTMLButtonElement) => {
      setActive({ button, label: button.getAttribute('aria-label') ?? '' });
    };
    const handlePointerOver = (event: PointerEvent) => {
      const button = controlButton(event.target);
      if (button !== null && event.pointerType === 'mouse') show(button);
    };
    const handleFocusIn = (event: FocusEvent) => {
      const button = controlButton(event.target);
      if (button?.matches(':focus-visible')) show(button);
    };
    const handleLeave = (event: PointerEvent | FocusEvent) => {
      const button = controlButton(event.target);
      if (button === null || controlButton(event.relatedTarget) === button) return;
      setActive((current) => (current?.button === button ? null : current));
    };
    container.addEventListener('pointerover', handlePointerOver);
    container.addEventListener('pointerout', handleLeave);
    container.addEventListener('focusin', handleFocusIn);
    container.addEventListener('focusout', handleLeave);
    return () => {
      observer.disconnect();
      container.removeEventListener('pointerover', handlePointerOver);
      container.removeEventListener('pointerout', handleLeave);
      container.removeEventListener('focusin', handleFocusIn);
      container.removeEventListener('focusout', handleLeave);
      setActive(null);
    };
  }, [map]);

  const control =
    active === null
      ? undefined
      : controls.find(({ selector }) => active.button.matches(selector));
  return (
    <Tooltip
      open={active?.button.isConnected === true && control !== undefined}
      disableInteractive
      // Matches the app's own controls in the same column.
      placement="left"
      title={
        active === null || control === undefined ? (
          ''
        ) : (
          <>
            {active.label}
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
      slotProps={{ popper: { anchorEl: active?.button } }}
    >
      <Box component="span" hidden />
    </Tooltip>
  );
}
