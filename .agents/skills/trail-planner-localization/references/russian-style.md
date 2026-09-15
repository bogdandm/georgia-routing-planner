# Russian UI style

Read this reference only while translating the Russian catalog for one feature.

## Voice and mechanics

- Use neutral, concise interface language. Prefer direct labels and short imperatives;
  avoid bureaucratic wording, marketing tone, and unnecessary politeness.
- Preserve the source meaning, severity, and actionable detail. Do not add promises,
  causes, or recovery steps absent from the English source.
- Use normative Russian spelling with `ё` where the word requires it. Do not replace `ё`
  with `е` for convenience.
- Preserve named ICU arguments exactly. Reorder them naturally in Russian, but never
  rename, remove, or interpolate them by string concatenation.
- Keep punctuation consistent within the surface. Labels and buttons normally have no
  final period; complete explanatory and error sentences do.

## ICU plurals

Russian cardinal plurals normally need `one`, `few`, `many`, and `other`:

```text
{count, plural,
  one {# трек}
  few {# трека}
  many {# треков}
  other {# трека}
}
```

Retain every exact-number branch from the English message and always retain `other`. Add
Russian CLDR categories when grammar requires them. Preserve nested argument names and
construct kinds in every branch.

## Glossary

| English               | Russian              |
| --------------------- | -------------------- |
| Tracks / track        | `Треки` / `трек`     |
| Plan route            | `Построить маршрут`  |
| Routes mode           | `По дорогам`         |
| Line mode             | `Прямая`             |
| Satellite on the rail | `Спутник`            |
| Satellite in headings | `Спутниковые снимки` |
| Markers / marker      | `Метки` / `метка`    |
| Layers                | `Слои`               |
| User                  | `Профиль`            |
| Settings              | `Настройки`          |
| Mosaic                | `Мозаика`            |
| cloud cover           | `облачность`         |
| coverage              | `покрытие`           |
| elevation gain        | `набор высоты`       |
| elevation loss        | `сброс высоты`       |

## Invariant names and technical labels

Preserve these spellings: `Trail Planner`, GPX, FIT, KML, MapLibre, OSM/OpenStreetMap,
Google, NAPR, Sentinel-2, Copernicus, Earth Search, L1C, L2A, STAC, WebGL, IndexedDB,
Cache Storage, localStorage, and TiTiler.

Also preserve user/import/provider data, attribution, email addresses, IDs, URLs,
filenames, coordinates, HTTP values, file-format tokens, protocol values, diagnostic
event names, and machine/share/export serialization.
