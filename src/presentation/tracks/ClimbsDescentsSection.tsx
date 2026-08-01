import ChangeHistoryOutlinedIcon from '@mui/icons-material/ChangeHistoryOutlined';
import NorthEastIcon from '@mui/icons-material/NorthEast';
import SouthEastIcon from '@mui/icons-material/SouthEast';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Box,
  ButtonBase,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useId, useState, type ReactElement } from 'react';

import {
  gradeBandForGrade,
  type MacroElevationSegment,
} from '@/domain/tracks/elevationProfile';
import {
  formatTrackDistance,
  formatTrackElevation,
  formatTrackGrade,
} from '@/presentation/tracks/trackFormatters';
import { appColors } from '@/presentation/theme/appColors';

interface ClimbsDescentsSectionProps {
  readonly recalculating: boolean;
  readonly onRecalculate: () => void;
  readonly segments: readonly MacroElevationSegment[];
  readonly activeSegmentIndex: number | null;
  readonly selectedSegmentIndex: number | null;
  readonly onSegmentHoverChange: (index: number | null) => void;
  readonly onSegmentSelectionChange: (index: number | null) => void;
}

interface NumberedDirectionalSegment {
  readonly segment: MacroElevationSegment;
  readonly segmentIndex: number;
  readonly typeNumber: number;
}

function numberedDirectionalSegments(
  segments: readonly MacroElevationSegment[],
): readonly NumberedDirectionalSegment[] {
  let climbCount = 0;
  let descentCount = 0;
  const result: NumberedDirectionalSegment[] = [];
  for (const [segmentIndex, segment] of segments.entries()) {
    if (segment.type === 'flat') continue;
    if (segment.type === 'climb') {
      climbCount += 1;
      result.push({ segment, segmentIndex, typeNumber: climbCount });
    } else {
      descentCount += 1;
      result.push({ segment, segmentIndex, typeNumber: descentCount });
    }
  }
  return result;
}

export function ClimbsDescentsSection({
  recalculating,
  onRecalculate,
  segments,
  activeSegmentIndex,
  selectedSegmentIndex,
  onSegmentHoverChange,
  onSegmentSelectionChange,
}: ClimbsDescentsSectionProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const detailsId = `climbs-descents-${useId().replaceAll(':', '')}`;
  const directionalSegments = numberedDirectionalSegments(segments);

  return (
    <Box component="section">
      <Box
        sx={{
          minHeight: 44,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          alignItems: 'center',
          columnGap: 0.5,
        }}
      >
        <ButtonBase
          aria-label="Climbs & Descents"
          aria-controls={detailsId}
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((current) => !current);
          }}
          sx={{
            minWidth: 0,
            minHeight: 44,
            justifyContent: 'space-between',
            px: 1,
            textAlign: 'left',
          }}
        >
          <Typography component="h3" variant="subtitle2">
            Climbs & Descents
          </Typography>
          <ExpandMoreIcon
            aria-hidden
            fontSize="small"
            sx={{
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: (theme) =>
                theme.transitions.create('transform', {
                  duration: theme.transitions.duration.shortest,
                }),
            }}
          />
        </ButtonBase>
        <Tooltip title="Recalculate elevation">
          <span>
            <IconButton
              size="small"
              aria-label="Recalculate elevation"
              disabled={recalculating}
              onClick={onRecalculate}
            >
              {recalculating ? (
                <CircularProgress size={18} />
              ) : (
                <RefreshIcon fontSize="small" />
              )}
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      {expanded ? (
        <Box id={detailsId}>
          {directionalSegments.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              No significant climbs or descents.
            </Typography>
          ) : (
            <Stack
              component="ul"
              spacing={0.75}
              aria-label="Route climbs and descents"
              sx={{ m: 0, p: 0, listStyle: 'none' }}
            >
              {directionalSegments.map(({ segment, segmentIndex, typeNumber }) => {
                const selected = selectedSegmentIndex === segmentIndex;
                const active = activeSegmentIndex === segmentIndex;
                const primaryMovement =
                  segment.type === 'climb'
                    ? segment.ascentMeters
                    : segment.descentMeters;
                const oppositeMovement =
                  segment.type === 'climb'
                    ? segment.descentMeters
                    : segment.ascentMeters;
                const typeLabel = segment.type === 'climb' ? 'Climb' : 'Descent';
                const heading = `${typeLabel} ${String(typeNumber)}`;
                const oppositeLabel = segment.type === 'climb' ? 'descent' : 'ascent';
                const ariaLabel = `${heading}, ${formatTrackGrade(segment.averageGradePct)}, ${formatTrackDistance(segment.distanceMeters)}, ${formatTrackElevation(primaryMovement)}${oppositeMovement > 0 ? `, ${formatTrackElevation(oppositeMovement)} ${oppositeLabel}` : ''}`;
                return (
                  <Box
                    component="li"
                    key={`${String(segment.startSampleIndex)}:${String(segment.endSampleIndex)}`}
                  >
                    <ButtonBase
                      aria-label={ariaLabel}
                      aria-pressed={selected}
                      onClick={() => {
                        onSegmentSelectionChange(selected ? null : segmentIndex);
                      }}
                      onFocus={() => {
                        onSegmentHoverChange(segmentIndex);
                      }}
                      onBlur={() => {
                        onSegmentHoverChange(null);
                      }}
                      onPointerEnter={() => {
                        onSegmentHoverChange(segmentIndex);
                      }}
                      onPointerLeave={() => {
                        onSegmentHoverChange(null);
                      }}
                      sx={{
                        width: '100%',
                        borderRadius: 1,
                        px: 1,
                        py: 0.75,
                        justifyContent: 'stretch',
                        textAlign: 'left',
                        bgcolor: active ? 'action.selected' : 'transparent',
                      }}
                    >
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ width: '100%', alignItems: 'center' }}
                      >
                        <Box
                          aria-hidden
                          sx={{
                            width: 10,
                            height: 32,
                            flexShrink: 0,
                            borderRadius: 0.5,
                            bgcolor:
                              appColors.elevationGrade[
                                gradeBandForGrade(segment.averageGradePct)
                              ],
                          }}
                        />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {heading}
                          </Typography>
                          <Stack
                            direction="row"
                            sx={{
                              mt: 0.25,
                              alignItems: 'center',
                              color: 'text.secondary',
                              flexWrap: 'wrap',
                              columnGap: 1.5,
                              rowGap: 0.25,
                            }}
                          >
                            <Stack
                              direction="row"
                              spacing={0.5}
                              sx={{ alignItems: 'center' }}
                            >
                              <Tooltip title="Distance">
                                <SwapHorizIcon aria-hidden sx={{ fontSize: 15 }} />
                              </Tooltip>
                              <Typography
                                variant="caption"
                                sx={{ whiteSpace: 'nowrap' }}
                              >
                                {formatTrackDistance(segment.distanceMeters)}
                              </Typography>
                            </Stack>
                            <Stack
                              direction="row"
                              spacing={0.5}
                              sx={{ alignItems: 'center' }}
                            >
                              <Tooltip
                                title={
                                  segment.type === 'climb'
                                    ? 'Elevation gain'
                                    : 'Elevation loss'
                                }
                              >
                                {segment.type === 'climb' ? (
                                  <NorthEastIcon aria-hidden sx={{ fontSize: 15 }} />
                                ) : (
                                  <SouthEastIcon aria-hidden sx={{ fontSize: 15 }} />
                                )}
                              </Tooltip>
                              <Typography
                                variant="caption"
                                sx={{ whiteSpace: 'nowrap' }}
                              >
                                {formatTrackElevation(primaryMovement)}
                              </Typography>
                            </Stack>
                            {oppositeMovement > 0 ? (
                              <Stack
                                direction="row"
                                spacing={0.5}
                                sx={{ alignItems: 'center' }}
                              >
                                <Tooltip
                                  title={
                                    segment.type === 'climb'
                                      ? 'Elevation loss'
                                      : 'Elevation gain'
                                  }
                                >
                                  {segment.type === 'climb' ? (
                                    <SouthEastIcon aria-hidden sx={{ fontSize: 15 }} />
                                  ) : (
                                    <NorthEastIcon aria-hidden sx={{ fontSize: 15 }} />
                                  )}
                                </Tooltip>
                                <Typography
                                  variant="caption"
                                  sx={{ whiteSpace: 'nowrap' }}
                                >
                                  {formatTrackElevation(oppositeMovement)}
                                </Typography>
                              </Stack>
                            ) : null}
                            <Stack
                              direction="row"
                              spacing={0.5}
                              sx={{ alignItems: 'center' }}
                            >
                              <Tooltip title="Average grade">
                                <ChangeHistoryOutlinedIcon
                                  aria-hidden
                                  sx={{
                                    fontSize: 15,
                                    transform:
                                      segment.averageGradePct < 0
                                        ? 'rotate(180deg)'
                                        : undefined,
                                  }}
                                />
                              </Tooltip>
                              <Typography
                                variant="caption"
                                sx={{ whiteSpace: 'nowrap' }}
                              >
                                {formatTrackGrade(segment.averageGradePct)}
                              </Typography>
                            </Stack>
                          </Stack>
                        </Box>
                      </Stack>
                    </ButtonBase>
                  </Box>
                );
              })}
            </Stack>
          )}
        </Box>
      ) : null}
    </Box>
  );
}
