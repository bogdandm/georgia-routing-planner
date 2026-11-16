import { useLingui } from '@lingui/react/macro';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Popper,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { type ChangeEvent, useId, useState } from 'react';
import { useStore } from 'zustand';

import {
  formatTerrainLightingTuning,
  resetTerrainLighting,
  setTerrainLightingValue,
  type TerrainLightingKey,
  terrainLightingKeys,
  terrainLightingParameters,
  type TerrainLightingSection,
  terrainLightingTuningStore,
  type TerrainLightingTuning,
} from '@/presentation/map/terrainLightingTuning';

const sections: readonly TerrainLightingSection[] = [
  'light',
  'ambient',
  'mountain',
  'colors',
  'sky',
];

/** The values a copy attempt read; its button label holds until they change. */
interface CopyResult {
  readonly values: TerrainLightingTuning;
  readonly copied: boolean;
}

/**
 * Temporary developer panel right below the map control rail (`anchorEl`), beside the
 * sun panel: tunes the sun-shadow lighting live, compares it with the defaults, and copies
 * the values. Like the sun panel it is non-modal, so the map stays usable while it is
 * open. Parameter names are the project constants they replace, so they stay untranslated.
 */
export function TerrainLightingTuningPanel({
  anchorEl,
}: {
  readonly anchorEl: HTMLElement | null;
}) {
  const { t } = useLingui();
  const { values, showDefaults, panelOpen } = useStore(terrainLightingTuningStore);
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null);
  // MUI labels each section's region by its summary id and gives it the `aria-controls` id.
  const idPrefix = useId();
  if (!panelOpen || anchorEl === null) return null;

  const sectionTitles: Record<TerrainLightingSection, string> = {
    light: t`Light & contrast`,
    ambient: t`Ambient & twilight`,
    mountain: t`Mountain effects`,
    colors: t`Colors`,
    sky: t`Sky & atmosphere`,
  };
  const copy = () => {
    navigator.clipboard.writeText(formatTerrainLightingTuning(values)).then(
      () => {
        setCopyResult({ values, copied: true });
      },
      () => {
        setCopyResult({ values, copied: false });
      },
    );
  };
  const copied = copyResult?.values === values ? copyResult.copied : null;

  return (
    <Popper
      anchorEl={anchorEl}
      disablePortal
      modifiers={[
        { name: 'offset', options: { offset: [0, 8] } },
        { name: 'preventOverflow', options: { padding: 8 } },
      ]}
      open
      placement="bottom-end"
    >
      <Paper
        aria-label={t`Lighting tuning`}
        component="section"
        elevation={8}
        sx={{
          width: 320,
          maxHeight: 'min(70vh, 720px)',
          overflowY: 'auto',
          p: 1,
          borderRadius: 2,
        }}
      >
        <Stack spacing={1}>
          <Stack direction="row" sx={{ alignItems: 'center' }}>
            <Typography sx={{ flex: 1 }} variant="subtitle2">
              {t`Lighting tuning`}
            </Typography>
            <IconButton
              aria-label={t`Close lighting tuning`}
              onClick={() => {
                terrainLightingTuningStore.setState({ panelOpen: false });
              }}
              size="small"
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
          <ToggleButtonGroup
            aria-label={t`Compare with the defaults`}
            exclusive
            fullWidth
            onChange={(_event, value: string | null) => {
              if (value === null) return;
              terrainLightingTuningStore.setState({ showDefaults: value === 'before' });
            }}
            size="small"
            value={showDefaults ? 'before' : 'after'}
          >
            <ToggleButton value="before">{t`Before`}</ToggleButton>
            <ToggleButton value="after">{t`After`}</ToggleButton>
          </ToggleButtonGroup>
          <Stack direction="row" spacing={1}>
            <Button
              onClick={() => {
                resetTerrainLighting();
              }}
              size="small"
              variant="outlined"
            >
              {t`Reset all`}
            </Button>
            <Button onClick={copy} size="small" variant="outlined">
              {copied === true
                ? t`Copied`
                : copied === false
                  ? t`Copy failed`
                  : t`Copy configuration`}
            </Button>
          </Stack>
          <Typography color="text.secondary" variant="caption">
            {t`GPU values recompute shadow masks once released; the others recolor cached masks or apply at once.`}
          </Typography>
          <Box>
            {sections.map((section) => (
              <Accordion
                defaultExpanded={section === 'light'}
                disableGutters
                key={section}
                variant="outlined"
              >
                <AccordionSummary
                  aria-controls={`${idPrefix}-${section}-content`}
                  expandIcon={<ExpandMoreRoundedIcon />}
                  id={`${idPrefix}-${section}-header`}
                >
                  <Typography variant="body2">{sectionTitles[section]}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={0.5}>
                    {terrainLightingKeys
                      .filter(
                        (key) => terrainLightingParameters[key].section === section,
                      )
                      .map((key) => (
                        <TuningRow key={key} name={key} value={values[key]} />
                      ))}
                    <Button
                      onClick={() => {
                        resetTerrainLighting(section);
                      }}
                      size="small"
                      sx={{ alignSelf: 'flex-start' }}
                    >
                      {t`Reset section`}
                    </Button>
                  </Stack>
                </AccordionDetails>
              </Accordion>
            ))}
          </Box>
        </Stack>
      </Paper>
    </Popper>
  );
}

function TuningRow({
  name,
  value,
}: {
  readonly name: TerrainLightingKey;
  readonly value: number | string;
}) {
  const { t } = useLingui();
  const parameter = terrainLightingParameters[name];
  // GPU values apply on release; the slider shows the dragged value meanwhile.
  const [draft, setDraft] = useState<number | null>(null);
  const label = (
    <Typography
      component="span"
      sx={{ flex: 1, fontFamily: 'monospace', overflowWrap: 'anywhere' }}
      variant="caption"
    >
      {name}
    </Typography>
  );

  if (parameter.kind === 'color' || typeof value === 'string') {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        {label}
        <Typography sx={{ fontFamily: 'monospace' }} variant="caption">
          {String(value).toUpperCase()}
        </Typography>
        <Box
          aria-label={name}
          component="input"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setTerrainLightingValue(name, event.target.value.toUpperCase());
          }}
          sx={{ width: 36, height: 24, p: 0, border: 0, bgcolor: 'transparent' }}
          type="color"
          value={String(value)}
        />
      </Stack>
    );
  }

  const gpu = parameter.apply === 'gpu';
  const shown = draft ?? value;
  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        {label}
        {gpu ? (
          <Tooltip title={t`Recomputes shadow masks on the GPU once released`}>
            <Chip
              color="warning"
              label="GPU"
              size="small"
              sx={{ height: 18, fontSize: '0.625rem' }}
              variant="outlined"
            />
          </Tooltip>
        ) : null}
        <Typography sx={{ minWidth: 32, textAlign: 'right' }} variant="caption">
          {shown.toFixed(2)}
        </Typography>
      </Stack>
      <Slider
        aria-label={name}
        max={parameter.max}
        min={parameter.min}
        // Every step is a whole hundredth; rounding drops float noise such as
        // 0.35 − 0.01 = 0.33999999999999997 from stored and copied values.
        onChange={(_event, next) => {
          const rounded = Number(next.toFixed(2));
          if (gpu) setDraft(rounded);
          else setTerrainLightingValue(name, rounded);
        }}
        onChangeCommitted={(_event, next) => {
          if (!gpu) return;
          setDraft(null);
          setTerrainLightingValue(name, Number(next.toFixed(2)));
        }}
        size="small"
        step={parameter.step}
        sx={{ py: 0.5 }}
        value={shown}
      />
    </Box>
  );
}
