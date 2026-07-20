const categoryLabels: Readonly<Record<string, string>> = {
  'boundary:administrative': 'Administrative area',
  'mountain_pass:yes': 'Mountain pass',
  'natural:bay': 'Bay',
  'natural:mountain_range': 'Mountain range',
  'natural:peak': 'Peak',
  'natural:ridge': 'Mountain ridge',
  'natural:saddle': 'Mountain saddle',
  'natural:spring': 'Spring',
  'natural:strait': 'Strait',
  'natural:volcano': 'Volcano',
  'natural:water': 'Water body',
  'place:city': 'City',
  'place:hamlet': 'Hamlet',
  'place:isolated_dwelling': 'Isolated dwelling',
  'place:town': 'Town',
  'place:village': 'Village',
  'water:lake': 'Lake',
  'water:lagoon': 'Lagoon',
  'water:pond': 'Pond',
  'water:reservoir': 'Reservoir',
  'water:river': 'River',
  'waterway:canal': 'Canal',
  'waterway:river': 'River',
  'waterway:riverbank': 'River',
  'waterway:stream': 'Stream',
  'waterway:waterfall': 'Waterfall',
};

function humanizeTagValue(value: string): string {
  const words = value.replaceAll('_', ' ').trim();
  if (words.length === 0) return 'Other place';
  return `${words.charAt(0).toLocaleUpperCase('en')}${words.slice(1)}`;
}

/** Converts open-ended Nominatim OSM tags into stable, readable UI copy. */
export function formatPlaceSearchCategory(category: string): string {
  const reviewedLabel = categoryLabels[category];
  if (reviewedLabel !== undefined) return reviewedLabel;
  const separator = category.indexOf(':');
  return humanizeTagValue(separator < 0 ? category : category.slice(separator + 1));
}
