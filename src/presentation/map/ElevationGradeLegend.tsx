import { Box, Paper, Stack, Typography } from '@mui/material';

import type { ElevationProfile, GradeBand } from '@/domain/tracks/elevationProfile';
import { appColors } from '@/presentation/theme/appColors';

interface ElevationGradeLegendProps {
  readonly profile: ElevationProfile | null;
  readonly visible: boolean;
}

const gradeBands = [
  { band: 'steep-descent', label: '≤ −10%' },
  { band: 'descent', label: '−10 to −3%' },
  { band: 'flat', label: '−3 to 3%' },
  { band: 'climb', label: '3 to 10%' },
  { band: 'hard-climb', label: '10 to 20%' },
  { band: 'steep-climb', label: '20 to 30%' },
  { band: 'extreme-climb', label: '≥ 30%' },
] as const satisfies readonly { readonly band: GradeBand; readonly label: string }[];

function hasGradeSubsegments(profile: ElevationProfile): boolean {
  return profile.segments.some(
    (segment) => segment.type !== 'flat' && segment.gradeSubsegments.length > 0,
  );
}

/** Explains the colors of the active track's grade overlay without duplicating its state. */
export function ElevationGradeLegend({ profile, visible }: ElevationGradeLegendProps) {
  if (!visible || profile === null || !hasGradeSubsegments(profile)) return null;

  return (
    <Paper
      aria-label="Elevation grade legend"
      component="section"
      elevation={2}
      sx={{
        position: 'absolute',
        right: 8,
        bottom: 32,
        zIndex: 1,
        px: 1,
        py: 0.75,
        maxWidth: 'calc(100% - 16px)',
      }}
    >
      <Typography component="h2" variant="caption" sx={{ fontWeight: 700 }}>
        Track grade
      </Typography>
      <Stack
        direction="row"
        useFlexGap
        aria-label="Grade ranges"
        sx={{ flexWrap: 'wrap', gap: 0.75 }}
      >
        {gradeBands.map(({ band, label }) => (
          <Stack
            key={band}
            direction="row"
            spacing={0.375}
            sx={{ alignItems: 'center' }}
          >
            <Box
              aria-hidden
              sx={{
                width: 10,
                height: 10,
                flexShrink: 0,
                borderRadius: 0.5,
                bgcolor: appColors.elevationGrade[band],
              }}
            />
            <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>
              {label}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
