import type { SupabaseContext } from 'npm:@supabase/server@1.4.1';

import { TrackSyncFailure } from './internal/contracts.ts';
import {
  createTrackSyncResponse,
  parseTrackSyncRequest,
  requireUserId,
} from './internal/http.ts';
import { TrackSyncService } from './internal/track-sync-service.ts';

export async function handleTrackSync(
  request: Request,
  context: SupabaseContext,
): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      throw new TrackSyncFailure(405, 'method_not_allowed', 'Only POST is supported.');
    }
    const userId = requireUserId(context);
    const command = await parseTrackSyncRequest(request);
    const result = await new TrackSyncService(context, userId).execute(command);
    return createTrackSyncResponse(result);
  } catch (error) {
    if (error instanceof TrackSyncFailure) return createTrackSyncResponse(error);
    console.error(
      'track-sync failed',
      error instanceof Error ? error.message : 'unknown error',
    );
    return createTrackSyncResponse(
      new TrackSyncFailure(500, 'internal_error', 'Track synchronization failed.'),
    );
  }
}
