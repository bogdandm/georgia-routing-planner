import type { SupabaseContext } from 'npm:@supabase/server@1.4.1';

import type {
  DeleteTrackCommand,
  MetadataTrackCommand,
  RpcResponse,
  TrackSyncCommand,
  TrackSyncResult,
  UploadTrackCommand,
} from './contracts.ts';
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
      case 'status':
        return await this.status();
    }
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
