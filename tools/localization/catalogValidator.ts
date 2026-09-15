import { parse, type Token } from '@messageformat/parser';

import type { TranslationAllowlistEntry } from './translationAllowlist.ts';

export const LOCALIZATION_CATALOGS = [
  'core',
  'shell',
  'map',
  'tracks',
  'satellite',
  'markers',
  'layers',
  'user',
] as const;

export type LocalizationCatalog = (typeof LOCALIZATION_CATALOGS)[number];

export interface CatalogPair {
  readonly catalog: LocalizationCatalog;
  readonly englishPo: string;
  readonly russianPo: string;
}

interface PoMessage {
  readonly messageId: string;
  readonly message: string;
  readonly translation: string;
}

interface MutablePoMessage {
  readonly comments: string[];
  context: string;
  message: string | undefined;
  translation: string | undefined;
  currentField: 'context' | 'message' | 'translation' | null;
}

type SelectorType = 'plural' | 'select' | 'selectordinal';

interface BranchLocation {
  readonly argument: string;
  readonly type: SelectorType;
  readonly key: string;
}

interface BranchShape {
  readonly path: readonly BranchLocation[];
  readonly argumentKinds: readonly string[];
  readonly usesOctothorpe: boolean;
}

interface MessageShape {
  readonly argumentKinds: readonly string[];
  readonly selectors: readonly string[];
  readonly branches: readonly BranchShape[];
  readonly usesOctothorpe: boolean;
}

function decodePoString(value: string, lineNumber: number): string {
  try {
    const decoded: unknown = JSON.parse(value);
    if (typeof decoded === 'string') return decoded;
  } catch {
    // Report one stable parser error below.
  }
  throw new Error(`invalid PO string at line ${String(lineNumber)}`);
}

function createMutableMessage(): MutablePoMessage {
  return {
    comments: [],
    context: '',
    message: undefined,
    translation: undefined,
    currentField: null,
  };
}

export function parsePoCatalog(content: string): ReadonlyMap<string, PoMessage> {
  const entries = new Map<string, PoMessage>();
  let current = createMutableMessage();

  const finishEntry = (lineNumber: number): void => {
    if (current.message === undefined) {
      if (current.comments.length > 0) {
        throw new Error(`PO entry without msgid before line ${String(lineNumber)}`);
      }
      current = createMutableMessage();
      return;
    }

    if (current.message === '') {
      current = createMutableMessage();
      return;
    }

    const generatedId = current.comments
      .find((comment) => comment.startsWith('#. js-lingui-id: '))
      ?.slice('#. js-lingui-id: '.length)
      .trim();
    const explicitId = current.comments.includes('#. js-lingui-explicit-id');
    const messageId = explicitId ? current.message : generatedId;
    if (messageId === undefined || messageId === '') {
      throw new Error(
        `PO entry without a Lingui message ID before line ${String(lineNumber)}`,
      );
    }
    if (entries.has(messageId)) {
      throw new Error(`duplicate Lingui message ID ${messageId}`);
    }

    entries.set(messageId, {
      messageId,
      message: current.message,
      translation: current.translation ?? '',
    });
    current = createMutableMessage();
  };

  const lines = content.replaceAll('\r\n', '\n').split('\n');
  for (let index = 0; index <= lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lineNumber = index + 1;
    if (line === '') {
      finishEntry(lineNumber);
      continue;
    }
    if (line.startsWith('#')) {
      current.comments.push(line);
      continue;
    }

    const directive = /^(msgctxt|msgid|msgstr)\s+(".*")$/.exec(line);
    if (directive !== null) {
      const field = directive[1];
      const value = decodePoString(directive[2] ?? '', lineNumber);
      if (field === 'msgctxt') {
        current.context = value;
        current.currentField = 'context';
      } else if (field === 'msgid') {
        current.message = value;
        current.currentField = 'message';
      } else {
        current.translation = value;
        current.currentField = 'translation';
      }
      continue;
    }

    if (line.startsWith('"') && line.endsWith('"')) {
      const value = decodePoString(line, lineNumber);
      if (current.currentField === 'context') current.context += value;
      else if (current.currentField === 'message')
        current.message = (current.message ?? '') + value;
      else if (current.currentField === 'translation') {
        current.translation = (current.translation ?? '') + value;
      } else {
        throw new Error(`orphaned PO continuation at line ${String(lineNumber)}`);
      }
      continue;
    }

    throw new Error(`unsupported PO syntax at line ${String(lineNumber)}`);
  }

  return entries;
}
interface TokenSummary {
  readonly argumentKinds: readonly string[];
  readonly usesOctothorpe: boolean;
}

function summarizeTokens(tokens: readonly Token[]): TokenSummary {
  const argumentKinds = new Set<string>();
  let usesOctothorpe = false;

  const visit = (nestedTokens: readonly Token[]): void => {
    for (const token of nestedTokens) {
      if (token.type === 'argument') {
        argumentKinds.add(`${token.arg}:argument`);
      } else if (token.type === 'function') {
        argumentKinds.add(`${token.arg}:function:${token.key}`);
        if (token.param !== undefined) visit(token.param);
      } else if (
        token.type === 'plural' ||
        token.type === 'select' ||
        token.type === 'selectordinal'
      ) {
        argumentKinds.add(`${token.arg}:${token.type}`);
        for (const selectCase of token.cases) visit(selectCase.tokens);
      } else if (token.type === 'octothorpe') {
        usesOctothorpe = true;
      }
    }
  };

  visit(tokens);
  return {
    argumentKinds: [...argumentKinds].toSorted(),
    usesOctothorpe,
  };
}

function collectMessageShape(tokens: readonly Token[]): MessageShape {
  const argumentKinds = new Set<string>();
  const selectors: string[] = [];
  const branches: BranchShape[] = [];
  let usesOctothorpe = false;

  const visit = (
    nestedTokens: readonly Token[],
    parentPath: readonly BranchLocation[],
  ): void => {
    for (const token of nestedTokens) {
      if (token.type === 'argument') {
        argumentKinds.add(`${token.arg}:argument`);
      } else if (token.type === 'function') {
        argumentKinds.add(`${token.arg}:function:${token.key}`);
        if (token.param !== undefined) visit(token.param, parentPath);
      } else if (
        token.type === 'plural' ||
        token.type === 'select' ||
        token.type === 'selectordinal'
      ) {
        argumentKinds.add(`${token.arg}:${token.type}`);
        const keys = token.cases.map(({ key }) => key);
        if (token.type === 'select') {
          selectors.push(`${token.arg}:select:${keys.toSorted().join(',')}`);
        } else {
          if (!keys.includes('other')) {
            throw new Error(`${token.type} argument ${token.arg} has no other branch`);
          }
          const exactBranches = keys.filter((key) => key.startsWith('=')).toSorted();
          selectors.push(`${token.arg}:${token.type}:${exactBranches.join(',')}`);
        }
        for (const selectCase of token.cases) {
          const path = [
            ...parentPath,
            {
              argument: token.arg,
              type: token.type,
              key: selectCase.key,
            },
          ];
          branches.push({ path, ...summarizeTokens(selectCase.tokens) });
          visit(selectCase.tokens, path);
        }
      } else if (token.type === 'octothorpe') {
        usesOctothorpe = true;
      }
    }
  };

  visit(tokens, []);
  return {
    argumentKinds: [...argumentKinds].toSorted(),
    selectors: selectors.toSorted(),
    branches,
    usesOctothorpe,
  };
}

function parseMessageShape(message: string): MessageShape {
  return collectMessageShape(parse(message, { strict: true, strictPluralKeys: false }));
}

function equalStringArrays(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

function equalBranchPaths(
  left: readonly BranchLocation[],
  right: readonly BranchLocation[],
): boolean {
  return (
    left.length === right.length &&
    left.every((location, index) => {
      const candidate = right[index];
      if (candidate === undefined) return false;
      return (
        location.argument === candidate.argument &&
        location.type === candidate.type &&
        location.key === candidate.key
      );
    })
  );
}

function equalBranchProfiles(left: BranchShape, right: BranchShape): boolean {
  return (
    equalStringArrays(left.argumentKinds, right.argumentKinds) &&
    left.usesOctothorpe === right.usesOctothorpe
  );
}

function sourcePathCandidates(
  targetPath: readonly BranchLocation[],
): readonly (readonly BranchLocation[])[] {
  let candidates: BranchLocation[][] = [[]];
  for (const location of targetPath) {
    const alternatives = [location];
    if (
      location.type !== 'select' &&
      location.key !== 'other' &&
      !location.key.startsWith('=')
    ) {
      alternatives.push({ ...location, key: 'other' });
    }
    const nextCandidates: BranchLocation[][] = [];
    for (const candidate of candidates) {
      for (const alternative of alternatives) {
        nextCandidates.push([...candidate, alternative]);
      }
    }
    candidates = nextCandidates;
  }
  return candidates;
}

function equalBranchShapes(
  source: readonly BranchShape[],
  target: readonly BranchShape[],
): boolean {
  for (const sourceBranch of source) {
    const preserved = target.some(
      (targetBranch) =>
        equalBranchPaths(sourceBranch.path, targetBranch.path) &&
        equalBranchProfiles(sourceBranch, targetBranch),
    );
    if (!preserved) return false;
  }

  for (const targetBranch of target) {
    const matchesSource = sourcePathCandidates(targetBranch.path).some(
      (candidatePath) =>
        source.some(
          (sourceBranch) =>
            equalBranchPaths(sourceBranch.path, candidatePath) &&
            equalBranchProfiles(sourceBranch, targetBranch),
        ),
    );
    if (!matchesSource) return false;
  }

  return true;
}

function normalized(value: string): string {
  return value.trim().normalize('NFC');
}

function allowlistKey(catalog: string, messageId: string): string {
  return `${catalog}\u0000${messageId}`;
}

export function validateCatalogs(
  catalogPairs: readonly CatalogPair[],
  allowlist: readonly TranslationAllowlistEntry[],
): readonly string[] {
  const errors: string[] = [];
  const selectedCatalogs = new Set(catalogPairs.map(({ catalog }) => catalog));
  const allowedEqualities = new Map<string, TranslationAllowlistEntry>();

  for (const entry of allowlist) {
    if (!LOCALIZATION_CATALOGS.includes(entry.catalog as LocalizationCatalog)) {
      errors.push(`allowlist: unknown catalog ${entry.catalog}`);
      continue;
    }
    if (!selectedCatalogs.has(entry.catalog as LocalizationCatalog)) continue;
    if (entry.reason.trim() === '') {
      errors.push(`allowlist: ${entry.catalog}/${entry.messageId} has no reason`);
    }
    const key = allowlistKey(entry.catalog, entry.messageId);
    if (allowedEqualities.has(key)) {
      errors.push(`allowlist: duplicate entry ${entry.catalog}/${entry.messageId}`);
    } else {
      allowedEqualities.set(key, entry);
    }
  }

  const seenMessageKeys = new Set<string>();
  const equalMessageKeys = new Set<string>();

  for (const pair of catalogPairs) {
    let english: ReadonlyMap<string, PoMessage>;
    let russian: ReadonlyMap<string, PoMessage>;
    try {
      english = parsePoCatalog(pair.englishPo);
    } catch (error) {
      errors.push(
        `${pair.catalog}/en: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    try {
      russian = parsePoCatalog(pair.russianPo);
    } catch (error) {
      errors.push(
        `${pair.catalog}/ru: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    for (const messageId of english.keys()) {
      if (!russian.has(messageId))
        errors.push(`${pair.catalog}/${messageId}: missing Russian entry`);
    }
    for (const messageId of russian.keys()) {
      if (!english.has(messageId))
        errors.push(`${pair.catalog}/${messageId}: extra Russian entry`);
    }

    for (const [messageId, englishEntry] of english) {
      const russianEntry = russian.get(messageId);
      if (russianEntry === undefined) continue;
      const messageKey = allowlistKey(pair.catalog, messageId);
      seenMessageKeys.add(messageKey);
      const englishSource =
        englishEntry.translation.trim() === ''
          ? englishEntry.message
          : englishEntry.translation;
      const russianTranslation = russianEntry.translation;

      if (englishSource.trim() === '') {
        errors.push(`${pair.catalog}/${messageId}: empty English source text`);
        continue;
      }
      if (russianTranslation.trim() === '') {
        errors.push(`${pair.catalog}/${messageId}: empty Russian translation`);
        continue;
      }

      let englishShape: MessageShape | undefined;
      let russianShape: MessageShape | undefined;
      try {
        englishShape = parseMessageShape(englishSource);
      } catch (error) {
        errors.push(
          `${pair.catalog}/${messageId}: invalid English ICU: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      try {
        russianShape = parseMessageShape(russianTranslation);
      } catch (error) {
        errors.push(
          `${pair.catalog}/${messageId}: invalid Russian ICU: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (englishShape !== undefined && russianShape !== undefined) {
        if (
          !equalStringArrays(englishShape.argumentKinds, russianShape.argumentKinds) ||
          englishShape.usesOctothorpe !== russianShape.usesOctothorpe ||
          !equalBranchShapes(englishShape.branches, russianShape.branches)
        ) {
          errors.push(`${pair.catalog}/${messageId}: ICU argument or construct drift`);
        }
        if (!equalStringArrays(englishShape.selectors, russianShape.selectors)) {
          errors.push(
            `${pair.catalog}/${messageId}: ICU select or plural branch drift`,
          );
        }
      }

      if (normalized(englishSource) === normalized(russianTranslation)) {
        equalMessageKeys.add(messageKey);
        if (!allowedEqualities.has(messageKey)) {
          errors.push(
            `${pair.catalog}/${messageId}: Russian translation equals English source`,
          );
        }
      }
    }
  }

  for (const [key, entry] of allowedEqualities) {
    if (!seenMessageKeys.has(key)) {
      errors.push(`allowlist: unknown message ${entry.catalog}/${entry.messageId}`);
    } else if (!equalMessageKeys.has(key)) {
      errors.push(`allowlist: stale entry ${entry.catalog}/${entry.messageId}`);
    }
  }

  return errors;
}

export function findChangedCatalogPaths(
  before: ReadonlyMap<string, Uint8Array>,
  after: ReadonlyMap<string, Uint8Array>,
): readonly string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths]
    .filter((path) => {
      const previous = before.get(path);
      const current = after.get(path);
      if (previous === undefined || current === undefined) return true;
      return !Buffer.from(previous).equals(Buffer.from(current));
    })
    .toSorted();
}
