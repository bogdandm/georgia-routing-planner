import type { SupabaseContext } from 'npm:@supabase/server@1.4.1';

import type {
  DeleteMarkerCommand,
  DeleteTrackCommand,
  MetadataTrackCommand,
  RpcResponse,
  TrackSyncCommand,
  TrackSyncResult,
  UpsertMarkerCommand,
  UploadTrackCommand,
} from './contracts.ts';
import { TrackSyncFailure } from './contracts.ts';
import { SupabaseTrackSyncGateway } from './supabase-track-sync-gateway.ts';

export class TrackSyncService {
  constructor(context: SupabaseContext, userId: string) {
    this.gateway = new SupabaseTrackSyncGateway(context, userId);
  }

  async execute(command: TrackSyncCommand): Promise<TrackSyncResult> {
    switch (command.action) {
      case 'upload':
        return await this.upload(command);
      case 'metadata':
        return await this.metadata(command);
      case 'delete':
        return await this.delete(command);
      case 'marker-upsert':
        return await this.upsertMarker(command);
      case 'marker-delete':
        return await this.deleteMarker(command);
      case 'status':
        return await this.status();
    }
  }

  private async upsertMarker(command: UpsertMarkerCommand): Promise<RpcResponse> {
    return this.markerMutation(await this.gateway.upsertMarker(command));
  }

  private async deleteMarker(command: DeleteMarkerCommand): Promise<RpcResponse> {
    return this.markerMutation(await this.gateway.deleteMarker(command));
  }

  private markerMutation(result: RpcResponse): RpcResponse {
    if (result.outcome === 'limit') {
      throw new TrackSyncFailure(409, 'marker_limit', 'Cloud marker limit reached.');
    }
    if (result.outcome === 'revision-exhausted') {
      throw new TrackSyncFailure(
        409,
        'marker_revision_exhausted',
        'Marker revisions are exhausted.',
      );
    }
    return result;
  }

  private readonly gateway: SupabaseTrackSyncGateway;

  private async upload(command: UploadTrackCommand): Promise<RpcResponse> {
    await this.gateway.cleanupOrphans();
    const reservation = await this.gateway.reserveUpload(command);
    if (reservation.outcome !== 'upload') return reservation;
    const objectPath = reservation.objectPath;
    if (objectPath === undefined) {
      throw new Error('Track reservation returned no object path.');
    }
    let uploadResult: 'created' | 'existing';
    try {
      uploadResult = await this.gateway.uploadGeometry(objectPath, command.geometry);
    } catch (uploadError) {
      await this.gateway.releaseUpload(command.contentHash, objectPath);
      throw uploadError;
    }
    try {
      return await this.gateway.finalizeUpload(command.contentHash);
    } catch (finalizeError) {
      let compensationError: Error | undefined;
      if (uploadResult === 'created') {
        try {
          await this.gateway.removeGeometry(objectPath);
        } catch (removeError) {
          compensationError = new Error(
            `Uploaded object cleanup failed: ${
              removeError instanceof Error ? removeError.message : 'unknown error'
            }`,
          );
        }
        try {
          await this.gateway.releaseUpload(command.contentHash, objectPath);
        } catch (releaseError) {
          compensationError = new AggregateError(
            compensationError === undefined
              ? [releaseError]
              : [compensationError, releaseError],
            'Upload compensation failed.',
          );
        }
      }
      if (compensationError !== undefined) {
        throw new AggregateError(
          [finalizeError, compensationError],
          'Track upload finalization failed.',
        );
      }
      throw finalizeError;
    }
  }

  private async metadata(command: MetadataTrackCommand): Promise<RpcResponse> {
    await this.gateway.cleanupOrphans();
    return await this.gateway.applyMetadata(command);
  }

  private async delete(command: DeleteTrackCommand): Promise<RpcResponse> {
    await this.gateway.cleanupOrphans();
    const result = await this.gateway.deleteTrack(command);
    if (result.outcome === 'applied' && result.objectPath !== undefined) {
      await this.gateway.removeGeometry(result.objectPath);
    }
    return result;
  }

  private async status(): Promise<TrackSyncResult> {
    await this.gateway.cleanupOrphans();
    return await this.gateway.readUsage();
  }
}
