import CheckIcon from '@mui/icons-material/Check';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Tooltip,
} from '@mui/material';
import { useState } from 'react';

import {
  normalizeMarkerName,
  type MarkerColorKey,
  type MarkerIconKey,
  type NormalizedMarkerName,
  type SavedMarker,
} from '@/domain/markers/savedMarker';
import { markerColorCatalog } from '@/presentation/markers/markerCatalog';
import { MarkerIconPicker } from '@/presentation/markers/MarkerIconPicker';
import { appColors } from '@/presentation/theme/appColors';

export interface MarkerAppearance {
  readonly iconKey: MarkerIconKey;
  readonly colorKey: MarkerColorKey;
}

interface MarkerEditorDialogBaseProps {
  readonly open: boolean;
  readonly onCancel: () => void;
}

interface CreateMarkerEditorDialogProps extends MarkerEditorDialogBaseProps {
  readonly mode: 'create';
  readonly initialName: string;
  readonly recentIconKeys: readonly MarkerIconKey[];
  readonly onSubmit: (
    name: NormalizedMarkerName,
    appearance: MarkerAppearance,
  ) => Promise<void>;
}
interface NameOnlyMarkerEditorDialogProps extends MarkerEditorDialogBaseProps {
  readonly mode: 'name-only';
  readonly initialName: string;
  readonly title: 'Create track marker';
  readonly onSubmit: (name: NormalizedMarkerName) => Promise<void>;
}

interface AppearanceMarkerEditorDialogProps extends MarkerEditorDialogBaseProps {
  readonly mode: 'appearance';
  readonly marker: SavedMarker;
  readonly recentIconKeys: readonly MarkerIconKey[];
  readonly onSubmit: (appearance: MarkerAppearance) => Promise<void>;
}

type MarkerEditorDialogProps =
  | CreateMarkerEditorDialogProps
  | NameOnlyMarkerEditorDialogProps
  | AppearanceMarkerEditorDialogProps;

export function MarkerEditorDialog(props: MarkerEditorDialogProps) {
  if (!props.open) return null;
  const key =
    props.mode === 'appearance'
      ? props.marker.id
      : `${props.mode}:${props.initialName}`;
  return <OpenMarkerEditorDialog key={key} {...props} />;
}

function OpenMarkerEditorDialog(props: MarkerEditorDialogProps) {
  const editorMarker = props.mode === 'appearance' ? props.marker : null;
  const initialName =
    props.mode === 'appearance' ? (editorMarker?.name ?? '') : props.initialName;
  const [name, setName] = useState(initialName);
  const [iconKey, setIconKey] = useState<MarkerIconKey>(
    () => editorMarker?.iconKey ?? 'place',
  );
  const [colorKey, setColorKey] = useState<MarkerColorKey>(
    () => editorMarker?.colorKey ?? 'blue',
  );
  const recentIconKeySource = props.mode === 'name-only' ? null : props.recentIconKeys;
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    let normalized: NormalizedMarkerName | undefined;
    if (props.mode !== 'appearance') {
      try {
        normalized = normalizeMarkerName(name);
        setValidationError(null);
      } catch (error) {
        setValidationError(
          error instanceof Error ? error.message : 'The marker name is invalid.',
        );
        return;
      }
    }
    setSaving(true);
    setSubmitError(null);
    try {
      const appearance = { iconKey, colorKey } as const;
      if (props.mode === 'create') {
        if (normalized === undefined) return;
        await props.onSubmit(normalized, appearance);
      } else if (props.mode === 'name-only') {
        if (normalized === undefined) return;
        await props.onSubmit(normalized);
      } else {
        await props.onSubmit(appearance);
      }
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'The marker could not be saved.',
      );
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      aria-labelledby="marker-editor-title"
      maxWidth="xs"
      fullWidth
      onClose={saving ? undefined : props.onCancel}
    >
      <DialogTitle id="marker-editor-title">
        {props.mode === 'create'
          ? 'Create marker'
          : props.mode === 'name-only'
            ? props.title
            : 'Marker appearance'}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {props.mode !== 'appearance' ? (
            <TextField
              autoFocus
              label="Marker name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setValidationError(null);
                setSubmitError(null);
              }}
              error={validationError !== null}
              helperText={validationError}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
          ) : null}
          {submitError !== null ? <Alert severity="error">{submitError}</Alert> : null}
          {props.mode === 'name-only' ? null : (
            <Stack spacing={1}>
              <MarkerIconPicker
                value={iconKey}
                recentIconKeys={recentIconKeySource ?? []}
                label="Choose marker icon"
                onChange={(selected) => {
                  if (selected === 'folder') return;
                  setIconKey(selected);
                  setSubmitError(null);
                }}
              />
              <Box
                role="group"
                aria-label="Marker color"
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 0.5,
                  justifyContent: 'flex-start',
                }}
              >
                {markerColorCatalog.map((color) => {
                  const selected = color.key === colorKey;
                  return (
                    <Tooltip key={color.key} title={color.label}>
                      <IconButton
                        aria-label={`Choose ${color.key} marker color`}
                        aria-pressed={selected}
                        size="small"
                        onClick={() => {
                          setColorKey(color.key);
                          setSubmitError(null);
                        }}
                        sx={{ width: 26, height: 26, p: 0.25 }}
                      >
                        <Box
                          aria-hidden
                          sx={{
                            display: 'grid',
                            placeItems: 'center',
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            bgcolor: color.value,
                            border: '1px solid',
                            borderColor: 'common.white',
                            boxShadow: selected
                              ? `0 0 0 2px ${appColors.surface.panel}, 0 0 0 4px ${color.value}`
                              : `0 0 0 1px color-mix(in srgb, ${color.value}, transparent 25%)`,
                          }}
                        >
                          {selected ? (
                            <CheckIcon sx={{ color: 'common.white', fontSize: 14 }} />
                          ) : null}
                        </Box>
                      </IconButton>
                    </Tooltip>
                  );
                })}
              </Box>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={saving} variant="contained">
          {props.mode === 'appearance' ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
