import { withSupabase } from 'npm:@supabase/server@1.4.1';

import { handleTrackShare } from './track-share.ts';

export default {
  fetch: withSupabase(
    {
      auth: ['user', 'publishable'],
      cors: {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers':
            'authorization, x-client-info, apikey, content-type, x-retry-count, x-track-share-token',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
      },
    },
    handleTrackShare,
  ),
};
