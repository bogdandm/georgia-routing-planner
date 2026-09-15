import { setupI18n, type Messages } from '@lingui/core';
import { msg } from '@lingui/core/macro';

import type { AppLocale } from '@/domain/localization/appLocale';
import { messages as enCore } from '@/locales/en/core.po';
import { messages as enLayers } from '@/locales/en/layers.po';
import { messages as enMap } from '@/locales/en/map.po';
import { messages as enMarkers } from '@/locales/en/markers.po';
import { messages as enSatellite } from '@/locales/en/satellite.po';
import { messages as enShell } from '@/locales/en/shell.po';
import { messages as enTracks } from '@/locales/en/tracks.po';
import { messages as enUser } from '@/locales/en/user.po';
import { messages as ruCore } from '@/locales/ru/core.po';
import { messages as ruLayers } from '@/locales/ru/layers.po';
import { messages as ruMap } from '@/locales/ru/map.po';
import { messages as ruMarkers } from '@/locales/ru/markers.po';
import { messages as ruSatellite } from '@/locales/ru/satellite.po';
import { messages as ruShell } from '@/locales/ru/shell.po';
import { messages as ruTracks } from '@/locales/ru/tracks.po';
import { messages as ruUser } from '@/locales/ru/user.po';

const documentTitle = msg`Trail Planner`;
const documentDescription = msg`Plan and inspect hiking routes across Georgia.`;

function mergeCatalogs(catalogs: readonly Messages[]): Messages {
  return Object.assign({}, ...catalogs) as Messages;
}

const messagesByLocale = {
  en: mergeCatalogs([
    enCore,
    enShell,
    enMap,
    enTracks,
    enSatellite,
    enMarkers,
    enLayers,
    enUser,
  ]),
  ru: mergeCatalogs([
    ruCore,
    ruShell,
    ruMap,
    ruTracks,
    ruSatellite,
    ruMarkers,
    ruLayers,
    ruUser,
  ]),
} satisfies Record<AppLocale, Messages>;

export const appI18n = setupI18n();

appI18n.load(messagesByLocale);

export function activateAppLocale(locale: AppLocale): void {
  appI18n.activate(locale);
  document.documentElement.lang = locale;
  document.title = appI18n._(documentTitle);

  const description = document.querySelector<HTMLMetaElement>(
    'meta[name="description"]',
  );
  if (description !== null) {
    description.content = appI18n._(documentDescription);
  }
}
