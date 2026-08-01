import type { LocalTrackContent } from '@/domain/tracks/localTrack';

/** Computes the stable elevation-free identity consumed by local track saving. */
export interface TrackContentHasher {
  hash(content: LocalTrackContent): Promise<string>;
}
