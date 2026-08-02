import type { TrackContentHasher } from '@/application/ports/TrackContentHasher';
import { encodeTrackSyncGeometry } from '@/domain/tracks/trackSyncGeometry';
import type { LocalTrackContent } from '@/domain/tracks/localTrack';

export class WebCryptoTrackContentHasher implements TrackContentHasher {
  public async hash(content: LocalTrackContent): Promise<string> {
    const canonical = Uint8Array.from(encodeTrackSyncGeometry(content));
    const digest = await crypto.subtle.digest('SHA-256', canonical.buffer);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
  }
}
