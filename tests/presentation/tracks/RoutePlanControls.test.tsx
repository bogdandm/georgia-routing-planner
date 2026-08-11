import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RoutePlanControls } from '@/presentation/tracks/RoutePlanControls';
import {
  beginRoutePlanElevation,
  completeRoutePlanPoint,
  enqueueRoutePlanPoint,
  setNextSegmentMode,
  startRoutePlan,
  updateRoutePlanProgress,
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

function lineDraft(id: string) {
  const withStart = enqueueRoutePlanPoint(startRoutePlan(id), A);
  return enqueueRoutePlanPoint(setNextSegmentMode(withStart, 'line'), B);
}

describe('RoutePlanControls', () => {
  it('keeps the next-segment mode persistent and enables save for a usable line', async () => {
    const user = userEvent.setup();
    const handlers = callbacks();
    render(
      <RoutePlanControls draft={lineDraft('route-plan:controls')} {...handlers} />,
    );

    expect(screen.getByRole('button', { name: 'Line' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Routes' }));
    expect(handlers.onNextSegmentModeChange).toHaveBeenCalledWith('routes');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(handlers.onSave).toHaveBeenCalledOnce();
  });

  it('uses the one fixed status slot for routing, elevation, and saving', () => {
    const withStart = enqueueRoutePlanPoint(startRoutePlan('route-plan:status'), A);
    const calculating = enqueueRoutePlanPoint(withStart, B);
    const status = render(
      <RoutePlanControls draft={calculating} {...callbacks()} />,
    ).getByRole('status');

    expect(status).toHaveStyle({ minHeight: '40px' });
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Line' })).toBeDisabled();

    render(
      <RoutePlanControls
        draft={beginRoutePlanElevation(lineDraft('route-plan:elevation'))}
        elevationProgress={{ completedTiles: 1, totalTiles: 2, points: [] }}
        {...callbacks()}
      />,
    );
    expect(screen.getByText('Loading elevation tiles: 1 of 2')).toBeVisible();
  });

  it('shows determinate progress while building the route graph', () => {
    const calculating = enqueueRoutePlanPoint(
      enqueueRoutePlanPoint(startRoutePlan('route-plan:graph-progress'), A),
      B,
    );
    const request = calculating.pendingRequest;
    if (request === null) throw new Error('Expected route request.');
    const buildingGraph = updateRoutePlanProgress(calculating, request.generation, {
      phase: 'building-graph',
      attempt: 1,
      loadedTileCount: 4,
      totalTileCount: 4,
      graphProgress: 0.6,
    });

    render(<RoutePlanControls draft={buildingGraph} {...callbacks()} />);

    expect(screen.getByText('Building route graph… 60%')).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
  });

  it.each([
    [
      { reason: 'no-nearby-trail', endpoint: 'start' } as const,
      'No routable trail or road was found within 200 m of the start point.',
    ],
    [
      { reason: 'no-route' } as const,
      'No connected route was found. Add a closer point or use Line for the next segment.',
    ],
    [
      { reason: 'routing-data-unavailable' } as const,
      'Routing data is unavailable. Try again when you are online.',
    ],
  ])('shows actionable copy for $reason', (failure, message) => {
    let draft = enqueueRoutePlanPoint(startRoutePlan('route-plan:failure'), A);
    draft = enqueueRoutePlanPoint(draft, B);
    const request = draft.pendingRequest;
    if (request === null) throw new Error('Expected route request.');
    const failed = completeRoutePlanPoint(draft, request, {
      status: 'failed',
      ...failure,
    });

    render(<RoutePlanControls draft={failed} {...callbacks()} />);
    expect(screen.getByText(message)).toBeVisible();
  });
});
