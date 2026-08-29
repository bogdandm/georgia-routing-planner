import { execFileSync } from 'node:child_process';

function localStackIsActive(): boolean {
  try {
    execFileSync('supabase', ['status', '--output', 'json'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const startedByRunner = !localStackIsActive();
let startedStack = false;

try {
  if (startedByRunner) {
    execFileSync('supabase', ['start'], { stdio: 'inherit' });
    startedStack = true;
  } else {
    execFileSync('supabase', ['db', 'reset'], { stdio: 'inherit' });
  }
  execFileSync(
    'supabase',
    ['test', 'db', 'supabase/tests/database/track_share.test.sql'],
    {
      stdio: 'inherit',
    },
  );
} finally {
  if (startedStack) {
    execFileSync('supabase', ['stop', '--no-backup'], { stdio: 'inherit' });
  }
}
