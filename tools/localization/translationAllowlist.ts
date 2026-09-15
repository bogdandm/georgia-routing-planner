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
];
