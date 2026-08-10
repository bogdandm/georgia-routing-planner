import { describe, expect, it } from 'vitest';

import { WorkerRpcServer } from '@/infrastructure/runtime/WorkerRpc';
import {
  trackSyncWorkerEventNames,
  trackSyncWorkerMethods,
  TrackSyncWorkerClient,
} from '@/infrastructure/supabase/TrackSyncWorkerClient';
import { createMemoryWorkerRpcEndpointPair } from '@test/helpers/MemoryWorkerRpcEndpoint';

describe('TrackSyncWorkerClient', () => {
  it('forwards only valid synchronization progress events', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const server = new WorkerRpcServer(serverEndpoint, {});
    const client = new TrackSyncWorkerClient(() => clientEndpoint);
    const received: { completedItems: number; totalItems: number }[] = [];
    client.subscribeProgress((progress) => received.push(progress));

    server.publishEvent(trackSyncWorkerEventNames.progress, {
      completedItems: 1,
      totalItems: 3,
    });
    server.publishEvent(trackSyncWorkerEventNames.progress, {
      completedItems: 4,
      totalItems: 3,
    });
    server.publishEvent(trackSyncWorkerEventNames.progress, {
      completedItems: 1.5,
      totalItems: 3,
    });

    await expect.poll(() => received).toEqual([{ completedItems: 1, totalItems: 3 }]);
    client.dispose();
    server.dispose();
  });

  it('forwards identity, session revision, and token in synchronization requests', async () => {
    const [clientEndpoint, serverEndpoint] = createMemoryWorkerRpcEndpointPair();
    const server = new WorkerRpcServer(serverEndpoint, {
      [trackSyncWorkerMethods.synchronize]: (payload) => {
        expect(payload).toEqual({
          userId: 'user-id',
          accessToken: 'access-token',
          sessionRevision: 3,
        });
        return {
          usage: { usedBytes: 0, reservedBytes: 0, limitBytes: 8_388_608 },
          changed: { tracks: false, markers: false },
          remoteTrackDeletions: [],
          remoteMarkerDeletions: [],
        };
      },
    });
    const client = new TrackSyncWorkerClient(() => clientEndpoint);

    await expect(
      client.synchronize('user-id', 'access-token', 3, new AbortController().signal),
    ).resolves.toMatchObject({ changed: { tracks: false, markers: false } });

    client.dispose();
    server.dispose();
  });
});
