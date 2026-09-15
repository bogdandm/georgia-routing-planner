import { describe, expect, it } from 'vitest';

import {
  findChangedCatalogPaths,
  type CatalogPair,
  validateCatalogs,
} from '../../tools/localization/catalogValidator';
import type { TranslationAllowlistEntry } from '../../tools/localization/translationAllowlist';

interface FixtureMessage {
  readonly id: string;
  readonly message: string;
  readonly translation?: string;
}

function po(messages: readonly FixtureMessage[]): string {
  const entries = messages.map(
    ({ id, message, translation = '' }) =>
      `#. js-lingui-id: ${id}\nmsgid ${JSON.stringify(message)}\nmsgstr ${JSON.stringify(translation)}`,
  );
  return ['msgid ""\nmsgstr ""\n"Language: fixture\\n"', ...entries, ''].join('\n\n');
}

function pair(
  english: readonly FixtureMessage[],
  russian: readonly FixtureMessage[],
): CatalogPair {
  return { catalog: 'core', englishPo: po(english), russianPo: po(russian) };
}

const noAllowlist: readonly TranslationAllowlistEntry[] = [];

describe('localization catalog validation', () => {
  it('detects catalog bytes changed by extraction', () => {
    const before = new Map<string, Uint8Array>([
      ['src/locales/en/core.po', Buffer.from('before')],
      ['src/locales/ru/core.po', Buffer.from('same')],
    ]);
    const after = new Map<string, Uint8Array>([
      ['src/locales/en/core.po', Buffer.from('after')],
      ['src/locales/ru/core.po', Buffer.from('same')],
      ['src/locales/en/shell.po', Buffer.from('added')],
    ]);

    expect(findChangedCatalogPaths(before, after)).toEqual([
      'src/locales/en/core.po',
      'src/locales/en/shell.po',
    ]);
  });

  it('rejects missing and extra Russian message IDs', () => {
    const errors = validateCatalogs(
      [
        pair(
          [
            { id: 'present', message: 'Present' },
            { id: 'missing', message: 'Missing' },
          ],
          [
            { id: 'present', message: 'Present', translation: 'Есть' },
            { id: 'extra', message: 'Extra', translation: 'Лишнее' },
          ],
        ),
      ],
      noAllowlist,
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'core/missing: missing Russian entry',
        'core/extra: extra Russian entry',
      ]),
    );
  });

  it('rejects empty and unreviewed equal Russian translations', () => {
    const errors = validateCatalogs(
      [
        pair(
          [
            { id: 'empty', message: 'Empty' },
            { id: 'equal', message: 'Trail Planner' },
          ],
          [
            { id: 'empty', message: 'Empty' },
            { id: 'equal', message: 'Trail Planner', translation: 'Trail Planner' },
          ],
        ),
      ],
      noAllowlist,
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'core/empty: empty Russian translation',
        'core/equal: Russian translation equals English source',
      ]),
    );
  });

  it('accepts a reviewed invariant and rejects stale or unknown allowlist rows', () => {
    const catalog = pair(
      [
        { id: 'brand', message: 'Trail Planner' },
        { id: 'translated', message: 'Settings' },
      ],
      [
        { id: 'brand', message: 'Trail Planner', translation: 'Trail Planner' },
        { id: 'translated', message: 'Settings', translation: 'Настройки' },
      ],
    );
    const valid = {
      catalog: 'core',
      messageId: 'brand',
      reason: 'Invariant product name.',
    } satisfies TranslationAllowlistEntry;

    expect(validateCatalogs([catalog], [valid])).toEqual([]);
    expect(
      validateCatalogs(
        [catalog],
        [
          valid,
          { catalog: 'core', messageId: 'translated', reason: 'No longer invariant.' },
          { catalog: 'core', messageId: 'removed', reason: 'Removed message.' },
        ],
      ),
    ).toEqual(
      expect.arrayContaining([
        'allowlist: stale entry core/translated',
        'allowlist: unknown message core/removed',
      ]),
    );
  });

  it('rejects malformed ICU and renamed or missing arguments', () => {
    const invalidIcu = validateCatalogs(
      [
        pair(
          [{ id: 'count', message: '{count, plural, one {# item} other {# items}}' }],
          [
            {
              id: 'count',
              message: '{count, plural, one {# item} other {# items}}',
              translation: '{count, plural, one {элемент}',
            },
          ],
        ),
      ],
      noAllowlist,
    );
    expect(invalidIcu.some((error) => error.includes('invalid Russian ICU'))).toBe(
      true,
    );

    for (const translation of ['Привет, {account}', 'Привет']) {
      expect(
        validateCatalogs(
          [
            pair(
              [{ id: 'hello', message: 'Hello, {name}' }],
              [{ id: 'hello', message: 'Hello, {name}', translation }],
            ),
          ],
          noAllowlist,
        ),
      ).toContain('core/hello: ICU argument or construct drift');
    }
  });

  it('rejects plural/select construct drift but permits Russian CLDR branches', () => {
    const english = '{count, plural, one {# image} other {# images}}';
    expect(
      validateCatalogs(
        [
          pair(
            [{ id: 'count', message: english }],
            [
              {
                id: 'count',
                message: english,
                translation: '{count, select, one {изображение} other {изображения}}',
              },
            ],
          ),
        ],
        noAllowlist,
      ),
    ).toEqual(
      expect.arrayContaining([
        'core/count: ICU argument or construct drift',
        'core/count: ICU select or plural branch drift',
      ]),
    );

    expect(
      validateCatalogs(
        [
          pair(
            [{ id: 'count', message: english }],
            [
              {
                id: 'count',
                message: english,
                translation: '{count, plural, one {изображение} other {изображений}}',
              },
            ],
          ),
        ],
        noAllowlist,
      ),
    ).toContain('core/count: ICU argument or construct drift');

    expect(
      validateCatalogs(
        [
          pair(
            [
              {
                id: 'owner',
                message:
                  '{count, plural, one {{name} has # image} other {{name} has # images}}',
              },
            ],
            [
              {
                id: 'owner',
                message:
                  '{count, plural, one {{name} has # image} other {{name} has # images}}',
                translation:
                  '{count, plural, one {Есть # изображение} other {У {name} # изображений}}',
              },
            ],
          ),
        ],
        noAllowlist,
      ),
    ).toContain('core/owner: ICU argument or construct drift');

    expect(
      validateCatalogs(
        [
          pair(
            [{ id: 'count', message: english }],
            [
              {
                id: 'count',
                message: english,
                translation:
                  '{count, plural, one {# изображение} few {# изображения} many {# изображений} other {# изображения}}',
              },
            ],
          ),
        ],
        noAllowlist,
      ),
    ).toEqual([]);
  });
});
