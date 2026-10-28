import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  keyboardShortcutKeys,
  matchKeyboardShortcut,
} from '@/presentation/keyboardShortcuts';

const macUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)';

function matchOn(target: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, ...init });
  target.dispatchEvent(event);
  return matchKeyboardShortcut(event);
}

/** Mounts the fixture and returns its `data-target` element as the event target. */
function mountTarget(html: string): Element {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.append(container);
  const target = container.querySelector('[data-target]');
  if (target === null) throw new Error('The fixture has no data-target element.');
  return target;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('keyboard shortcut matching', () => {
  it('uses Ctrl as the command modifier outside macOS', () => {
    const body = document.body;

    expect(matchOn(body, { code: 'KeyF', key: 'f', ctrlKey: true })).toEqual({
      action: 'focus-search',
    });
    expect(matchOn(body, { code: 'KeyF', key: 'f', metaKey: true })).toBeNull();
    expect(keyboardShortcutKeys({ action: 'save' })).toEqual(['Ctrl', 'S']);
  });

  it('uses Cmd as the command modifier on macOS and leaves Ctrl to text editing', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(macUserAgent);
    const body = document.body;

    expect(matchOn(body, { code: 'KeyF', key: 'f', metaKey: true })).toEqual({
      action: 'focus-search',
    });
    expect(matchOn(body, { code: 'KeyF', key: 'f', ctrlKey: true })).toBeNull();
    expect(keyboardShortcutKeys({ action: 'save' })).toEqual(['⌘', 'S']);
    expect(keyboardShortcutKeys({ action: 'previous-basemap' })).toEqual(['⇧', '0']);
  });

  it('matches the physical key regardless of the keyboard layout', () => {
    expect(matchOn(document.body, { code: 'KeyN', key: 'т' })).toEqual({
      action: 'north-up',
    });
  });

  it('copies the map link with Ctrl+C unless page text is selected', () => {
    expect(matchOn(document.body, { code: 'KeyC', key: 'c', ctrlKey: true })).toEqual({
      action: 'copy-map-link',
    });

    const paragraph = mountTarget('<p data-target>Selected text</p>');
    window.getSelection()?.selectAllChildren(paragraph);
    expect(matchOn(paragraph, { code: 'KeyC', key: 'c', ctrlKey: true })).toBeNull();
    window.getSelection()?.removeAllRanges();
  });

  it('ignores plain keys in text fields but keeps command shortcuts there', () => {
    const input = mountTarget('<input data-target />');

    expect(matchOn(input, { code: 'KeyN', key: 'n' })).toBeNull();
    expect(matchOn(input, { code: 'KeyS', key: 's', ctrlKey: true })).toEqual({
      action: 'save',
    });
    expect(matchOn(input, { code: 'KeyZ', key: 'z', ctrlKey: true })).toBeNull();
  });

  it('ignores every shortcut inside a modal dialog but still blocks Save page', () => {
    const button = mountTarget(
      '<div aria-modal="true"><button data-target></button></div>',
    );
    const save = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'KeyS',
      ctrlKey: true,
      key: 's',
    });
    button.dispatchEvent(save);

    expect(matchOn(button, { code: 'KeyN', key: 'n' })).toBeNull();
    expect(matchKeyboardShortcut(save)).toBeNull();
    expect(save.defaultPrevented).toBe(true);
  });

  it('keeps menu typeahead unless the menu opts into shortcuts', () => {
    const plainMenuItem = mountTarget(
      '<div role="menu"><li role="menuitem" data-target></li></div>',
    );
    const shortcutMenuItem = mountTarget(
      '<div role="menu" data-keyboard-shortcuts=""><li role="menuitem" data-target></li></div>',
    );

    expect(matchOn(plainMenuItem, { code: 'Digit3', key: '3' })).toBeNull();
    expect(matchOn(shortcutMenuItem, { code: 'Digit3', key: '3' })).toEqual({
      action: 'select-basemap',
      preset: 'bing-satellite',
    });
  });

  it('ignores auto-repeated keys except camera steps, which keep moving while held', () => {
    expect(matchOn(document.body, { code: 'KeyN', key: 'n', repeat: true })).toBeNull();
    expect(
      matchOn(document.body, { code: 'KeyS', key: 's', ctrlKey: true, repeat: true }),
    ).toBeNull();
    expect(
      matchOn(document.body, { code: 'ArrowLeft', key: 'ArrowLeft', repeat: true }),
    ).toEqual({ action: 'move-camera', step: 'pan-left' });
  });

  it('moves the camera with arrows, Shift+arrows, and plus or minus from any button', () => {
    const button = mountTarget('<button data-target></button>');

    expect(matchOn(button, { code: 'ArrowUp', key: 'ArrowUp' })).toEqual({
      action: 'move-camera',
      step: 'pan-up',
    });
    expect(
      matchOn(button, { code: 'ArrowRight', key: 'ArrowRight', shiftKey: true }),
    ).toEqual({ action: 'move-camera', step: 'rotate-right' });
    expect(
      matchOn(button, { code: 'ArrowDown', key: 'ArrowDown', shiftKey: true }),
    ).toEqual({ action: 'move-camera', step: 'pitch-down' });
    // `+` is Shift+= on a US keyboard and zooms like `=`.
    expect(matchOn(button, { code: 'Equal', key: '+', shiftKey: true })).toEqual({
      action: 'move-camera',
      step: 'zoom-in',
    });
    expect(matchOn(button, { code: 'NumpadSubtract', key: '-' })).toEqual({
      action: 'move-camera',
      step: 'zoom-out',
    });
    expect(
      matchOn(button, { code: 'ArrowLeft', key: 'ArrowLeft', ctrlKey: true }),
    ).toBeNull();
  });

  it('leaves arrows to text fields and to controls that handle them', () => {
    const input = mountTarget('<input data-target />');
    const tab = mountTarget('<button role="tab" data-target></button>');
    tab.addEventListener('keydown', (event) => {
      event.preventDefault();
    });

    expect(matchOn(input, { code: 'ArrowLeft', key: 'ArrowLeft' })).toBeNull();
    expect(
      matchOn(tab, { code: 'ArrowLeft', key: 'ArrowLeft', cancelable: true }),
    ).toBeNull();
  });

  it('cycles basemaps forward with 0 and backward with Shift+0', () => {
    expect(matchOn(document.body, { code: 'Digit0', key: '0' })).toEqual({
      action: 'next-basemap',
    });
    expect(
      matchOn(document.body, { code: 'Digit0', key: ')', shiftKey: true }),
    ).toEqual({
      action: 'previous-basemap',
    });
    expect(
      matchOn(document.body, { code: 'KeyN', key: 'N', shiftKey: true }),
    ).toBeNull();
  });
});
