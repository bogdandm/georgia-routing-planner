import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import {
  Box,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Trans, useLingui } from '@lingui/react/macro';
import { Fragment, useState, type KeyboardEvent, type ReactNode } from 'react';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import {
  DAY_HIKE_TIME_PRESET_ID,
  MAXIMUM_CUSTOM_HIKING_TIME_PRESETS,
  MAXIMUM_HIKING_ALTITUDE_BANDS,
  MAXIMUM_HIKING_PACE_KNOTS,
  MAXIMUM_HIKING_TIME_PRESET_NAME_LENGTH,
  defaultHikingTimePresetSettings,
  dinHikingMovement,
  hikingTimePresets,
  isBuiltInHikingTimePreset,
  resolveHikingTimePreset,
  validHikingTimeParameters,
  type HikingAltitudeBand,
  type HikingMovementModel,
  type HikingPaceKnot,
  type HikingTimeParameters,
  type HikingTimePreset,
  type HikingTimePresetSettings,
} from '@/domain/tracks/hikingTime';
import { useUiStore } from '@/presentation/shell/uiStore';
import { hikingTimePresetName } from '@/presentation/tracks/hikingTimePresetFormat';

/*
 * The form edits raw input text so users can pass through intermediate values such as
 * an empty field; the text becomes parameters only when every number parses.
 */
interface KnotDraft {
  readonly gradePercent: string;
  readonly speedKmh: string;
}

interface BandDraft {
  readonly fromMeters: string;
  readonly speedFactor: string;
}

type MovementKind = HikingMovementModel['kind'];

type MovementDraft =
  | {
      readonly kind: 'din';
      readonly horizontalKmh: string;
      readonly ascentMetersPerHour: string;
      readonly descentMetersPerHour: string;
    }
  | { readonly kind: 'grade-curve'; readonly knots: readonly KnotDraft[] };

interface ParametersDraft {
  readonly movement: MovementDraft;
  readonly altitudeBands: readonly BandDraft[];
  readonly breakMinutesPerMovingHour: string;
  readonly lunchMinutes: string;
  readonly lunchMinimumMovingHours: string;
  readonly movingHoursPerDay: string;
}

type NameForm = { readonly mode: 'create' | 'rename'; readonly text: string } | null;

/** Switching to the pace curve starts from the calibrated day-hike knots. */
const dayHikeMovement = resolveHikingTimePreset(
  defaultHikingTimePresetSettings,
  DAY_HIKE_TIME_PRESET_ID,
).parameters.movement;

function parseDraftNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function movementDraft(movement: HikingMovementModel): MovementDraft {
  if (movement.kind === 'din') {
    return {
      kind: 'din',
      horizontalKmh: String(movement.horizontalKmh),
      ascentMetersPerHour: String(movement.ascentMetersPerHour),
      descentMetersPerHour: String(movement.descentMetersPerHour),
    };
  }
  return {
    kind: 'grade-curve',
    knots: movement.knots.map((knot) => ({
      gradePercent: String(knot.gradePercent),
      speedKmh: String(knot.speedKmh),
    })),
  };
}

function parametersDraft(parameters: HikingTimeParameters): ParametersDraft {
  return {
    movement: movementDraft(parameters.movement),
    altitudeBands: parameters.altitudeBands.map((band) => ({
      fromMeters: String(band.fromMeters),
      speedFactor: String(band.speedFactor),
    })),
    breakMinutesPerMovingHour: String(parameters.breakMinutesPerMovingHour),
    lunchMinutes: String(parameters.lunchMinutes),
    lunchMinimumMovingHours: String(parameters.lunchMinimumMovingHours),
    movingHoursPerDay: String(parameters.movingHoursPerDay),
  };
}

function movementFromDraft(draft: MovementDraft): HikingMovementModel | null {
  if (draft.kind === 'din') {
    const horizontalKmh = parseDraftNumber(draft.horizontalKmh);
    const ascentMetersPerHour = parseDraftNumber(draft.ascentMetersPerHour);
    const descentMetersPerHour = parseDraftNumber(draft.descentMetersPerHour);
    if (
      horizontalKmh === null ||
      ascentMetersPerHour === null ||
      descentMetersPerHour === null
    ) {
      return null;
    }
    return { kind: 'din', horizontalKmh, ascentMetersPerHour, descentMetersPerHour };
  }
  const knots: HikingPaceKnot[] = [];
  for (const knot of draft.knots) {
    const gradePercent = parseDraftNumber(knot.gradePercent);
    const speedKmh = parseDraftNumber(knot.speedKmh);
    if (gradePercent === null || speedKmh === null) return null;
    knots.push({ gradePercent, speedKmh });
  }
  return { kind: 'grade-curve', knots };
}

function parametersFromDraft(draft: ParametersDraft): HikingTimeParameters | null {
  const movement = movementFromDraft(draft.movement);
  if (movement === null) return null;
  const altitudeBands: HikingAltitudeBand[] = [];
  for (const band of draft.altitudeBands) {
    const fromMeters = parseDraftNumber(band.fromMeters);
    const speedFactor = parseDraftNumber(band.speedFactor);
    if (fromMeters === null || speedFactor === null) return null;
    altitudeBands.push({ fromMeters, speedFactor });
  }
  const breakMinutesPerMovingHour = parseDraftNumber(draft.breakMinutesPerMovingHour);
  const lunchMinutes = parseDraftNumber(draft.lunchMinutes);
  const lunchMinimumMovingHours = parseDraftNumber(draft.lunchMinimumMovingHours);
  const movingHoursPerDay = parseDraftNumber(draft.movingHoursPerDay);
  if (
    breakMinutesPerMovingHour === null ||
    lunchMinutes === null ||
    lunchMinimumMovingHours === null ||
    movingHoursPerDay === null
  ) {
    return null;
  }
  return {
    movement,
    altitudeBands,
    breakMinutesPerMovingHour,
    lunchMinutes,
    lunchMinimumMovingHours,
    movingHoursPerDay,
  };
}

function sameRows<T>(
  left: readonly T[],
  right: readonly T[],
  same: (leftRow: T, rightRow: T) => boolean,
): boolean {
  return (
    left.length === right.length &&
    left.every((row, index) => {
      const other = right[index];
      return other !== undefined && same(row, other);
    })
  );
}

function sameMovement(left: HikingMovementModel, right: HikingMovementModel): boolean {
  if (left.kind === 'din') {
    return (
      right.kind === 'din' &&
      left.horizontalKmh === right.horizontalKmh &&
      left.ascentMetersPerHour === right.ascentMetersPerHour &&
      left.descentMetersPerHour === right.descentMetersPerHour
    );
  }
  return (
    right.kind === 'grade-curve' &&
    sameRows(
      left.knots,
      right.knots,
      (a, b) => a.gradePercent === b.gradePercent && a.speedKmh === b.speedKmh,
    )
  );
}

function sameParameters(
  left: HikingTimeParameters,
  right: HikingTimeParameters,
): boolean {
  return (
    sameMovement(left.movement, right.movement) &&
    sameRows(
      left.altitudeBands,
      right.altitudeBands,
      (a, b) => a.fromMeters === b.fromMeters && a.speedFactor === b.speedFactor,
    ) &&
    left.breakMinutesPerMovingHour === right.breakMinutesPerMovingHour &&
    left.lunchMinutes === right.lunchMinutes &&
    left.lunchMinimumMovingHours === right.lunchMinimumMovingHours &&
    left.movingHoursPerDay === right.movingHoursPerDay
  );
}

function replaceRow<T>(rows: readonly T[], index: number, row: T): T[] {
  return rows.map((value, rowIndex) => (rowIndex === index ? row : value));
}

/** A new pace row continues the curve 10 % steeper at the last speed. */
function nextKnot(knots: readonly KnotDraft[]): KnotDraft {
  const last = knots.at(-1);
  const grade = last === undefined ? null : parseDraftNumber(last.gradePercent);
  return {
    gradePercent: grade === null ? '' : String(grade + 10),
    speedKmh: last?.speedKmh ?? '',
  };
}

/** A new altitude band starts 500 m above the last one, or at 2000 m. */
function nextBand(bands: readonly BandDraft[]): BandDraft {
  const last = bands.at(-1);
  if (last === undefined) return { fromMeters: '2000', speedFactor: '0.9' };
  const fromMeters = parseDraftNumber(last.fromMeters);
  return {
    fromMeters: fromMeters === null ? '' : String(fromMeters + 500),
    speedFactor: last.speedFactor,
  };
}

interface NumberFieldProps {
  readonly label: string;
  readonly value: string;
  readonly step: number;
  readonly onChange: (value: string) => void;
  /** Table cells keep the label for assistive technology; the column heading shows it. */
  readonly inTable?: boolean;
}

function NumberField({
  label,
  value,
  step,
  onChange,
  inTable = false,
}: NumberFieldProps) {
  return (
    <TextField
      size="small"
      type="number"
      label={inTable ? undefined : label}
      value={value}
      error={parseDraftNumber(value) === null}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      slotProps={{
        htmlInput: { step, 'aria-label': inTable ? label : undefined },
      }}
    />
  );
}

/**
 * Edits every hiking-time model parameter of one preset and manages user presets.
 * Built-in presets stay read-only: their values can be tried as a draft and saved as
 * a copy.
 */
export function HikingTimeSettingsPanel() {
  const { t, i18n } = useLingui();
  const settings = useUiStore((state) => state.hikingTimePresets);
  const setSettings = useUiStore((state) => state.setHikingTimePresets);
  const defaultPreset = resolveHikingTimePreset(settings, null);
  const [editedPresetId, setEditedPresetId] = useState(defaultPreset.id);
  const editedPreset = resolveHikingTimePreset(settings, editedPresetId);
  const presets = hikingTimePresets(settings);

  return (
    <Stack spacing={2}>
      <Stack spacing={0.5}>
        <FormControl size="small" sx={{ maxWidth: 320 }}>
          <InputLabel id="hiking-time-default-preset-label">
            <Trans>Default preset</Trans>
          </InputLabel>
          <Select<string>
            labelId="hiking-time-default-preset-label"
            value={defaultPreset.id}
            label={t`Default preset`}
            onChange={(event) => {
              setSettings({ ...settings, defaultPresetId: event.target.value });
            }}
          >
            {presets.map((preset) => (
              <MenuItem key={preset.id} value={preset.id}>
                {hikingTimePresetName(preset, i18n)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="caption" color="text.secondary">
          <Trans>Tracks without their own preset use this one.</Trans>
        </Typography>
      </Stack>
      <FormControl size="small" sx={{ maxWidth: 320 }}>
        <InputLabel id="hiking-time-edited-preset-label">
          <Trans>Edit preset</Trans>
        </InputLabel>
        <Select<string>
          labelId="hiking-time-edited-preset-label"
          value={editedPreset.id}
          label={t`Edit preset`}
          onChange={(event) => {
            setEditedPresetId(event.target.value);
          }}
        >
          {presets.map((preset) => (
            <MenuItem key={preset.id} value={preset.id}>
              {hikingTimePresetName(preset, i18n)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {/* The key restarts the draft whenever another preset is edited. */}
      <HikingTimePresetEditor
        key={editedPreset.id}
        preset={editedPreset}
        settings={settings}
        onSettingsChange={setSettings}
        onEditedPresetChange={setEditedPresetId}
      />
    </Stack>
  );
}

interface HikingTimePresetEditorProps {
  readonly preset: HikingTimePreset;
  readonly settings: HikingTimePresetSettings;
  readonly onSettingsChange: (settings: HikingTimePresetSettings) => void;
  readonly onEditedPresetChange: (presetId: string) => void;
}

function HikingTimePresetEditor({
  preset,
  settings,
  onSettingsChange,
  onEditedPresetChange,
}: HikingTimePresetEditorProps) {
  const { t, i18n } = useLingui();
  const { idGenerator } = useRuntimeServices();
  const [draft, setDraft] = useState(() => parametersDraft(preset.parameters));
  const [nameForm, setNameForm] = useState<NameForm>(null);
  const builtIn = isBuiltInHikingTimePreset(preset.id);
  const parameters = parametersFromDraft(draft);
  const valid = parameters !== null && validHikingTimeParameters(parameters);
  const changed = parameters === null || !sameParameters(parameters, preset.parameters);
  const presetLimitReached =
    settings.custom.length >= MAXIMUM_CUSTOM_HIKING_TIME_PRESETS;
  const { movement, altitudeBands } = draft;
  const presetName = nameForm?.text.trim() ?? '';
  const presetNameValid =
    presetName.length > 0 &&
    presetName.length <= MAXIMUM_HIKING_TIME_PRESET_NAME_LENGTH;

  const changeMovementKind = (kind: MovementKind) => {
    const original = preset.parameters.movement;
    const seed =
      original.kind === kind
        ? original
        : kind === 'din'
          ? dinHikingMovement
          : dayHikeMovement;
    setDraft({ ...draft, movement: movementDraft(seed) });
  };

  const updateKnots = (knots: readonly KnotDraft[]) => {
    setDraft({ ...draft, movement: { kind: 'grade-curve', knots } });
  };

  const updateBands = (bands: readonly BandDraft[]) => {
    setDraft({ ...draft, altitudeBands: bands });
  };

  const saveParameters = () => {
    if (parameters === null) return;
    onSettingsChange({
      ...settings,
      custom: settings.custom.map((value) =>
        value.id === preset.id ? { ...value, parameters } : value,
      ),
    });
  };

  const confirmName = () => {
    if (nameForm === null || !presetNameValid) return;
    if (nameForm.mode === 'rename') {
      onSettingsChange({
        ...settings,
        custom: settings.custom.map((value) =>
          value.id === preset.id ? { ...value, name: presetName } : value,
        ),
      });
      setNameForm(null);
      return;
    }
    if (parameters === null || !valid) return;
    const created: HikingTimePreset = {
      id: `custom:${idGenerator.generate()}`,
      name: presetName,
      parameters,
    };
    onSettingsChange({ ...settings, custom: [...settings.custom, created] });
    onEditedPresetChange(created.id);
  };

  const deletePreset = () => {
    const defaultPresetId =
      settings.defaultPresetId === preset.id
        ? DAY_HIKE_TIME_PRESET_ID
        : settings.defaultPresetId;
    onSettingsChange({
      defaultPresetId,
      custom: settings.custom.filter((value) => value.id !== preset.id),
    });
    onEditedPresetChange(defaultPresetId);
  };

  const handleNameKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') confirmName();
    if (event.key === 'Escape') {
      // Escape leaves the name field without closing the whole settings dialog.
      event.stopPropagation();
      setNameForm(null);
    }
  };

  return (
    <Stack spacing={2}>
      {builtIn ? (
        <Typography variant="caption" color="text.secondary">
          <Trans>Built-in presets can be copied, not changed.</Trans>
        </Typography>
      ) : null}

      <Stack spacing={1}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          <Trans>Movement</Trans>
        </Typography>
        <FormControl size="small" sx={{ maxWidth: 240 }}>
          <InputLabel id="hiking-time-movement-label">
            <Trans>Movement model</Trans>
          </InputLabel>
          <Select<MovementKind>
            labelId="hiking-time-movement-label"
            value={movement.kind}
            label={t`Movement model`}
            onChange={(event) => {
              changeMovementKind(event.target.value);
            }}
          >
            <MenuItem value="din">
              <Trans>DIN 33466 formula</Trans>
            </MenuItem>
            <MenuItem value="grade-curve">
              <Trans>Pace by grade</Trans>
            </MenuItem>
          </Select>
        </FormControl>
        {movement.kind === 'din' ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
            <NumberField
              label={t`Horizontal speed, km/h`}
              value={movement.horizontalKmh}
              step={0.1}
              onChange={(horizontalKmh) => {
                setDraft({ ...draft, movement: { ...movement, horizontalKmh } });
              }}
            />
            <NumberField
              label={t`Ascent, m/h`}
              value={movement.ascentMetersPerHour}
              step={10}
              onChange={(ascentMetersPerHour) => {
                setDraft({ ...draft, movement: { ...movement, ascentMetersPerHour } });
              }}
            />
            <NumberField
              label={t`Descent, m/h`}
              value={movement.descentMetersPerHour}
              step={10}
              onChange={(descentMetersPerHour) => {
                setDraft({ ...draft, movement: { ...movement, descentMetersPerHour } });
              }}
            />
          </Box>
        ) : (
          <Stack spacing={1}>
            <Typography variant="caption" color="text.secondary">
              <Trans>
                Walking speed on each grade; speeds between grades are interpolated.
              </Trans>
            </Typography>
            <RowTable
              headings={[t`Grade, %`, t`Speed, km/h`]}
              rows={movement.knots.map((knot, index) => {
                const row = index + 1;
                return {
                  cells: [
                    <NumberField
                      key="grade"
                      inTable
                      label={t`Row ${row} grade, %`}
                      value={knot.gradePercent}
                      step={1}
                      onChange={(gradePercent) => {
                        updateKnots(
                          replaceRow(movement.knots, index, { ...knot, gradePercent }),
                        );
                      }}
                    />,
                    <NumberField
                      key="speed"
                      inTable
                      label={t`Row ${row} speed, km/h`}
                      value={knot.speedKmh}
                      step={0.1}
                      onChange={(speedKmh) => {
                        updateKnots(
                          replaceRow(movement.knots, index, { ...knot, speedKmh }),
                        );
                      }}
                    />,
                  ],
                  removeLabel: t`Remove grade row ${row}`,
                  removeDisabled: movement.knots.length <= 2,
                  onRemove: () => {
                    updateKnots(
                      movement.knots.filter((_knot, other) => other !== index),
                    );
                  },
                };
              })}
            />
            <Box>
              <Button
                size="small"
                startIcon={<AddIcon />}
                disabled={movement.knots.length >= MAXIMUM_HIKING_PACE_KNOTS}
                onClick={() => {
                  updateKnots([...movement.knots, nextKnot(movement.knots)]);
                }}
              >
                <Trans>Add grade</Trans>
              </Button>
            </Box>
          </Stack>
        )}
      </Stack>

      <Stack spacing={1}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          <Trans>Altitude slowdown</Trans>
        </Typography>
        <Typography variant="caption" color="text.secondary">
          <Trans>
            From each elevation up, moving speed is multiplied by its factor.
          </Trans>
        </Typography>
        {altitudeBands.length > 0 ? (
          <RowTable
            headings={[t`From elevation, m`, t`Speed factor, ×`]}
            rows={altitudeBands.map((band, index) => {
              const row = index + 1;
              return {
                cells: [
                  <NumberField
                    key="elevation"
                    inTable
                    label={t`Band ${row} elevation, m`}
                    value={band.fromMeters}
                    step={100}
                    onChange={(fromMeters) => {
                      updateBands(
                        replaceRow(altitudeBands, index, { ...band, fromMeters }),
                      );
                    }}
                  />,
                  <NumberField
                    key="factor"
                    inTable
                    label={t`Band ${row} speed factor`}
                    value={band.speedFactor}
                    step={0.01}
                    onChange={(speedFactor) => {
                      updateBands(
                        replaceRow(altitudeBands, index, { ...band, speedFactor }),
                      );
                    }}
                  />,
                ],
                removeLabel: t`Remove altitude band ${row}`,
                removeDisabled: false,
                onRemove: () => {
                  updateBands(altitudeBands.filter((_band, other) => other !== index));
                },
              };
            })}
          />
        ) : null}
        <Box>
          <Button
            size="small"
            startIcon={<AddIcon />}
            disabled={altitudeBands.length >= MAXIMUM_HIKING_ALTITUDE_BANDS}
            onClick={() => {
              updateBands([...altitudeBands, nextBand(altitudeBands)]);
            }}
          >
            <Trans>Add altitude band</Trans>
          </Button>
        </Box>
      </Stack>

      <Stack spacing={1}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          <Trans>Breaks and lunch</Trans>
        </Typography>
        <Typography variant="caption" color="text.secondary">
          <Trans>
            Longer routes split into days of this moving time, each with its own lunch.
          </Trans>
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1 }}>
          <NumberField
            label={t`Breaks, min per moving hour`}
            value={draft.breakMinutesPerMovingHour}
            step={1}
            onChange={(breakMinutesPerMovingHour) => {
              setDraft({ ...draft, breakMinutesPerMovingHour });
            }}
          />
          <NumberField
            label={t`Lunch, min`}
            value={draft.lunchMinutes}
            step={5}
            onChange={(lunchMinutes) => {
              setDraft({ ...draft, lunchMinutes });
            }}
          />
          <NumberField
            label={t`Lunch after moving hours`}
            value={draft.lunchMinimumMovingHours}
            step={0.5}
            onChange={(lunchMinimumMovingHours) => {
              setDraft({ ...draft, lunchMinimumMovingHours });
            }}
          />
          <NumberField
            label={t`Moving hours per day`}
            value={draft.movingHoursPerDay}
            step={0.5}
            onChange={(movingHoursPerDay) => {
              setDraft({ ...draft, movingHoursPerDay });
            }}
          />
        </Box>
      </Stack>

      {valid ? null : (
        <Typography variant="caption" color="error" role="alert">
          <Trans>
            Some values are missing or out of range. Grades and elevations must increase
            from row to row.
          </Trans>
        </Typography>
      )}

      {nameForm === null ? (
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {builtIn ? null : (
            <Button
              size="small"
              variant="contained"
              disabled={!changed || !valid}
              onClick={saveParameters}
            >
              <Trans>Save</Trans>
            </Button>
          )}
          <Button
            size="small"
            variant="outlined"
            disabled={!valid || presetLimitReached}
            onClick={() => {
              const sourceName = hikingTimePresetName(preset, i18n);
              const copyName = t`${sourceName} copy`;
              setNameForm({
                mode: 'create',
                text: copyName.slice(0, MAXIMUM_HIKING_TIME_PRESET_NAME_LENGTH),
              });
            }}
          >
            <Trans>Save as new preset</Trans>
          </Button>
          {builtIn ? null : (
            <Button
              size="small"
              onClick={() => {
                setNameForm({ mode: 'rename', text: preset.name });
              }}
            >
              <Trans>Rename</Trans>
            </Button>
          )}
          {builtIn ? null : (
            <Button size="small" color="error" onClick={deletePreset}>
              <Trans>Delete</Trans>
            </Button>
          )}
          <Button
            size="small"
            disabled={!changed}
            onClick={() => {
              setDraft(parametersDraft(preset.parameters));
            }}
          >
            <Trans>Reset</Trans>
          </Button>
        </Stack>
      ) : (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            size="small"
            label={t`Preset name`}
            value={nameForm.text}
            autoFocus
            onChange={(event) => {
              setNameForm({ ...nameForm, text: event.target.value });
            }}
            onKeyDown={handleNameKeyDown}
            slotProps={{
              htmlInput: { maxLength: MAXIMUM_HIKING_TIME_PRESET_NAME_LENGTH },
            }}
            sx={{ flex: 1 }}
          />
          <Button
            size="small"
            variant="contained"
            disabled={!presetNameValid || (nameForm.mode === 'create' && !valid)}
            onClick={confirmName}
          >
            {nameForm.mode === 'create' ? <Trans>Create</Trans> : <Trans>Apply</Trans>}
          </Button>
          <Button
            size="small"
            onClick={() => {
              setNameForm(null);
            }}
          >
            <Trans>Cancel</Trans>
          </Button>
        </Stack>
      )}
    </Stack>
  );
}

interface TableRow {
  readonly cells: readonly [ReactNode, ReactNode];
  readonly removeLabel: string;
  readonly removeDisabled: boolean;
  readonly onRemove: () => void;
}

/** Two numeric columns under visible headings, each row with its remove action. */
function RowTable({
  headings,
  rows,
}: {
  readonly headings: readonly [string, string];
  readonly rows: readonly TableRow[];
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr auto',
        columnGap: 1,
        rowGap: 0.5,
        alignItems: 'center',
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {headings[0]}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {headings[1]}
      </Typography>
      <span />
      {rows.map((row, index) => (
        // Rows have no identity beyond their position; the inputs are controlled.
        <Fragment key={index}>
          {row.cells[0]}
          {row.cells[1]}
          <IconButton
            size="small"
            aria-label={row.removeLabel}
            disabled={row.removeDisabled}
            onClick={row.onRemove}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Fragment>
      ))}
    </Box>
  );
}
