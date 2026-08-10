import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RoutePlanControls } from '@/presentation/tracks/RoutePlanControls';
import {
  beginRoutePlanPoint,
  beginRoutePlanElevation,
  completeRoutePlanPoint,
  setNextSegmentMode,
  startRoutePlan,
} from '@/presentation/tracks/routePlan';
const A = [44.64, 42.66] as const;
const B = [44.65, 42.67] as const;

function callbacks() {
  return {
    onClear: vi.fn(),
    onDiscard: vi.fn(),
    onNameChange: vi.fn(),
    onNextSegmentModeChange: vi.fn(),
    onSave: vi.fn(),
    onUndo: vi.fn(),
  };
}

describe('RoutePlanControls', () => {
  it('keeps the next-segment mode persistent and enables save for a usable line', async () => {
    const user = userEvent.setup();
    const withStart = beginRoutePlanPoint(
      startRoutePlan('route-plan:controls'),
      A,
    ).draft;
    const draft = beginRoutePlanPoint(setNextSegmentMode(withStart, 'line'), B).draft;
    const handlers = callbacks();
    render(<RoutePlanControls draft={draft} {...handlers} />);

    expect(screen.getByRole('button', { name: 'Line' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Routes' }));
    expect(handlers.onNextSegmentModeChange).toHaveBeenCalledWith('routes');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(handlers.onSave).toHaveBeenCalledOnce();
  });

  it('keeps save available while optional elevation is pending', () => {
    const withStart = beginRoutePlanPoint(
      startRoutePlan('route-plan:elevation-pending'),
      A,
    ).draft;
    const ready = beginRoutePlanPoint(setNextSegmentMode(withStart, 'line'), B).draft;
    render(
      <RoutePlanControls draft={beginRoutePlanElevation(ready)} {...callbacks()} />,
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('disables conflicting mode and save controls while routing', () => {
    const withStart = beginRoutePlanPoint(
      startRoutePlan('route-plan:pending'),
      A,
    ).draft;
    const calculating = beginRoutePlanPoint(withStart, B).draft;
    render(<RoutePlanControls draft={calculating} {...callbacks()} />);

    expect(screen.getByText('Calculating route…')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Routes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Line' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('locks all route controls while an atomic save is pending', () => {
    const withStart = beginRoutePlanPoint(startRoutePlan('route-plan:saving'), A).draft;
    const ready = beginRoutePlanPoint(setNextSegmentMode(withStart, 'line'), B).draft;
    render(
      <RoutePlanControls draft={{ ...ready, status: 'saving' }} {...callbacks()} />,
    );

    expect(screen.getByText('Saving route…')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Track name' })).toBeDisabled();
    for (const name of ['Routes', 'Line', 'Undo', 'Clear', 'Discard', 'Save']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it.each([
    [
      { reason: 'no-nearby-trail', endpoint: 'start' } as const,
      'No routable trail or road was found within 200 m of the start point.',
    ],
    [
      { reason: 'no-nearby-trail', endpoint: 'both' } as const,
      'No routable trail or road was found within 200 m of the start and destination points.',
    ],
    [
      { reason: 'no-route' } as const,
      'No connected route was found. Add a closer point or use Line for the next segment.',
    ],
    [
      { reason: 'area-too-large' } as const,
      'This segment covers too large an area. Add an intermediate point.',
    ],
    [
      { reason: 'routing-data-unavailable' } as const,
      'Routing data is unavailable. Try again when you are online.',
    ],
    [{ reason: 'routing-data-invalid' } as const, 'Routing data could not be decoded.'],
  ])('shows actionable copy for $reason', (failure, message) => {
    const withStart = beginRoutePlanPoint(
      startRoutePlan('route-plan:failure'),
      A,
    ).draft;
    const transition = beginRoutePlanPoint(withStart, B);
    if (transition.request === null) throw new Error('Expected a route request.');
    const failed = completeRoutePlanPoint(transition.draft, transition.request, {
      status: 'failed',
      ...failure,
    });

    render(<RoutePlanControls draft={failed} {...callbacks()} />);

    expect(screen.getByText(message)).toBeVisible();
  });
});
