import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activateAppLocale } from '@/presentation/localization/appI18n';
import {
  RoutePlanControls,
  TrackEditControls,
} from '@/presentation/tracks/RoutePlanControls';
import {
  completeTrackPathRequest,
  deleteTrackPathAnchors,
  placeTrackPathPoint,
  setTrackPathInsertionMode,
  startRoutePlan,
  startTrackPathEdit,
  trackPathFromSegments,
  updateTrackPathProgress,
} from '@/presentation/tracks/trackPathEditor';
import { renderWithI18n } from '@test/helpers/renderWithI18n';

const A = [44.64, 42.66] as const;
const B = [44.65, 42.67] as const;
const C = [44.66, 42.68] as const;

function callbacks() {
  return {
    onClear: vi.fn(),
    onDiscard: vi.fn(),
    onNameChange: vi.fn(),
    onSave: vi.fn(),
    onUndo: vi.fn(),
  };
}

function lineDraft(id: string) {
  const plan = setTrackPathInsertionMode(startRoutePlan(id, 'New route'), 'line');
  return placeTrackPathPoint(placeTrackPathPoint(plan, A), B);
}

function routedDraft(id: string) {
  return placeTrackPathPoint(
    placeTrackPathPoint(startRoutePlan(id, 'New route'), A),
    B,
  );
}

describe('RoutePlanControls', () => {
  beforeEach(() => {
    activateAppLocale('en');
  });

  it('enables save and undo for a usable line', async () => {
    const user = userEvent.setup();
    const handlers = callbacks();
    renderWithI18n(
      <RoutePlanControls draft={lineDraft('route-plan:controls')} {...handlers} />,
    );

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(handlers.onUndo).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(handlers.onSave).toHaveBeenCalledOnce();
  });

  it('uses the one fixed status slot for routing, elevation, and saving', () => {
    const status = renderWithI18n(
      <RoutePlanControls draft={routedDraft('route-plan:status')} {...callbacks()} />,
    ).getByRole('status');

    expect(status).toHaveStyle({ minHeight: '40px' });
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    renderWithI18n(
      <RoutePlanControls
        draft={lineDraft('route-plan:elevation')}
        elevationProgress={{ completedSamples: 1, totalSamples: 2, points: [] }}
        {...callbacks()}
      />,
    );
    expect(screen.getByText('Loading elevation: 50%')).toBeVisible();
  });

  it('shows determinate progress while building the route graph', () => {
    const calculating = routedDraft('route-plan:graph-progress');
    const request = calculating.pendingRequest;
    if (request === null) throw new Error('Expected route request.');
    const buildingGraph = updateTrackPathProgress(calculating, request, {
      phase: 'building-graph',
      attempt: 1,
      loadedTileCount: 4,
      totalTileCount: 4,
      graphProgress: 0.6,
    });

    renderWithI18n(<RoutePlanControls draft={buildingGraph} {...callbacks()} />);

    expect(screen.getByText('Building route graph… 60%')).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
  });

  it.each([
    [
      { reason: 'no-nearby-trail', waypointIndexes: [1] } as const,
      'No routable trail or road was found within 200 m of point 2.',
    ],
    [
      { reason: 'no-nearby-trail', waypointIndexes: [0, 1] } as const,
      'No routable trail or road was found within 200 m of points 1 and 2.',
    ],
    [
      { reason: 'no-route', legIndex: 0 } as const,
      'No connected route was found. Add a closer point or use Line for this segment.',
    ],
    [
      { reason: 'routing-data-unavailable' } as const,
      'Routing data is unavailable. Try again when you are online.',
    ],
  ])('shows actionable copy for %o', (failure, message) => {
    const draft = routedDraft('route-plan:failure');
    const request = draft.pendingRequest;
    if (request === null) throw new Error('Expected route request.');
    const failed = completeTrackPathRequest(draft, request, {
      status: 'failed',
      ...failure,
    });

    renderWithI18n(<RoutePlanControls draft={failed} {...callbacks()} />);
    expect(screen.getByText(message)).toBeVisible();
  });
});

describe('TrackEditControls', () => {
  beforeEach(() => {
    activateAppLocale('en');
  });

  it('enables Save and Undo only after an edit', async () => {
    const user = userEvent.setup();
    const handlers = { onCancel: vi.fn(), onSave: vi.fn(), onUndo: vi.fn() };
    const opened = startTrackPathEdit(
      trackPathFromSegments(
        [[{ coordinate: A }, { coordinate: B }, { coordinate: C }]],
        {
          stripElevation: false,
        },
      ),
      null,
    );
    const { rerender } = renderWithI18n(
      <TrackEditControls draft={opened} elevationProgress={null} {...handlers} />,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handlers.onCancel).toHaveBeenCalledOnce();

    rerender(
      <TrackEditControls
        draft={deleteTrackPathAnchors(opened, 1, 1)}
        elevationProgress={null}
        {...handlers}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(handlers.onSave).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
  });
});
