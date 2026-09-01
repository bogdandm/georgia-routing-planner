export const SAVED_MARKER_SCHEMA_VERSION = 1;

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
  'viewpoint',
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

export const markerSorts = ['created', 'name', 'color', 'distance'] as const;

export type MarkerSort = (typeof markerSorts)[number];

export interface SavedMarker {
  readonly schemaVersion: typeof SAVED_MARKER_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly coordinate: readonly [longitude: number, latitude: number];
  readonly iconKey: MarkerIconKey;
  readonly colorKey: MarkerColorKey;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NormalizedMarkerName {
  readonly name: string;
  readonly normalizedName: string;
}

export function normalizeMarkerName(name: string): NormalizedMarkerName {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error('Marker name is required.');
  if (trimmed.length > 200) {
    throw new Error('Marker name must be 200 characters or fewer.');
  }
  return {
    name: trimmed,
    normalizedName: trimmed.toLocaleLowerCase('en'),
  };
}
