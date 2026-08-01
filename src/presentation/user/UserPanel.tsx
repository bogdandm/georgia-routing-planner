import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  CircularProgress,
  Stack,
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
          type="password"
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
    return (
      <Stack spacing={2} sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Signed in as
        </Typography>
        <Typography>{snapshot.email}</Typography>
        <Typography variant="body2" color="success.main">
          Connected
        </Typography>
        {snapshot.errorMessage === null ? null : (
          <Alert role="alert" severity="error">
            {snapshot.errorMessage}
          </Alert>
        )}
        <Button
          disabled={snapshot.busy}
          onClick={() => {
            void userData.signOut();
          }}
          variant="outlined"
        >
          {snapshot.busy ? 'Signing out…' : 'Sign out'}
        </Button>
      </Stack>
    );
  }
  return <AccountForm snapshot={snapshot} userData={userData} />;
}
