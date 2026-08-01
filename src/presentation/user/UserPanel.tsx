import {
  Alert,
  Box,
  Button,
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

import type { UserDataService } from '@/application/user/UserDataService';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';

function useUserDataSnapshot(userData: UserDataService) {
  const subscribe = useCallback(
    (listener: () => void) => userData.subscribe(listener),
    [userData],
  );
  const getSnapshot = useCallback(() => userData.getSnapshot(), [userData]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function UserPanel() {
  const { userData } = useRuntimeServices();
  const snapshot = useUserDataSnapshot(userData);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    await userData.signIn(email, password);
    setPassword('');
  };

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

  return (
    <Box component="form" noValidate={false} onSubmit={handleSubmit} sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          Sign in to your account.
        </Typography>
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
          autoComplete="current-password"
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
          {snapshot.busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </Stack>
    </Box>
  );
}
