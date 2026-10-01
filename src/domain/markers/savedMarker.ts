export const SAVED_MARKER_SCHEMA_VERSION = 2;

export const markerIconKeys = [
  'place',
  'flag',
  'home',
  'parking',
  'apartment',
  'business',
  'cabin',
  'cottage',
  'city',
  'map',
  'my-location',
  'navigation',
  'pin',
  'public',
  'school',
  'explore',
  'landscape',
  'forest',
  'terrain',
  'water',
  'snow',
  'beach',
  'eco',
  'grass',
  'park',
  'spa',
  'volcano',
  'waves',
  'sunny',
  'cloud',
  'storm',
  'tsunami',
  'telescope',
  'moon',
  'lake',
  'viewpoint',
  'waterfall',
  'cave',
  'cliff',
  'valley',
  'rock',
  'bear',
  'deer',
  'bird',
  'wildflowers',
  'wetland',
  'hiking',
  'cycling',
  'boating',
  'pets',
  'skiing',
  'kayaking',
  'kitesurfing',
  'paragliding',
  'rowing',
  'sailing',
  'diving',
  'skateboarding',
  'snowboarding',
  'sports',
  'football',
  'surfing',
  'swimming',
  'running',
  'restaurant',
  'cafe',
  'hotel',
  'store',
  'bakery',
  'brunch',
  'camping',
  'fast-food',
  'ice-cream',
  'liquor',
  'bar',
  'dining',
  'drinking-water',
  'grocery',
  'shelter',
  'ramen',
  'seafood',
  'tapas',
  'camera',
  'castle',
  'church',
  'museum',
  'monument',
  'attraction',
  'celebration',
  'deck',
  'festival',
  'fort',
  'mosque',
  'synagogue',
  'buddhist-temple',
  'hindu-temple',
  'theater',
  'tour',
  'villa',
  'hospital',
  'medical',
  'info',
  'warning',
  'roadwork',
  'blocked',
  'car-crash',
  'alert',
  'danger',
  'emergency',
  'engineering',
  'fire-extinguisher',
  'safety',
  'fire-station',
  'report',
  'security',
  'sos',
  'traffic',
  'shuttle',
  'commute',
  'bus',
  'car',
  'railway',
  'electric-bike',
  'flight',
  'fuel',
  'bike',
  'snowmobile',
  'train',
  'tram',
  'motorcycle',
] as const;

export type MarkerIconKey = (typeof markerIconKeys)[number];

export const markerColorKeys = [
  'blue',
  'teal',
  'purple',
  'olive',
  'orange',
  'rose',
  'navy',
  'blue-green',
  'green',
  'red',
] as const;

export type MarkerColorKey = (typeof markerColorKeys)[number];

export const markerSorts = ['created', 'name', 'color', 'icon', 'distance'] as const;

export type MarkerSort = (typeof markerSorts)[number];

export interface SavedMarker {
  readonly schemaVersion: typeof SAVED_MARKER_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly coordinate: readonly [longitude: number, latitude: number];
  readonly elevationMeters: number | null;
  readonly iconKey: MarkerIconKey;
  readonly colorKey: MarkerColorKey;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NormalizedMarkerName {
  readonly name: string;
  readonly normalizedName: string;
}

/** True when every character can be written to XML, which GPX export and sync require. */
export function isXmlText(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    const validXmlCharacter =
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint !== undefined &&
        ((codePoint >= 0x20 && codePoint <= 0xd7ff) ||
          (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
          (codePoint >= 0x10000 && codePoint <= 0x10ffff)));
    if (!validXmlCharacter) return false;
  }
  return true;
}

export type MarkerNameProblem = 'required' | 'too-long' | 'invalid-character';

const markerNameProblemMessages = {
  required: 'Marker name is required.',
  'too-long': 'Marker name must be 200 characters or fewer.',
  'invalid-character': 'Marker name contains characters that cannot be exported.',
} as const satisfies Record<MarkerNameProblem, string>;

/** Rejected marker name; `problem` lets the UI show a localized explanation. */
export class MarkerNameError extends Error {
  public constructor(public readonly problem: MarkerNameProblem) {
    super(markerNameProblemMessages[problem]);
    this.name = 'MarkerNameError';
  }
}

export function normalizeMarkerName(name: string): NormalizedMarkerName {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new MarkerNameError('required');
  if (trimmed.length > 200) throw new MarkerNameError('too-long');
  if (!isXmlText(trimmed)) throw new MarkerNameError('invalid-character');
  return {
    name: trimmed,
    normalizedName: trimmed.toLocaleLowerCase('en'),
  };
}
