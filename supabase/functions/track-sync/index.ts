import { withSupabase } from 'npm:@supabase/server@1.4.1';

import { handleTrackSync } from './track-sync.ts';

export default {
  fetch: withSupabase({ auth: 'user' }, handleTrackSync),
};
