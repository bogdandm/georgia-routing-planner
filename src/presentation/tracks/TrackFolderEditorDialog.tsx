import { Trans, useLingui } from '@lingui/react/macro';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  useMediaQuery,
} from '@mui/material';
import { useState } from 'react';

import {
  TrackFolderNameError,
  type TrackFolder,
  type TrackFolderIconKey,
} from '@/domain/tracks/trackFolder';
import {
  MarkerIconPicker,
  type SelectableIconKey,
} from '@/presentation/markers/MarkerIconPicker';

interface TrackFolderEditorDialogProps {
  readonly open: boolean;
  readonly folder: TrackFolder | null;
  readonly onCancel: () => void;
  readonly onSave: (name: string, iconKey: TrackFolderIconKey) => Promise<void>;
  /** Omitted for folders that cannot be deleted, such as Imports. */
  readonly onDelete?: () => Promise<void>;
}

export function TrackFolderEditorDialog(props: TrackFolderEditorDialogProps) {
  if (!props.open) return null;
  return (
    <OpenTrackFolderEditorDialog key={props.folder?.id ?? 'create-folder'} {...props} />
  );
}

function OpenTrackFolderEditorDialog({
  folder,
  onCancel,
  onSave,
  onDelete,
}: TrackFolderEditorDialogProps) {
  const { t } = useLingui();
  const compact = useMediaQuery('(width < 900px)');
  const [name, setName] = useState(folder?.name ?? '');
  const [iconKey, setIconKey] = useState<TrackFolderIconKey>(
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Folder icon key.
    folder?.iconKey ?? 'folder',
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const nameProblemMessages = {
    required: t`Enter a folder name.`,
    'too-long': t`Folder names must be 200 characters or fewer.`,
    'invalid-character': t`The folder name contains unsupported characters.`,
  } as const;

  const save = async () => {
    setSaving(true);
    setSubmitError(null);
    try {
      await onSave(name, iconKey);
    } catch (failure) {
      if (failure instanceof TrackFolderNameError) {
        setValidationError(nameProblemMessages[failure.problem]);
      } else {
        setSubmitError(t`The folder could not be saved.`);
      }
      setSaving(false);
    }
  };

  const remove = async () => {
    if (onDelete === undefined) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setSaving(true);
    setSubmitError(null);
    try {
      await onDelete();
    } catch {
      setSubmitError(t`The folder could not be deleted.`);
      setSaving(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <Dialog
      open
      fullScreen={compact}
      fullWidth
      maxWidth="xs"
      aria-labelledby="track-folder-editor-title"
      onClose={saving ? undefined : onCancel}
    >
      <DialogTitle id="track-folder-editor-title">
        {folder === null ? <Trans>Create folder</Trans> : <Trans>Edit folder</Trans>}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <TextField
            autoFocus
            fullWidth
            label={t`Folder name`}
            value={name}
            disabled={saving}
            error={validationError !== null}
            helperText={validationError}
            slotProps={{ htmlInput: { maxLength: 200 } }}
            onChange={(event) => {
              setName(event.target.value);
              setValidationError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
            }}
          />
          <MarkerIconPicker
            value={iconKey}
            recentIconKeys={[]}
            allowFolder
            label={t`Choose folder icon`}
            disabled={saving}
            onChange={(selected: SelectableIconKey) => {
              setIconKey(selected);
              setSubmitError(null);
            }}
          />
          {submitError === null ? null : <Alert severity="error">{submitError}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions
        sx={{ justifyContent: onDelete === undefined ? 'flex-end' : 'space-between' }}
      >
        {onDelete === undefined ? null : (
          <Button
            color="error"
            disabled={saving}
            startIcon={<DeleteOutlineOutlinedIcon />}
            onClick={() => void remove()}
          >
            {confirmingDelete ? (
              <Trans>Confirm delete</Trans>
            ) : (
              <Trans>Delete folder</Trans>
            )}
          </Button>
        )}
        <Stack direction="row" spacing={1}>
          <Button disabled={saving} onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
          <Button disabled={saving} variant="contained" onClick={() => void save()}>
            <Trans>Save</Trans>
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
