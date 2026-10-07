import { Trans, useLingui } from '@lingui/react/macro';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { useRef, useState } from 'react';

import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import {
  createUserDataArchive,
  restoreUserDataArchive,
} from '@/infrastructure/persistence/userDataArchive';
import { downloadFile } from '@/presentation/downloadFile';

/** Exports all local user data to a `.tar.gz` archive and restores it from one. */
export function UserDataBackupSection() {
  const { t } = useLingui();
  const { clock, database, trackContentHasher } = useRuntimeServices();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportData = async () => {
    setBusy(true);
    setError(null);
    try {
      const exportedAt = clock.now();
      const archive = await createUserDataArchive(database, exportedAt);
      downloadFile(
        // eslint-disable-next-line lingui/no-unlocalized-strings -- Archive filename.
        `trail-planner-data-${exportedAt.toISOString().slice(0, 10)}.tar.gz`,
        // eslint-disable-next-line lingui/no-unlocalized-strings -- MIME type.
        'application/gzip',
        archive,
      );
    } catch {
      setError(t`Data could not be exported.`);
    } finally {
      setBusy(false);
    }
  };

  const importData = async (file: File) => {
    setSelectedFile(null);
    setBusy(true);
    setError(null);
    try {
      await restoreUserDataArchive(
        database,
        trackContentHasher,
        new Uint8Array(await file.arrayBuffer()),
      );
    } catch {
      setError(t`Data could not be imported from this file. Nothing was changed.`);
      setBusy(false);
      return;
    }
    // Features read persisted data when they start, so a reload shows the restored data.
    globalThis.location.reload();
  };

  return (
    <Box component="section" aria-labelledby="user-data-backup-heading" sx={{ p: 2 }}>
      <Typography id="user-data-backup-heading" component="h3" variant="subtitle2">
        <Trans>Data</Trans>
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mt: 0.5 }}
      >
        <Trans>Tracks as GPX files, with track metadata, markers, and settings.</Trans>
      </Typography>
      <Stack spacing={1} sx={{ mt: 1 }}>
        <Button
          disabled={busy}
          onClick={() => void exportData()}
          startIcon={<DownloadOutlinedIcon />}
          variant="outlined"
        >
          <Trans>Export data as gzip</Trans>
        </Button>
        <Button
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          startIcon={<UploadFileOutlinedIcon />}
          variant="outlined"
        >
          <Trans>Import data from gzip</Trans>
        </Button>
        <input
          ref={fileInput}
          hidden
          type="file"
          accept=".gz,.tgz,application/gzip"
          aria-label={t`Data archive`}
          onChange={(event) => {
            setSelectedFile(event.target.files?.[0] ?? null);
            event.target.value = '';
          }}
        />
        {error === null ? null : (
          <Alert role="alert" severity="error">
            {error}
          </Alert>
        )}
      </Stack>
      <Dialog
        open={selectedFile !== null}
        fullWidth
        maxWidth="xs"
        aria-labelledby="user-data-import-title"
        onClose={() => {
          setSelectedFile(null);
        }}
      >
        <DialogTitle id="user-data-import-title">
          <Trans>Import data?</Trans>
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            <Trans>
              Tracks, folders, and markers from the archive replace items with the same
              ID; other items stay. Settings are replaced by the archived settings. The
              page reloads afterward.
            </Trans>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setSelectedFile(null);
            }}
          >
            <Trans>Cancel</Trans>
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              if (selectedFile !== null) void importData(selectedFile);
            }}
          >
            <Trans>Import</Trans>
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
