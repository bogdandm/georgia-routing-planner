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
  normalizeTrackFolderName,
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
    folder?.iconKey ?? 'folder',
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const save = async () => {
    try {
      const normalized = normalizeTrackFolderName(name);
      setSaving(true);
      setError(null);
      await onSave(normalized.name, iconKey);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : t`The folder could not be saved.`,
      );
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    if (onDelete === undefined) return;
    setSaving(true);
    setError(null);
    try {
      await onDelete();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : t`The folder could not be deleted.`,
      );
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
            error={error !== null}
            helperText={error}
            slotProps={{ htmlInput: { maxLength: 200 } }}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
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
              setError(null);
            }}
          />
          {error === null ? null : <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions
        sx={{ justifyContent: folder === null ? 'flex-end' : 'space-between' }}
      >
        {folder === null ? null : (
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
