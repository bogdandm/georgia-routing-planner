import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
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
  MarkerNameError,
  normalizeMarkerName,
  type MarkerColorKey,
  type MarkerIconKey,
  type MarkerNameProblem,
  type NormalizedMarkerName,
  type SavedMarker,
} from '@/domain/markers/savedMarker';
import { markerColorCatalog } from '@/presentation/markers/markerCatalog';
import { MarkerIconPicker } from '@/presentation/markers/MarkerIconPicker';
import { appColors } from '@/presentation/theme/appColors';

/** Localized explanations for rejected marker names; shared with inline rename. */
// eslint-disable-next-line react-refresh/only-export-components
export const markerNameProblemMessages: Readonly<
  Record<MarkerNameProblem, MessageDescriptor>
> = {
  required: msg`Enter a marker name.`,
  'too-long': msg`Marker names must be 200 characters or fewer.`,
  'invalid-character': msg`The marker name contains unsupported characters.`,
};

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
/** Track-marker naming: the track owns position and appearance. */
interface NameOnlyMarkerEditorDialogProps extends MarkerEditorDialogBaseProps {
  readonly mode: 'name-only';
  readonly initialName: string;
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
  const { i18n, t } = useLingui();
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
  const [nameProblem, setNameProblem] = useState<MarkerNameProblem | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    let normalized: NormalizedMarkerName | undefined;
    if (props.mode !== 'appearance') {
      try {
        normalized = normalizeMarkerName(name);
        setNameProblem(null);
      } catch (error) {
        if (!(error instanceof MarkerNameError)) throw error;
        setNameProblem(error.problem);
        return;
      }
    }
    setSaving(true);
    setSubmitFailed(false);
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
    } catch {
      setSubmitFailed(true);
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Element ID.
      aria-labelledby="marker-editor-title"
      maxWidth="xs"
      fullWidth
      onClose={saving ? undefined : props.onCancel}
    >
      <DialogTitle id="marker-editor-title">
        {props.mode === 'create' ? (
          <Trans>Create marker</Trans>
        ) : props.mode === 'name-only' ? (
          <Trans>Create track marker</Trans>
        ) : (
          <Trans>Marker appearance</Trans>
        )}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {props.mode !== 'appearance' ? (
            <TextField
              autoFocus
              label={t`Marker name`}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameProblem(null);
                setSubmitFailed(false);
              }}
              error={nameProblem !== null}
              helperText={
                nameProblem === null
                  ? null
                  : i18n._(markerNameProblemMessages[nameProblem])
              }
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
          ) : null}
          {submitFailed ? (
            <Alert severity="error">
              <Trans>The marker could not be saved.</Trans>
            </Alert>
          ) : null}
          {props.mode === 'name-only' ? null : (
            <Stack spacing={1}>
              <MarkerIconPicker
                value={iconKey}
                recentIconKeys={recentIconKeySource ?? []}
                label={t`Choose marker icon`}
                onChange={(selected) => {
                  if (selected === 'folder') return;
                  setIconKey(selected);
                  setSubmitFailed(false);
                }}
              />
              <Box
                role="group"
                aria-label={t`Marker color`}
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 0.5,
                  justifyContent: 'flex-start',
                }}
              >
                {markerColorCatalog.map((color) => {
                  const selected = color.key === colorKey;
                  const colorLabel = i18n._(color.labelMessage);
                  return (
                    <Tooltip key={color.key} title={colorLabel}>
                      <IconButton
                        aria-label={t`Choose ${colorLabel} marker color`}
                        aria-pressed={selected}
                        size="small"
                        onClick={() => {
                          setColorKey(color.key);
                          setSubmitFailed(false);
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
          <Trans>Cancel</Trans>
        </Button>
        <Button onClick={() => void submit()} disabled={saving} variant="contained">
          {props.mode === 'appearance' ? <Trans>Save</Trans> : <Trans>Create</Trans>}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
