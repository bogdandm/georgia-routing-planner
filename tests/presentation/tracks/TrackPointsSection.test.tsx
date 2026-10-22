import { ThemeProvider } from '@mui/material';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activateAppLocale } from '@/presentation/localization/appI18n';
import {
  TrackPointsSection,
  type TrackPointsAnchorView,
  type TrackPointsLegView,
  type TrackPointsSectionProps,
} from '@/presentation/tracks/TrackPointsSection';
import { createAppTheme } from '@/presentation/theme/createAppTheme';
import { renderWithI18n } from '@test/helpers/renderWithI18n';

const routedLeg: TrackPointsLegView = { kind: 'leg', mode: 'routes', pending: false };

function anchorsOf(count: number): TrackPointsAnchorView[] {
  return Array.from({ length: count }, (_, index) => ({
    key: index + 100,
    distanceMeters: index * 250,
    elevationMeters: index === 1 ? null : 500 + index,
  }));
}

function legsOf(count: number): TrackPointsLegView[] {
  return Array.from({ length: Math.max(0, count - 1) }, () => routedLeg);
}

function createProps(
  overrides: Partial<TrackPointsSectionProps> = {},
): TrackPointsSectionProps {
  const anchors = overrides.anchors ?? anchorsOf(4);
  return {
    variant: 'track',
    editing: true,
    anchors,
    legs: legsOf(anchors.length),
    insertion: null,
    movingIndex: null,
    selection: null,
    revealRequest: null,
    disabled: false,
    onSelectionChange: vi.fn(),
    onDeleteSelection: vi.fn(),
    onMoveStart: vi.fn(),
    onMoveCancel: vi.fn(),
    onInsertionStart: vi.fn(),
    onInsertionModeChange: vi.fn(),
    onInsertionEnd: vi.fn(),
    onLegModeChange: vi.fn(),
    ...overrides,
  };
}

function sectionElement(props: TrackPointsSectionProps) {
  return (
    <ThemeProvider theme={createAppTheme()}>
      <TrackPointsSection {...props} />
    </ThemeProvider>
  );
}

function renderSection(overrides: Partial<TrackPointsSectionProps> = {}) {
  const props = createProps(overrides);
  const view = renderWithI18n(sectionElement(props));
  return {
    props,
    rerender: (next: Partial<TrackPointsSectionProps>) => {
      view.rerender(sectionElement({ ...props, ...next }));
    },
  };
}

function pointButton(number: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^Point ${number},`) });
}

beforeEach(() => {
  activateAppLocale('en');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TrackPointsSection', () => {
  it('starts collapsed behind an edit pencil and expands when editing begins', async () => {
    const onStartEditing = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderSection({ editing: false, onStartEditing });

    const disclosure = screen.getByRole('button', { name: 'Points' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('heading', { name: 'Points (4)' })).toBeInTheDocument();
    expect(
      screen.queryByRole('list', { name: 'Track points' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit points' }));
    expect(onStartEditing).toHaveBeenCalledOnce();

    rerender({ editing: true });
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('list', { name: 'Track points' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit points' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the plan variant expanded without a pencil', () => {
    renderSection({ variant: 'plan', onStartEditing: vi.fn() });

    expect(screen.queryByRole('button', { name: 'Points' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit points' }),
    ).not.toBeInTheDocument();
    expect(pointButton('2')).toHaveTextContent('0.3 km');
    expect(pointButton('2')).toHaveTextContent('—');
    expect(pointButton('3')).toHaveTextContent('502 m');
  });

  it('selects a clicked point and extends the range with shift-click', async () => {
    const user = userEvent.setup();
    const { props } = renderSection({ editing: false });
    await user.click(screen.getByRole('button', { name: 'Points' }));

    await user.click(pointButton('2'));
    expect(props.onSelectionChange).toHaveBeenLastCalledWith({ first: 1, last: 1 });

    await user.keyboard('{Shift>}');
    await user.click(pointButton('4'));
    await user.keyboard('{/Shift}');
    expect(props.onSelectionChange).toHaveBeenLastCalledWith({ first: 1, last: 3 });
    expect(props.onSelectionChange).toHaveBeenCalledTimes(2);
  });

  it('selects with Enter and extends with Shift+Enter, and Escape clears', async () => {
    const user = userEvent.setup();
    const { props } = renderSection({ selection: { first: 0, last: 0 } });

    pointButton('3').focus();
    await user.keyboard('{Enter}');
    expect(props.onSelectionChange).toHaveBeenLastCalledWith({ first: 2, last: 2 });

    pointButton('1').focus();
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(props.onSelectionChange).toHaveBeenLastCalledWith({ first: 0, last: 2 });

    await user.keyboard('{Escape}');
    expect(props.onSelectionChange).toHaveBeenLastCalledWith(null);
  });

  it('drag-selects the range under the pointer', () => {
    const { props } = renderSection();
    const list = screen.getByRole('list', { name: 'Track points' });
    const viewport = list.parentElement;
    if (viewport === null) throw new Error('Missing points viewport');
    const target = pointButton('3');
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => target,
    });

    fireEvent.pointerDown(pointButton('1'), {
      pointerId: 3,
      pointerType: 'mouse',
      button: 0,
    });
    expect(props.onSelectionChange).toHaveBeenLastCalledWith({ first: 0, last: 0 });
    fireEvent.pointerMove(viewport, { pointerId: 3, pointerType: 'mouse' });
    expect(props.onSelectionChange).toHaveBeenLastCalledWith({ first: 0, last: 2 });
    fireEvent.pointerUp(viewport, { pointerId: 3, pointerType: 'mouse' });
    fireEvent.pointerMove(viewport, { pointerId: 3, pointerType: 'mouse' });
    expect(props.onSelectionChange).toHaveBeenCalledTimes(2);

    Reflect.deleteProperty(document, 'elementFromPoint');
  });

  it('deletes the selected range only while editing', async () => {
    const user = userEvent.setup();
    const selection = { first: 1, last: 2 };
    const { props, rerender } = renderSection({ editing: false, selection });
    await user.click(screen.getByRole('button', { name: 'Points' }));

    expect(screen.getByText('2 points selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    pointButton('2').focus();
    await user.keyboard('{Delete}');
    expect(props.onDeleteSelection).not.toHaveBeenCalled();

    rerender({ editing: true });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(props.onDeleteSelection).toHaveBeenLastCalledWith(selection);

    pointButton('2').focus();
    await user.keyboard('{Backspace}');
    expect(props.onDeleteSelection).toHaveBeenCalledTimes(2);

    rerender({ editing: true, disabled: true });
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    pointButton('2').focus();
    await user.keyboard('{Delete}');
    expect(props.onDeleteSelection).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(props.onSelectionChange).toHaveBeenLastCalledWith(null);
  });

  it('starts moving and deletes single points from the row actions', async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderSection();

    await user.click(screen.getByRole('button', { name: 'Move point 2' }));
    expect(props.onMoveStart).toHaveBeenCalledWith(1);
    await user.click(screen.getByRole('button', { name: 'Delete point 3' }));
    expect(props.onDeleteSelection).toHaveBeenCalledWith({ first: 2, last: 2 });
    expect(props.onSelectionChange).not.toHaveBeenCalled();

    rerender({ movingIndex: 1 });
    expect(screen.getByText('Click the map to move point 2')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Move point 2' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onMoveCancel).toHaveBeenCalledOnce();
  });

  it('hides edit actions while not editing', async () => {
    const user = userEvent.setup();
    renderSection({ editing: false });
    await user.click(screen.getByRole('button', { name: 'Points' }));

    expect(pointButton('1')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Move point 1' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('group', { name: /^Segment between/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Add points/ }),
    ).not.toBeInTheDocument();
  });

  it('changes leg modes and starts insertions between, before and after points', async () => {
    const user = userEvent.setup();
    const legs: TrackPointsLegView[] = [routedLeg, { kind: 'gap' }, routedLeg];
    const { props } = renderSection({ legs });

    const firstLeg = screen.getByRole('group', {
      name: 'Segment between points 1 and 2',
    });
    await user.click(within(firstLeg).getByRole('button', { name: 'Line' }));
    expect(props.onLegModeChange).toHaveBeenCalledWith(0, 'line');

    expect(screen.getByText('Separate segment')).toBeInTheDocument();
    expect(
      screen.queryByRole('group', { name: 'Segment between points 2 and 3' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add points between points 2 and 3' }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Add points between points 3 and 4' }),
    );
    expect(props.onInsertionStart).toHaveBeenLastCalledWith(2);
    await user.click(screen.getByRole('button', { name: 'Add points before point 1' }));
    expect(props.onInsertionStart).toHaveBeenLastCalledWith(-1);
    await user.click(screen.getByRole('button', { name: 'Add points after point 4' }));
    expect(props.onInsertionStart).toHaveBeenLastCalledWith(3);
  });

  it('offers one add stub for an empty plan', async () => {
    const user = userEvent.setup();
    const { props } = renderSection({ variant: 'plan', anchors: [], legs: [] });

    expect(screen.getByRole('heading', { name: 'Points (0)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add points' }));
    expect(props.onInsertionStart).toHaveBeenCalledWith(-1);
  });

  it('hides Done only for the plan append insertion', async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderSection({
      variant: 'plan',
      insertion: { afterIndex: 3, mode: 'routes' },
    });

    expect(screen.getByText('Click the map to add points')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add points after point 4' }),
    ).not.toBeInTheDocument();
    const mode = screen.getByRole('group', { name: 'New points mode' });
    await user.click(within(mode).getByRole('button', { name: 'Line' }));
    expect(props.onInsertionModeChange).toHaveBeenCalledWith('line');

    rerender({ variant: 'plan', insertion: { afterIndex: 0, mode: 'line' } });
    expect(
      screen.queryByRole('group', { name: 'Segment between points 1 and 2' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(props.onInsertionEnd).toHaveBeenCalledOnce();

    rerender({ variant: 'track', insertion: { afterIndex: 3, mode: 'routes' } });
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('windows long lists and reveals a far point on request', () => {
    const anchors = anchorsOf(10_000);
    const { rerender } = renderSection({
      variant: 'plan',
      anchors,
      legs: legsOf(10_000),
    });

    const list = screen.getByRole('list', { name: 'Track points' });
    expect(within(list).getAllByRole('listitem').length).toBeLessThan(60);
    expect(pointButton('1')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Point 9,001,/ }),
    ).not.toBeInTheDocument();

    rerender({ revealRequest: { index: 9_000 } });
    expect(pointButton('9,001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Point 1,/ })).not.toBeInTheDocument();
    expect(within(list).getAllByRole('listitem').length).toBeLessThan(60);
  });

  it('expands a collapsed track list to reveal a requested point', () => {
    const { rerender } = renderSection({ editing: false });

    rerender({ editing: false, revealRequest: { index: 2 } });
    expect(screen.getByRole('button', { name: 'Points' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(pointButton('3')).toBeInTheDocument();
  });
});
