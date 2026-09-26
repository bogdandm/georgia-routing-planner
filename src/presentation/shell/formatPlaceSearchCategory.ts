import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

const categoryLabels: Readonly<Record<string, MessageDescriptor>> = {
  'boundary:administrative': msg`Administrative area`,
  'mountain_pass:yes': msg`Mountain pass`,
  'natural:bay': msg`Bay`,
  'natural:mountain_range': msg`Mountain range`,
  'natural:peak': msg`Peak`,
  'natural:ridge': msg`Mountain ridge`,
  'natural:saddle': msg`Mountain saddle`,
  'natural:spring': msg`Spring`,
  'natural:strait': msg`Strait`,
  'natural:volcano': msg`Volcano`,
  'natural:water': msg`Water body`,
  'place:city': msg`City`,
  'place:hamlet': msg`Hamlet`,
  'place:isolated_dwelling': msg`Isolated dwelling`,
  'place:town': msg`Town`,
  'place:village': msg`Village`,
  'water:lake': msg`Lake`,
  'water:lagoon': msg`Lagoon`,
  'water:pond': msg`Pond`,
  'water:reservoir': msg`Reservoir`,
  'water:river': msg`River`,
  'waterway:canal': msg`Canal`,
  'waterway:river': msg`River`,
  'waterway:riverbank': msg`River`,
  'waterway:stream': msg`Stream`,
  'waterway:waterfall': msg`Waterfall`,
};

function humanizeTagValue(value: string, i18n: I18n): string {
  const words = value.replaceAll('_', ' ').trim();
  if (words.length === 0) return i18n._(msg`Other place`);
  return `${words.charAt(0).toLocaleUpperCase(i18n.locale)}${words.slice(1)}`;
}

/** Converts open-ended Nominatim OSM tags into locale-aware, readable UI copy. */
export function formatPlaceSearchCategory(category: string, i18n: I18n): string {
  const reviewedLabel = categoryLabels[category];
  if (reviewedLabel !== undefined) return i18n._(reviewedLabel);
  const separator = category.indexOf(':');
  return humanizeTagValue(
    separator < 0 ? category : category.slice(separator + 1),
    i18n,
  );
}
