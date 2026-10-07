import { Trans, useLingui } from '@lingui/react/macro';
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
  useMemo,
  useState,
  useSyncExternalStore,
  type SyntheticEvent,
} from 'react';

import type {
  UserDataService,
  UserDataSnapshot,
} from '@/application/user/UserDataService';
import { useRuntimeServices } from '@/bootstrap/RuntimeServicesProvider';
import { appColors } from '@/presentation/theme/appColors';
import {
  userDataNoticeMessage,
  userDataProblemMessage,
} from '@/presentation/user/userDataMessages';

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
  const { i18n, t } = useLingui();
  const [email, setEmail] = useState('');
  // eslint-disable-next-line lingui/no-unlocalized-strings -- AccountMode value.
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
        <ButtonGroup aria-label={t`Account mode`} fullWidth>
          <Button
            aria-pressed={!isSignUp}
            onClick={() => {
              // eslint-disable-next-line lingui/no-unlocalized-strings -- AccountMode value.
              setMode('sign-in');
            }}
            variant={!isSignUp ? 'contained' : 'outlined'}
          >
            <Trans>Sign in</Trans>
          </Button>
          <Button
            aria-pressed={isSignUp}
            onClick={() => {
              // eslint-disable-next-line lingui/no-unlocalized-strings -- AccountMode value.
              setMode('sign-up');
            }}
            variant={isSignUp ? 'contained' : 'outlined'}
          >
            <Trans>Create account</Trans>
          </Button>
        </ButtonGroup>
        <Typography variant="body2" color="text.secondary">
          {isSignUp ? (
            <Trans>Create an account to confirm your email address.</Trans>
          ) : (
            <Trans>Sign in to your account.</Trans>
          )}
        </Typography>
        {snapshot.notice === null ? null : (
          <Alert aria-live="polite" role="status" severity="info">
            {i18n._(userDataNoticeMessage(snapshot.notice))}
          </Alert>
        )}
        {snapshot.problem === null ? null : (
          <Alert aria-live="assertive" role="alert" severity="error">
            {i18n._(userDataProblemMessage(snapshot.problem))}
          </Alert>
        )}
        <TextField
          // eslint-disable-next-line lingui/no-unlocalized-strings -- HTML autocomplete token.
          autoComplete="email"
          disabled={snapshot.busy}
          label={t`Email`}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          required
          type="email"
          value={email}
        />
        <TextField
          // eslint-disable-next-line lingui/no-unlocalized-strings -- HTML autocomplete tokens.
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          disabled={snapshot.busy}
          label={t`Password`}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          required
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={passwordVisible ? t`Hide password` : t`Show password`}
                    disabled={snapshot.busy}
                    // eslint-disable-next-line lingui/no-unlocalized-strings -- MUI placement token.
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
              ? t`Creating account…`
              : t`Signing in…`
            : isSignUp
              ? t`Create account`
              : t`Sign in`}
        </Button>
      </Stack>
    </Box>
  );
}

export function UserPanel() {
  const { i18n, t } = useLingui();
  const { userData } = useRuntimeServices();
  const snapshot = useUserDataSnapshot(userData);
  const quotaFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [i18n.locale],
  );
  const countFormatter = useMemo(
    () => new Intl.NumberFormat(i18n.locale),
    [i18n.locale],
  );

  if (snapshot.status === 'unconfigured') {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="info">
          <Trans>
            Account features are not configured. Your tracks remain stored locally in
            this browser.
          </Trans>
        </Alert>
      </Box>
    );
  }
  if (snapshot.status === 'loading') {
    return (
      <Stack role="status" spacing={1} sx={{ alignItems: 'center', p: 3 }}>
        <CircularProgress size={24} />
        <Typography>
          <Trans>Restoring account session…</Trans>
        </Typography>
      </Stack>
    );
  }
  if (snapshot.status === 'signed-in') {
    const usedMiB = quotaFormatter.format(snapshot.syncUsage.usedBytes / 1_048_576);
    const reservedMiB = quotaFormatter.format(
      snapshot.syncUsage.reservedBytes / 1_048_576,
    );
    const limitMiB = quotaFormatter.format(snapshot.syncUsage.limitBytes / 1_048_576);
    const progress = Math.min(
      100,
      ((snapshot.syncUsage.usedBytes + snapshot.syncUsage.reservedBytes) /
        snapshot.syncUsage.limitBytes) *
        100,
    );
    let syncStatus: string;
    if (snapshot.syncStatus === 'syncing') {
      syncStatus =
        snapshot.syncProgress !== null && snapshot.syncProgress.totalItems > 0
          ? t`Synchronizing… ${countFormatter.format(snapshot.syncProgress.completedItems)}/${countFormatter.format(snapshot.syncProgress.totalItems)}`
          : t`Synchronizing…`;
    } else if (snapshot.syncStatus === 'error') {
      syncStatus = t`Synchronization needs attention`;
    } else if (snapshot.syncStatus === 'needs-action') {
      syncStatus = t`Synchronization needs your decision`;
    } else {
      syncStatus = t`Connected`;
    }
    return (
      <Stack spacing={2} sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          <Trans>Signed in as</Trans>
        </Typography>
        <Typography>{snapshot.email ?? t`Email unavailable`}</Typography>
        {snapshot.userId === null ? null : (
          <Stack spacing={0.25}>
            <Typography variant="body2" color="text.secondary">
              <Trans>User ID</Trans>
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
              disabled={
                snapshot.syncStatus === 'needs-action' ||
                (snapshot.busy && snapshot.syncStatus !== 'syncing')
              }
              onChange={(_, checked) => {
                void userData.setSyncEnabled(checked);
              }}
            />
          }
          label={t`Sync across devices`}
        />
        {snapshot.syncEnabled ? (
          <Stack spacing={0.5}>
            <Typography
              color={
                snapshot.syncStatus === 'error'
                  ? 'error.main'
                  : snapshot.syncStatus === 'needs-action'
                    ? appColors.brand.tigerOrange
                    : 'text.secondary'
              }
              variant="body2"
            >
              {syncStatus}
            </Typography>
            <Typography variant="body2">
              <Trans>
                {usedMiB} MiB / {limitMiB} MiB
              </Trans>
              {snapshot.syncUsage.reservedBytes > 0 ? (
                <>
                  {' '}
                  <Trans>({reservedMiB} MiB reserved)</Trans>
                </>
              ) : null}
            </Typography>
            <LinearProgress
              aria-label={t`Cloud track quota`}
              variant="determinate"
              value={progress}
            />
          </Stack>
        ) : null}
        <Button
          disabled={
            !snapshot.syncEnabled ||
            snapshot.busy ||
            snapshot.syncStatus === 'syncing' ||
            snapshot.syncStatus === 'needs-action'
          }
          onClick={() => {
            void userData.synchronizeNow();
          }}
          variant="outlined"
        >
          <Trans>Sync now</Trans>
        </Button>
        {snapshot.problem === null ? null : (
          <Alert role="alert" severity="error">
            {i18n._(userDataProblemMessage(snapshot.problem))}
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
            ? t`Signing out…`
            : t`Sign out`}
        </Button>
      </Stack>
    );
  }
  return <AccountForm snapshot={snapshot} userData={userData} />;
}
