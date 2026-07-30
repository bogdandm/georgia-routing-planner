import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  ButtonBase,
  Stack,
  Typography,
} from '@mui/material';
import { useState, type ReactElement } from 'react';

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
  readonly segments: readonly MacroElevationSegment[];
  readonly activeSegmentIndex: number | null;
  readonly selectedSegmentIndex: number | null;
  readonly onSegmentHoverChange: (index: number | null) => void;
  readonly onSegmentSelectionChange: (index: number | null) => void;
}

export function ClimbsDescentsSection({
  segments,
  activeSegmentIndex,
  selectedSegmentIndex,
  onSegmentHoverChange,
  onSegmentSelectionChange,
}: ClimbsDescentsSectionProps): ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  const directionalSegments = segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.type !== 'flat');
  if (directionalSegments.length === 0) return null;

  return (
    <Accordion
      disableGutters
      elevation={0}
      expanded={expanded}
      onChange={(_, nextExpanded) => setExpanded(nextExpanded)}
      sx={{ '&::before': { display: 'none' } }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{ px: 0, minHeight: 44, '& .MuiAccordionSummary-content': { my: 1 } }}
      >
        <Typography component="h3" variant="subtitle2">
          Climbs & Descents
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 0 }}>
        <Stack
          component="ol"
          spacing={0.75}
          aria-label="Route climbs and descents"
          sx={{ m: 0, p: 0, listStyle: 'none' }}
        >
          {directionalSegments.map(({ segment, index }, visibleIndex) => {
            const selected = selectedSegmentIndex === index;
            const active = activeSegmentIndex === index;
            const primaryMovement =
              segment.type === 'climb' ? segment.ascentMeters : segment.descentMeters;
            const oppositeMovement =
              segment.type === 'climb' ? segment.descentMeters : segment.ascentMeters;
            const typeLabel = segment.type === 'climb' ? 'Climb' : 'Descent';
            const oppositeLabel = segment.type === 'climb' ? 'descent' : 'ascent';
            const ariaLabel = `#${String(visibleIndex + 1)} ${typeLabel}, ${formatTrackGrade(segment.averageGradePct)}, ${formatTrackDistance(segment.distanceMeters)}, ${formatTrackElevation(primaryMovement)}${oppositeMovement > 0 ? `, ${formatTrackElevation(oppositeMovement)} ${oppositeLabel}` : ''}`;
            return (
              <Box
                component="li"
                key={`${String(segment.startSampleIndex)}:${String(segment.endSampleIndex)}`}
              >
                <ButtonBase
                  aria-label={ariaLabel}
                  aria-pressed={selected}
                  onClick={() => onSegmentSelectionChange(selected ? null : index)}
                  onFocus={() => onSegmentHoverChange(index)}
                  onBlur={() => onSegmentHoverChange(null)}
                  onPointerEnter={() => onSegmentHoverChange(index)}
                  onPointerLeave={() => onSegmentHoverChange(null)}
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
                  <Stack direction="row" spacing={1} sx={{ width: '100%', alignItems: 'center' }}>
                    <Typography variant="caption" sx={{ width: 24, flexShrink: 0 }}>
                      #{visibleIndex + 1}
                    </Typography>
                    <Box
                      aria-hidden
                      sx={{
                        width: 10,
                        height: 32,
                        flexShrink: 0,
                        borderRadius: 0.5,
                        bgcolor:
                          appColors.elevationGrade[gradeBandForGrade(segment.averageGradePct)],
                      }}
                    />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {typeLabel}
                        </Typography>
                        <Typography variant="body2">
                          {formatTrackGrade(segment.averageGradePct)}
                        </Typography>
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {formatTrackDistance(segment.distanceMeters)} ·{' '}
                        {formatTrackElevation(primaryMovement)}
                        {oppositeMovement > 0
                          ? ` · ${formatTrackElevation(oppositeMovement)} ${oppositeLabel}`
                          : ''}
                      </Typography>
                    </Box>
                  </Stack>
                </ButtonBase>
              </Box>
            );
          })}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
