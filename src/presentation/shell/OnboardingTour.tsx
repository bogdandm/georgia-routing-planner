import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type { SvgIconComponent } from '@mui/icons-material';
import AccountCircleOutlinedIcon from '@mui/icons-material/AccountCircleOutlined';
import AddLocationAltOutlinedIcon from '@mui/icons-material/AddLocationAltOutlined';
import AltRouteOutlinedIcon from '@mui/icons-material/AltRouteOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import ChevronLeftOutlinedIcon from '@mui/icons-material/ChevronLeftOutlined';
import CloudSyncOutlinedIcon from '@mui/icons-material/CloudSyncOutlined';
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import MapOutlinedIcon from '@mui/icons-material/MapOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import MouseOutlinedIcon from '@mui/icons-material/MouseOutlined';
import MyLocationOutlinedIcon from '@mui/icons-material/MyLocationOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import PlaylistAddCheckOutlinedIcon from '@mui/icons-material/PlaylistAddCheckOutlined';
import SearchIcon from '@mui/icons-material/Search';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import ShowChartOutlinedIcon from '@mui/icons-material/ShowChartOutlined';
import SortIcon from '@mui/icons-material/Sort';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import StraightenIcon from '@mui/icons-material/Straighten';
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import ViewInArOutlinedIcon from '@mui/icons-material/ViewInArOutlined';
import WbCloudyOutlinedIcon from '@mui/icons-material/WbCloudyOutlined';
import {
  Box,
  Button,
  Modal,
  Paper,
  Popper,
  Stack,
  Typography,
  type PopperPlacementType,
} from '@mui/material';
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { useUiStore, type WorkspaceTab } from '@/presentation/shell/uiStore';
import { appColors } from '@/presentation/theme/appColors';
import { useTracksWorkspace } from '@/presentation/tracks/TracksWorkspace';
import { parseTrackShareLocation } from '@/presentation/tracks/trackShareUrl';

export type OnboardingTourStepId =
  | 'overview'
  | 'library'
  | 'track'
  | 'markers'
  | 'layers'
  | 'satellite'
  | 'weather'
  | 'user';

interface TourHintRow {
  readonly icon: SvgIconComponent;
  readonly text: MessageDescriptor;
}

interface TourHint {
  /** CSS selectors. The first visible match of each is spotlighted; the callout anchors to their union. */
  readonly targets: readonly string[];
  /** `center` points the callout at the middle of the first target without a spotlight. */
  readonly anchor: 'spotlight' | 'center';
  readonly placement: PopperPlacementType;
  readonly rows: readonly TourHintRow[];
}

interface TourStep {
  readonly id: OnboardingTourStepId;
  /** Section shown for the step; `null` keeps the current section. */
  readonly tab: WorkspaceTab | null;
  readonly title: MessageDescriptor;
  readonly hints: readonly TourHint[];
}

interface ViewportRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface MeasuredHint {
  readonly index: number;
  readonly spotlights: readonly ViewportRect[];
  readonly anchor: ViewportRect;
}

/* eslint-disable lingui/no-unlocalized-strings -- Selectors, URLs, and file names are machine data. */
export const firstOnboardingTourStep: OnboardingTourStepId = 'overview';
const demoTrackUrl = `${import.meta.env.BASE_URL}onboarding/sakhizare-from-above.gpx`;
const demoTrackFileName = 'sakhizare-from-above.gpx';
const demoTrackMediaType = 'application/gpx+xml';

const tourSteps: readonly TourStep[] = [
  {
    id: 'overview',
    tab: null,
    title: msg`Map and controls`,
    hints: [
      {
        targets: ['[data-tour="map-search"]'],
        anchor: 'spotlight',
        placement: 'left',
        rows: [
          {
            icon: SearchIcon,
            text: msg`Search places, coordinates, and your saved tracks.`,
          },
        ],
      },
      {
        targets: ['.maplibregl-ctrl-top-right'],
        anchor: 'spotlight',
        placement: 'left-end',
        rows: [
          { icon: MyLocationOutlinedIcon, text: msg`Show your location.` },
          {
            icon: ViewInArOutlinedIcon,
            text: msg`2D or 3D terrain. In 3D, drag with Shift or the middle mouse button to rotate.`,
          },
          {
            icon: LayersOutlinedIcon,
            text: msg`Base map: vector map or satellite images from Google, Bing, Esri, or NAPR.`,
          },
          {
            icon: StraightenIcon,
            text: msg`Ruler: click points on the map to measure distance and height difference.`,
          },
        ],
      },
      {
        targets: ['[data-testid="map-workspace"]'],
        anchor: 'center',
        placement: 'bottom',
        rows: [
          {
            icon: MouseOutlinedIcon,
            text: msg`Right-click the map to copy coordinates, add a marker, or get weather and satellite images for that point.`,
          },
        ],
      },
      {
        targets: ['[data-testid="navigation-collapse-toggle"]'],
        anchor: 'spotlight',
        placement: 'bottom-start',
        rows: [
          { icon: ChevronLeftOutlinedIcon, text: msg`Hide the panel to see more map.` },
        ],
      },
      {
        targets: ['[data-tour="rail-actions"]'],
        anchor: 'spotlight',
        placement: 'right',
        rows: [
          {
            icon: AccountCircleOutlinedIcon,
            text: msg`Account and sync between devices. The dot shows sync status.`,
          },
          { icon: SettingsOutlinedIcon, text: msg`Language and storage.` },
          { icon: HelpOutlineOutlinedIcon, text: msg`Show this tour again.` },
        ],
      },
    ],
  },
  {
    id: 'library',
    tab: 'tracks',
    title: msg`Tracks`,
    hints: [
      {
        targets: [
          '[data-tour="multi-track-toggle"]',
          '[data-tour="plan-route"]',
          '[data-tour="track-import"]',
          '[data-tour="track-sort"]',
          '[data-tour="create-folder"]',
        ],
        anchor: 'spotlight',
        placement: 'right',
        rows: [
          {
            icon: PlaylistAddCheckOutlinedIcon,
            text: msg`Select several tracks to see them together and download them as one ZIP.`,
          },
          {
            icon: AltRouteOutlinedIcon,
            text: msg`Plan a route: click points on the map, and the route follows paths.`,
          },
          {
            icon: UploadFileOutlinedIcon,
            text: msg`You can drop a GPX, FIT, or KML file anywhere on the page.`,
          },
          {
            icon: SortIcon,
            text: msg`Sort tracks, including by distance from the map center.`,
          },
          {
            icon: CreateNewFolderOutlinedIcon,
            text: msg`New folder. Drag tracks to move them between folders.`,
          },
        ],
      },
      {
        targets: ['[data-tour="track-row"]'],
        anchor: 'spotlight',
        placement: 'bottom',
        rows: [
          {
            icon: StarBorderIcon,
            text: msg`Point at a track to add it to favorites or delete it.`,
          },
        ],
      },
    ],
  },
  {
    id: 'track',
    tab: 'tracks',
    title: msg`Track details`,
    hints: [
      {
        targets: ['[data-tour="track-preview-actions"]'],
        anchor: 'spotlight',
        placement: 'right',
        rows: [
          {
            icon: InfoOutlinedIcon,
            text: msg`This is an example track. It is not saved and will be removed after the tour.`,
          },
          {
            icon: MoreVertIcon,
            text: msg`A saved track has a menu to rename it, download KML, share a public link, or delete it.`,
          },
        ],
      },
      {
        targets: ['[data-tour="track-profile"]'],
        anchor: 'spotlight',
        placement: 'right',
        rows: [
          {
            icon: ShowChartOutlinedIcon,
            text: msg`Point at the profile to see the place on the map. Colors show the slope.`,
          },
        ],
      },
      {
        targets: [
          '[data-tour="track-climbs"]',
          '[data-tour="track-markers"]',
          '[data-tour="track-weather"]',
        ],
        anchor: 'spotlight',
        placement: 'right',
        rows: [
          {
            icon: TrendingUpOutlinedIcon,
            text: msg`Every climb and descent with its length and grade.`,
          },
          {
            icon: AddLocationAltOutlinedIcon,
            text: msg`Add your own points to the track.`,
          },
          {
            icon: WbCloudyOutlinedIcon,
            text: msg`Weather along the route, hour by hour.`,
          },
        ],
      },
    ],
  },
  {
    id: 'markers',
    tab: 'markers',
    title: msg`Markers`,
    hints: [
      {
        targets: ['[data-tour="markers-header-actions"]'],
        anchor: 'spotlight',
        placement: 'right',
        rows: [
          {
            icon: WbCloudyOutlinedIcon,
            text: msg`Choose the days and hours of the forecast shown for every marker.`,
          },
          {
            icon: SortIcon,
            text: msg`Sort markers, including by color, icon, or distance.`,
          },
        ],
      },
    ],
  },
  {
    id: 'layers',
    tab: 'layers',
    title: msg`Layers`,
    hints: [
      {
        targets: ['[data-tour="sidebar-content"]'],
        anchor: 'spotlight',
        placement: 'right',
        rows: [
          {
            icon: LayersOutlinedIcon,
            text: msg`All map layers, grouped by data source. Your choices are saved in this browser.`,
          },
        ],
      },
    ],
  },
  {
    id: 'satellite',
    tab: 'satellite',
    title: msg`Satellite images`,
    hints: [
      {
        targets: ['[data-tour="satellite-mosaic"]'],
        anchor: 'spotlight',
        placement: 'right',
        rows: [
          {
            icon: GridViewOutlinedIcon,
            text: msg`Mosaic fills the whole view with the newest clear images.`,
          },
        ],
      },
      {
        targets: ['[data-tour="satellite-calendar"]'],
        anchor: 'spotlight',
        placement: 'right',
        rows: [
          {
            icon: CalendarMonthOutlinedIcon,
            text: msg`Highlighted days have images under the cloud limit. Click a day to show its image.`,
          },
        ],
      },
      {
        targets: ['[data-tour="satellite-search-area"]'],
        anchor: 'spotlight',
        placement: 'right',
        rows: [
          {
            icon: PlaceOutlinedIcon,
            text: msg`Images are searched at the map center. Right-click the map to search at another point.`,
          },
        ],
      },
    ],
  },
  {
    id: 'weather',
    tab: 'weather',
    title: msg`Weather`,
    hints: [
      {
        targets: [
          '[data-tour="weather-map-toggle"]',
          '[data-tour="weather-point-toggle"]',
          '[data-tour="weather-more-actions"]',
        ],
        anchor: 'spotlight',
        placement: 'right',
        rows: [
          { icon: MapOutlinedIcon, text: msg`Weather map: clouds, rain, and wind.` },
          {
            icon: AddLocationAltOutlinedIcon,
            text: msg`Pick a point on the map to get its forecast.`,
          },
          {
            icon: MoreVertIcon,
            text: msg`Open the point on meteoblue.com or windy.com.`,
          },
        ],
      },
    ],
  },
  {
    id: 'user',
    tab: 'user',
    title: msg`Account`,
    hints: [
      {
        targets: ['[data-tour="user-panel"]'],
        anchor: 'spotlight',
        placement: 'right',
        rows: [
          {
            icon: CloudSyncOutlinedIcon,
            text: msg`An account is optional. Turn on sync to keep tracks, folders, and markers on all your devices.`,
          },
        ],
      },
    ],
  },
];
/* eslint-enable lingui/no-unlocalized-strings */

const spotlightPadding = 4;

function visibleRect(selector: string): ViewportRect | null {
  for (const element of document.querySelectorAll(selector)) {
    if (getComputedStyle(element).visibility !== 'visible') continue;
    const rect = element.getBoundingClientRect();
    if (
      rect.width === 0 ||
      rect.height === 0 ||
      rect.bottom <= 0 ||
      rect.right <= 0 ||
      rect.top >= window.innerHeight ||
      rect.left >= window.innerWidth
    ) {
      continue;
    }
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  return null;
}

function unionRect(rects: readonly ViewportRect[]): ViewportRect {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));
  return { left, top, width: right - left, height: bottom - top };
}

function measureHints(step: TourStep): readonly MeasuredHint[] {
  const measured: MeasuredHint[] = [];
  step.hints.forEach((hint, index) => {
    const rects = hint.targets
      .map(visibleRect)
      .filter((rect): rect is ViewportRect => rect !== null);
    const first = rects[0];
    if (first === undefined) return;
    if (hint.anchor === 'center') {
      measured.push({
        index,
        spotlights: [],
        anchor: {
          left: first.left + first.width / 2,
          top: first.top + first.height / 2,
          width: 0,
          height: 0,
        },
      });
      return;
    }
    measured.push({ index, spotlights: rects, anchor: unionRect(rects) });
  });
  return measured;
}

/**
 * Follows the step's targets every animation frame while the tour is open, because
 * panels, the demo track, and late-loading map controls move them without any event
 * the tour could subscribe to. React state changes only when a rectangle moves.
 */
function useMeasuredHints(step: TourStep): readonly MeasuredHint[] {
  const [measured, setMeasured] = useState<readonly MeasuredHint[]>([]);
  useEffect(() => {
    let frame = 0;
    let previousKey = '';
    const measure = () => {
      const next = measureHints(step);
      const key = JSON.stringify(next);
      if (key !== previousKey) {
        previousKey = key;
        setMeasured(next);
      }
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [step]);
  return measured;
}

interface DemoSession {
  file: File | null;
}

interface OnboardingTourProps {
  readonly step: OnboardingTourStepId;
  /** The tour is desktop-only; a switch to the smartphone layout closes it unfinished. */
  readonly smartphoneViewport: boolean;
  readonly onStepChange: (step: OnboardingTourStepId) => void;
  readonly onClose: (completed: boolean) => void;
}

/**
 * Coach-mark tour that shows every hint of one workspace section at once.
 *
 * The Track details step imports a bundled example GPX as an unsaved preview. A
 * preview is never written to IndexedDB, so it cannot synchronize; leaving the step
 * or closing the tour discards it. The demo runs only when it replaces nothing
 * unsaved: no preview, shared track or pending shared link, route plan, or
 * multi-track selection.
 */
export function OnboardingTour({
  step,
  smartphoneViewport,
  onStepChange,
  onClose,
}: OnboardingTourProps) {
  const { i18n } = useLingui();
  const titleId = useId();
  const maskId = useId();
  const { active, discardPreview, importFiles, importState, multiTrackMode } =
    useTracksWorkspace();
  const setActiveTab = useUiStore((state) => state.setActiveTab);
  const [steps] = useState(() => {
    const demoAvailable =
      !multiTrackMode &&
      importState === 'idle' &&
      (active === null || active.kind === 'saved') &&
      parseTrackShareLocation(window.location.hash).kind === 'none';
    return demoAvailable ? tourSteps : tourSteps.filter(({ id }) => id !== 'track');
  });
  const demoSession = useRef<DemoSession | null>(null);
  // Captured at the first section switch, after the shell restored any URL anchor.
  const returnTab = useRef<WorkspaceTab | null>(null);
  const index = steps.findIndex(({ id }) => id === step);
  const currentStep = steps[index];
  // The shell only receives step IDs from this component's own sequence.
  if (currentStep === undefined) throw new Error('Unknown onboarding tour step.');
  const measured = useMeasuredHints(currentStep);
  const lastStep = index === steps.length - 1;

  const startDemo = async () => {
    const session: DemoSession = { file: null };
    demoSession.current = session;
    try {
      const response = await fetch(demoTrackUrl);
      if (!response.ok) return;
      const file = new File([await response.blob()], demoTrackFileName, {
        type: demoTrackMediaType,
      });
      if (demoSession.current !== session) return;
      session.file = file;
      await importFiles([file]);
    } catch {
      // Without the example the step still shows the hints whose targets exist.
    }
  };

  const endDemo = () => {
    const session = demoSession.current;
    demoSession.current = null;
    if (session === null) return;
    const demoIsActive =
      active === null || (active.kind === 'preview' && active.file === session.file);
    if (demoIsActive) discardPreview();
  };

  const goTo = (nextIndex: number) => {
    const next = steps[nextIndex];
    if (next === undefined) return;
    if (currentStep.id === 'track') endDemo();
    if (next.tab !== null) {
      returnTab.current ??= useUiStore.getState().activeTab;
      setActiveTab(next.tab);
    }
    if (next.id === 'track') void startDemo();
    onStepChange(next.id);
  };

  const close = (completed: boolean) => {
    endDemo();
    if (returnTab.current !== null) setActiveTab(returnTab.current);
    onClose(completed);
  };

  const closeForSmartphone = useEffectEvent(() => {
    close(false);
  });
  useEffect(() => {
    if (smartphoneViewport) closeForSmartphone();
  }, [smartphoneViewport]);

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight' && !lastStep) {
      event.preventDefault();
      goTo(index + 1);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      goTo(index - 1);
    }
  };

  const spotlights = measured.flatMap((hint) => hint.spotlights);
  const position = index + 1;
  const total = steps.length;

  return (
    <Modal
      open
      hideBackdrop
      onClose={() => {
        close(true);
      }}
    >
      <Box
        role="dialog"
        aria-modal
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        sx={{ position: 'fixed', inset: 0, outline: 'none' }}
      >
        <Box
          component="svg"
          aria-hidden="true"
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        >
          <defs>
            <mask id={maskId}>
              <rect width="100%" height="100%" fill="white" />
              {spotlights.map((rect, rectIndex) => (
                <rect
                  key={rectIndex}
                  x={rect.left - spotlightPadding}
                  y={rect.top - spotlightPadding}
                  width={rect.width + spotlightPadding * 2}
                  height={rect.height + spotlightPadding * 2}
                  rx={8}
                  fill="black"
                />
              ))}
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill={appColors.interaction.tourScrim}
            mask={`url(#${maskId})`}
          />
        </Box>
        {spotlights.map((rect, rectIndex) => (
          <Box
            key={rectIndex}
            aria-hidden="true"
            sx={{
              position: 'absolute',
              left: rect.left - spotlightPadding,
              top: rect.top - spotlightPadding,
              width: rect.width + spotlightPadding * 2,
              height: rect.height + spotlightPadding * 2,
              borderRadius: 2,
              border: `2px solid ${appColors.brand.amber}`,
              pointerEvents: 'none',
            }}
          />
        ))}
        {measured.map((hint) => {
          const definition = currentStep.hints[hint.index];
          if (definition === undefined) return null;
          const anchor = hint.anchor;
          return (
            <Popper
              key={`${currentStep.id}:${String(hint.index)}`}
              open
              disablePortal
              placement={definition.placement}
              anchorEl={{
                getBoundingClientRect: () =>
                  DOMRect.fromRect({
                    x: anchor.left,
                    y: anchor.top,
                    width: anchor.width,
                    height: anchor.height,
                  }),
              }}
              popperOptions={{ strategy: 'fixed' }}
              modifiers={[
                { name: 'offset', options: { offset: [0, 14] } },
                { name: 'preventOverflow', options: { padding: 8 } },
              ]}
              sx={{ zIndex: 1, maxWidth: 320 }}
            >
              <Paper
                role="note"
                elevation={8}
                sx={{
                  px: 1.5,
                  py: 1.25,
                  borderLeft: `3px solid ${appColors.brand.amber}`,
                }}
              >
                <Stack spacing={1}>
                  {definition.rows.map((row) => (
                    <Stack
                      key={row.text.id}
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'flex-start' }}
                    >
                      <row.icon
                        aria-hidden
                        color="primary"
                        sx={{ fontSize: 20, mt: '1px', flexShrink: 0 }}
                      />
                      <Typography variant="body2">{i18n._(row.text)}</Typography>
                    </Stack>
                  ))}
                </Stack>
              </Paper>
            </Popper>
          );
        })}
        <Paper
          elevation={12}
          sx={{
            position: 'absolute',
            right: 24,
            bottom: 32,
            width: 380,
            maxWidth: 'calc(100% - 48px)',
            p: 2,
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}
          >
            <Typography
              id={titleId}
              component="h2"
              variant="subtitle1"
              sx={{ fontWeight: 700 }}
            >
              {i18n._(currentStep.title)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              <Trans>
                {position} of {total}
              </Trans>
            </Typography>
          </Stack>
          {index === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              <Trans>
                A short tour of controls that are easy to miss. Each step shows one
                section.
              </Trans>
            </Typography>
          ) : null}
          <Stack direction="row" spacing={1} sx={{ mt: 2, justifyContent: 'flex-end' }}>
            {lastStep ? null : (
              <Button
                color="inherit"
                data-testid="onboarding-tour-skip"
                onClick={() => {
                  close(true);
                }}
                sx={{ mr: 'auto !important' }}
              >
                <Trans>Skip tour</Trans>
              </Button>
            )}
            <Button
              disabled={index === 0}
              onClick={() => {
                goTo(index - 1);
              }}
            >
              <Trans>Back</Trans>
            </Button>
            <Button
              autoFocus
              variant="contained"
              onClick={() => {
                if (lastStep) {
                  close(true);
                } else {
                  goTo(index + 1);
                }
              }}
            >
              {lastStep ? <Trans>Done</Trans> : <Trans>Next</Trans>}
            </Button>
          </Stack>
        </Paper>
      </Box>
    </Modal>
  );
}
