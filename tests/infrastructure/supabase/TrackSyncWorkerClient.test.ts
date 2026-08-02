import { describe, expect, it } from 'vitest';

import { WorkerRpcServer } from '@/infrastructure/runtime/WorkerRpc';
import {
  trackSyncWorkerEventNames,
  trackSyncWorkerMethods,
  TrackSyncWorkerClient,
} from '@/infrastructure/supabase/TrackSyncWorkerClient';
import { createMemoryWorkerRpcEndpointPair } from '@test/helpers/MemoryWorkerRpcEndpoint';

describe('TrackSyncWorkerClient', () => {
  it('forwards only valid track synchronization progress events', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const server = new WorkerRpcServer(serverEndpoint, {});
    const client = new TrackSyncWorkerClient(() => clientEndpoint);
    const received: { completedTracks: number; totalTracks: number }[] = [];
    client.subscribeProgress((progress) => received.push(progress));

    server.publishEvent(trackSyncWorkerEventNames.progress, {
      completedTracks: 1,
      totalTracks: 3,
    });
    server.publishEvent(trackSyncWorkerEventNames.progress, {
      completedTracks: 4,
      totalTracks: 3,
    });
    server.publishEvent(trackSyncWorkerEventNames.progress, {
      completedTracks: 1.5,
      totalTracks: 3,
    });

    await expect.poll(() => received).toEqual([{ completedTracks: 1, totalTracks: 3 }]);
    client.dispose();
    server.dispose();
  });

  it('forwards the account identity and token in the synchronization request', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const server = new WorkerRpcServer(serverEndpoint, {
      [trackSyncWorkerMethods.synchronize]: (payload) => {
        expect(payload).toEqual({
          userId: 'user-id',
          accessToken: 'access-token',
        });
        return {
          usage: { usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 },
          changed: false,
          remoteTrackDeletions: [],
        };
      },
    });
    const client = new TrackSyncWorkerClient(() => clientEndpoint);

    await expect(
      client.synchronize('user-id', 'access-token', new AbortController().signal),
    ).resolves.toMatchObject({ changed: false });

    client.dispose();
    server.dispose();
  });
});
