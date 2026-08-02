import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  CircularProgress,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import {
  useCallback,
  useState,
  useSyncExternalStore,
  type SyntheticEvent,
} from 'react';

import type {
  UserDataService,
  UserDataSnapshot,
} from '@/application/user/UserDataService';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';

type AccountMode = 'sign-in' | 'sign-up';

function useUserDataSnapshot(userData: UserDataService) {
  const subscribe = useCallback(
    (listener: () => void) => userData.subscribe(listener),
    [userData],
  );
  const getSnapshot = useCallback(() => userData.getSnapshot(), [userData]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function AccountForm({
  snapshot,
  userData,
}: {
  readonly snapshot: UserDataSnapshot;
  readonly userData: UserDataService;
}) {
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState<AccountMode>('sign-in');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isSignUp = mode === 'sign-up';

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    const submittedPassword = password;
    setPassword('');
    if (isSignUp) await userData.signUp(email, submittedPassword);
    else await userData.signIn(email, submittedPassword);
  };

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ p: 2 }}>
      <Stack spacing={2}>
        <ButtonGroup aria-label="Account mode" fullWidth>
          <Button
            aria-pressed={!isSignUp}
            onClick={() => {
              setMode('sign-in');
            }}
            variant={!isSignUp ? 'contained' : 'outlined'}
          >
            Sign in
          </Button>
          <Button
            aria-pressed={isSignUp}
            onClick={() => {
              setMode('sign-up');
            }}
            variant={isSignUp ? 'contained' : 'outlined'}
          >
            Create account
          </Button>
        </ButtonGroup>
        <Typography variant="body2" color="text.secondary">
          {isSignUp
            ? 'Create an account to confirm your email address.'
            : 'Sign in to your account.'}
        </Typography>
        {snapshot.noticeMessage === null ? null : (
          <Alert aria-live="polite" role="status" severity="info">
            {snapshot.noticeMessage}
          </Alert>
        )}
        {snapshot.errorMessage === null ? null : (
          <Alert aria-live="assertive" role="alert" severity="error">
            {snapshot.errorMessage}
          </Alert>
        )}
        <TextField
          autoComplete="email"
          disabled={snapshot.busy}
          label="Email"
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          required
          type="email"
          value={email}
        />
        <TextField
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          disabled={snapshot.busy}
          label="Password"
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          required
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                    disabled={snapshot.busy}
                    edge="end"
                    onClick={() => {
                      setPasswordVisible((visible) => !visible);
                    }}
                    size="small"
                    type="button"
                  >
                    {passwordVisible ? (
                      <VisibilityOffOutlinedIcon fontSize="small" />
                    ) : (
                      <VisibilityOutlinedIcon fontSize="small" />
                    )}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
          type={passwordVisible ? 'text' : 'password'}
          value={password}
        />
        <Button disabled={snapshot.busy} type="submit" variant="contained">
          {snapshot.busy
            ? isSignUp
              ? 'Creating account…'
              : 'Signing in…'
            : isSignUp
              ? 'Create account'
              : 'Sign in'}
        </Button>
      </Stack>
    </Box>
  );
}

export function UserPanel() {
  const { userData } = useRuntimeServices();
  const snapshot = useUserDataSnapshot(userData);

  if (snapshot.status === 'unconfigured') {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="info">
          Account features are not configured. Your tracks remain stored locally in this
          browser.
        </Alert>
      </Box>
    );
  }
  if (snapshot.status === 'loading') {
    return (
      <Stack role="status" spacing={1} sx={{ alignItems: 'center', p: 3 }}>
        <CircularProgress size={24} />
        <Typography>Restoring account session…</Typography>
      </Stack>
    );
  }
  if (snapshot.email !== null) {
    const usedMiB = snapshot.syncUsage.usedBytes / (1024 * 1024);
    const reservedMiB = snapshot.syncUsage.reservedBytes / (1024 * 1024);
    const progress = Math.min(
      100,
      ((snapshot.syncUsage.usedBytes + snapshot.syncUsage.reservedBytes) /
        snapshot.syncUsage.limitBytes) *
        100,
    );
    return (
      <Stack spacing={2} sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Signed in as
        </Typography>
        <Typography>{snapshot.email}</Typography>
        {snapshot.userId === null ? null : (
          <Stack spacing={0.25}>
            <Typography variant="body2" color="text.secondary">
              User ID
            </Typography>
            <Typography
              sx={{ userSelect: 'text', wordBreak: 'break-all' }}
              variant="body2"
            >
              {snapshot.userId}
            </Typography>
          </Stack>
        )}
        <FormControlLabel
          control={
            <Switch
              checked={snapshot.syncEnabled}
              disabled={snapshot.busy && snapshot.syncStatus !== 'syncing'}
              onChange={(_, checked) => {
                void userData.setSyncEnabled(checked);
              }}
            />
          }
          label="Sync across devices"
        />
        {snapshot.syncEnabled ? (
          <Stack spacing={0.5}>
            <Typography
              color={snapshot.syncStatus === 'error' ? 'error.main' : 'text.secondary'}
              variant="body2"
            >
              {snapshot.syncStatus === 'syncing'
                ? snapshot.syncProgress !== null &&
                  snapshot.syncProgress.totalTracks > 0
                  ? `Synchronizing… ${snapshot.syncProgress.completedTracks.toString()}/${snapshot.syncProgress.totalTracks.toString()}`
                  : 'Synchronizing…'
                : snapshot.syncStatus === 'error'
                  ? 'Synchronization needs attention'
                  : 'Connected'}
            </Typography>
            <Typography variant="body2">
              {usedMiB.toFixed(2)} MiB / 8 MiB
              {reservedMiB > 0 ? ` (${reservedMiB.toFixed(2)} MiB reserved)` : ''}
            </Typography>
            <LinearProgress
              aria-label="Cloud track quota"
              variant="determinate"
              value={progress}
            />
          </Stack>
        ) : null}
        <Button
          disabled={
            !snapshot.syncEnabled || snapshot.busy || snapshot.syncStatus === 'syncing'
          }
          onClick={() => {
            void userData.synchronizeNow();
          }}
          variant="outlined"
        >
          Sync now
        </Button>
        {snapshot.errorMessage === null ? null : (
          <Alert role="alert" severity="error">
            {snapshot.errorMessage}
          </Alert>
        )}
        <Button
          disabled={snapshot.busy && snapshot.syncStatus !== 'syncing'}
          onClick={() => {
            void userData.signOut();
          }}
          variant="outlined"
        >
          {snapshot.busy && snapshot.syncStatus !== 'syncing'
            ? 'Signing out…'
            : 'Sign out'}
        </Button>
      </Stack>
    );
  }
  return <AccountForm snapshot={snapshot} userData={userData} />;
}
