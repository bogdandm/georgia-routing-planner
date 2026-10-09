export interface TranslationAllowlistEntry {
  readonly catalog: string;
  readonly messageId: string;
  readonly reason: string;
}

export const translationAllowlist: readonly TranslationAllowlistEntry[] = [
  {
    catalog: 'core',
    messageId: 'Dx9Pe3',
    reason: 'Trail Planner is the invariant product name.',
  },
  {
    catalog: 'shell',
    messageId: 'FX4c9a',
    reason: 'Русский is the language self-name shown in the selector.',
  },
  {
    catalog: 'tracks',
    messageId: 'C6vDEv',
    reason: 'The approximation sign before an already localized duration is invariant.',
  },
  {
    catalog: 'weather',
    messageId: 'WOxIJW',
    reason: 'Only the localized number varies; the °C unit symbol is invariant.',
  },
  {
    catalog: 'weather',
    messageId: 'N-w3lW',
    reason: 'Only the localized numbers vary; the °C range format is invariant.',
  },
  {
    catalog: 'weather',
    messageId: 'SeiNzs',
    reason: 'Russian uses the same colon between two already localized arguments.',
  },
];
