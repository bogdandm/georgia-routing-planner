export const GPX_PARSER_VERSION = 1;

export type TrackCoordinate = readonly [longitude: number, latitude: number];

export interface TrackPoint {
  readonly coordinate: TrackCoordinate;
  readonly elevationMeters?: number;
  readonly recordedAt?: string;
}

export interface TrackSegment {
  readonly points: readonly TrackPoint[];
}

export type GpxWarningCode =
  | 'invalid-point'
  | 'short-segment'
  | 'track-preferred-over-route'
  | 'invalid-time'
  | 'warning-limit-reached';

export interface GpxValidationWarning {
  readonly code: GpxWarningCode;
  readonly message: string;
  readonly segmentIndex?: number;
  readonly pointIndex?: number;
}

export interface GpxLink {
  readonly href: string;
  readonly text?: string;
}

export interface GpxMetadataProjection {
  readonly version: '1.0' | '1.1';
  readonly creator?: string;
  readonly name?: string;
  readonly description?: string;
  readonly time?: string;
  readonly keywords?: string;
  readonly authorName?: string;
  readonly copyrightLabel?: string;
  readonly copyrightYear?: number;
  readonly links: readonly GpxLink[];
  readonly selectedName?: string;
  readonly selectedDescription?: string;
  readonly selectedComment?: string;
  readonly selectedSource?: string;
  readonly selectedType?: string;
  readonly selectedNumber?: number;
}

export interface ParsedGpx {
  readonly parserVersion: typeof GPX_PARSER_VERSION;
  readonly geometryKind: 'track' | 'route';
  readonly segments: readonly TrackSegment[];
  readonly pointCount: number;
  readonly metadata: GpxMetadataProjection;
  readonly warnings: readonly GpxValidationWarning[];
}

export type GpxParseFailureCode =
  | 'aborted'
  | 'file-too-large'
  | 'unsafe-xml'
  | 'invalid-xml'
  | 'unsupported-version'
  | 'limit-exceeded'
  | 'empty-geometry';

export class GpxParseError extends Error {
  public constructor(
    public readonly code: GpxParseFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'GpxParseError';
  }
}

export interface ParseGpxOptions {
  readonly signal?: AbortSignal;
  readonly maximumBytes?: number;
}

const defaultLimits = {
  maximumBytes: 10 * 1024 * 1024,
  maximumDepth: 32,
  maximumTracksAndRoutes: 128,
  maximumSegments: 512,
  maximumPoints: 100_000,
  maximumWarnings: 50,
  maximumTextLength: 2_000,
  maximumLinks: 10,
} as const;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new GpxParseError('aborted', 'GPX import was cancelled.');
  }
}

function directChildren(element: Element, localName: string): Element[] {
  return Array.from(element.children).filter((child) => child.localName === localName);
}

function firstChild(element: Element, localName: string): Element | undefined {
  return directChildren(element, localName)[0];
}

function boundedText(element: Element | undefined): string | undefined {
  if (element === undefined) return undefined;
  const value = element.textContent.trim();
  if (value.length === 0) return undefined;
  return value.slice(0, defaultLimits.maximumTextLength);
}

function optionalFiniteNumber(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseTimestamp(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : undefined;
}

function validateDocumentLimits(root: Element): void {
  let count = 0;
  const stack: { readonly element: Element; readonly depth: number }[] = [
    { element: root, depth: 1 },
  ];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    count += 1;
    if (count > defaultLimits.maximumPoints * 8) {
      throw new GpxParseError('limit-exceeded', 'GPX XML contains too many elements.');
    }
    if (current.depth > defaultLimits.maximumDepth) {
      throw new GpxParseError('limit-exceeded', 'GPX XML nesting is too deep.');
    }
    for (const child of current.element.children) {
      stack.push({ element: child, depth: current.depth + 1 });
    }
  }
}

function parseLinks(parent: Element | undefined): readonly GpxLink[] {
  if (parent === undefined) return [];
  return directChildren(parent, 'link')
    .slice(0, defaultLimits.maximumLinks)
    .flatMap((link) => {
      const href = link.getAttribute('href');
      if (href === null) return [];
      try {
        const url = new URL(href);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
        const text = boundedText(firstChild(link, 'text'));
        return [{ href: url.toString(), ...(text === undefined ? {} : { text }) }];
      } catch {
        return [];
      }
    });
}

function addWarning(
  warnings: GpxValidationWarning[],
  warning: GpxValidationWarning,
): void {
  if (warnings.length < defaultLimits.maximumWarnings) {
    warnings.push(warning);
    return;
  }
  if (!warnings.some(({ code }) => code === 'warning-limit-reached')) {
    warnings[defaultLimits.maximumWarnings - 1] = {
      code: 'warning-limit-reached',
      message: 'Additional GPX validation warnings were omitted.',
    };
  }
}

function parsePoint(
  element: Element,
  warnings: GpxValidationWarning[],
  segmentIndex: number,
  pointIndex: number,
): TrackPoint | null {
  const longitude = optionalFiniteNumber(element.getAttribute('lon'));
  const latitude = optionalFiniteNumber(element.getAttribute('lat'));
  if (
    longitude === undefined ||
    latitude === undefined ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    addWarning(warnings, {
      code: 'invalid-point',
      message: 'A point with invalid coordinates was skipped.',
      segmentIndex,
      pointIndex,
    });
    return null;
  }

  const elevationMeters = optionalFiniteNumber(
    boundedText(firstChild(element, 'ele')) ?? null,
  );
  const rawTime = boundedText(firstChild(element, 'time'));
  const recordedAt = parseTimestamp(rawTime);
  if (rawTime !== undefined && recordedAt === undefined) {
    addWarning(warnings, {
      code: 'invalid-time',
      message: 'A point with an invalid timestamp was retained without time.',
      segmentIndex,
      pointIndex,
    });
  }
  return {
    coordinate: [longitude, latitude],
    ...(elevationMeters === undefined ? {} : { elevationMeters }),
    ...(recordedAt === undefined ? {} : { recordedAt }),
  };
}

function parseSegments(
  candidates: readonly Element[],
  pointName: 'trkpt' | 'rtept',
  warnings: GpxValidationWarning[],
  signal: AbortSignal | undefined,
): readonly TrackSegment[] {
  const segments: TrackSegment[] = [];
  let visitedPoints = 0;
  for (const [segmentIndex, candidate] of candidates.entries()) {
    throwIfAborted(signal);
    const pointElements = directChildren(candidate, pointName);
    const points: TrackPoint[] = [];
    for (const [pointIndex, pointElement] of pointElements.entries()) {
      visitedPoints += 1;
      if (visitedPoints > defaultLimits.maximumPoints) {
        throw new GpxParseError(
          'limit-exceeded',
          'GPX contains too many track points.',
        );
      }
      const point = parsePoint(pointElement, warnings, segmentIndex, pointIndex);
      if (point !== null) points.push(point);
    }
    if (points.length >= 2) {
      segments.push({ points });
    } else if (pointElements.length > 0) {
      addWarning(warnings, {
        code: 'short-segment',
        message: 'A segment with fewer than two valid points was skipped.',
        segmentIndex,
      });
    }
  }
  return segments;
}

function readMetadata(root: Element, selected: Element): GpxMetadataProjection {
  const metadata = firstChild(root, 'metadata');
  const author = metadata === undefined ? undefined : firstChild(metadata, 'author');
  const copyright =
    metadata === undefined ? undefined : firstChild(metadata, 'copyright');
  const copyrightYear = optionalFiniteNumber(
    boundedText(copyright === undefined ? undefined : firstChild(copyright, 'year')) ??
      null,
  );
  const selectedNumber = optionalFiniteNumber(
    boundedText(firstChild(selected, 'number')) ?? null,
  );
  const creator = root
    .getAttribute('creator')
    ?.trim()
    .slice(0, defaultLimits.maximumTextLength);
  const metadataTime = parseTimestamp(
    boundedText(metadata === undefined ? undefined : firstChild(metadata, 'time')),
  );
  const metadataName = boundedText(
    metadata === undefined ? undefined : firstChild(metadata, 'name'),
  );
  const metadataDescription = boundedText(
    metadata === undefined ? undefined : firstChild(metadata, 'desc'),
  );
  const metadataKeywords = boundedText(
    metadata === undefined ? undefined : firstChild(metadata, 'keywords'),
  );
  const authorName = boundedText(
    author === undefined ? undefined : firstChild(author, 'name'),
  );
  const copyrightLabel = copyright
    ?.getAttribute('author')
    ?.trim()
    .slice(0, defaultLimits.maximumTextLength);
  const selectedName = boundedText(firstChild(selected, 'name'));
  const selectedDescription = boundedText(firstChild(selected, 'desc'));
  const selectedComment = boundedText(firstChild(selected, 'cmt'));
  const selectedSource = boundedText(firstChild(selected, 'src'));
  const selectedType = boundedText(firstChild(selected, 'type'));
  return {
    version: root.getAttribute('version') as '1.0' | '1.1',
    ...(creator === undefined || creator.length === 0 ? {} : { creator }),
    ...(metadataName === undefined ? {} : { name: metadataName }),
    ...(metadataDescription === undefined ? {} : { description: metadataDescription }),
    ...(metadataTime === undefined ? {} : { time: metadataTime }),
    ...(metadataKeywords === undefined ? {} : { keywords: metadataKeywords }),
    ...(authorName === undefined ? {} : { authorName }),
    ...(copyrightLabel === undefined || copyrightLabel.length === 0
      ? {}
      : { copyrightLabel }),
    ...(copyrightYear === undefined ? {} : { copyrightYear }),
    links: parseLinks(metadata),
    ...(selectedName === undefined ? {} : { selectedName }),
    ...(selectedDescription === undefined ? {} : { selectedDescription }),
    ...(selectedComment === undefined ? {} : { selectedComment }),
    ...(selectedSource === undefined ? {} : { selectedSource }),
    ...(selectedType === undefined ? {} : { selectedType }),
    ...(selectedNumber === undefined ? {} : { selectedNumber }),
  };
}

/** Parses untrusted GPX XML into bounded, independent line segments. */
export function parseGpx(xml: string, options: ParseGpxOptions = {}): ParsedGpx {
  throwIfAborted(options.signal);
  const maximumBytes = options.maximumBytes ?? defaultLimits.maximumBytes;
  if (new TextEncoder().encode(xml).byteLength > maximumBytes) {
    throw new GpxParseError(
      'file-too-large',
      'GPX file is larger than the import limit.',
    );
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new GpxParseError(
      'unsafe-xml',
      'DTD and entity declarations are not supported.',
    );
  }

  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror') !== null) {
    throw new GpxParseError('invalid-xml', 'The file is not valid XML.');
  }
  const root = document.documentElement;
  if (root.localName !== 'gpx') {
    throw new GpxParseError('invalid-xml', 'The file does not contain a GPX document.');
  }
  const version = root.getAttribute('version');
  if (version !== '1.0' && version !== '1.1') {
    throw new GpxParseError(
      'unsupported-version',
      'Only GPX 1.0 and 1.1 are supported.',
    );
  }
  validateDocumentLimits(root);
  throwIfAborted(options.signal);

  const tracks = directChildren(root, 'trk');
  const routes = directChildren(root, 'rte');
  if (tracks.length + routes.length > defaultLimits.maximumTracksAndRoutes) {
    throw new GpxParseError(
      'limit-exceeded',
      'GPX contains too many tracks or routes.',
    );
  }
  const trackSegmentElements = tracks.flatMap((track) =>
    directChildren(track, 'trkseg'),
  );
  if (trackSegmentElements.length > defaultLimits.maximumSegments) {
    throw new GpxParseError('limit-exceeded', 'GPX contains too many track segments.');
  }

  const warnings: GpxValidationWarning[] = [];
  const trackSegments = parseSegments(
    trackSegmentElements,
    'trkpt',
    warnings,
    options.signal,
  );
  const geometryKind = trackSegments.length > 0 ? 'track' : 'route';
  const routeSegments =
    geometryKind === 'track'
      ? []
      : parseSegments(routes, 'rtept', warnings, options.signal);
  const segments = geometryKind === 'track' ? trackSegments : routeSegments;
  if (trackSegments.length > 0 && routes.length > 0) {
    addWarning(warnings, {
      code: 'track-preferred-over-route',
      message: 'Detailed track geometry was used instead of companion route geometry.',
    });
  }
  if (segments.length === 0) {
    throw new GpxParseError(
      'empty-geometry',
      'The GPX file has no renderable track or route.',
    );
  }
  const selected = geometryKind === 'track' ? tracks[0] : routes[0];
  if (selected === undefined) {
    throw new GpxParseError(
      'empty-geometry',
      'The GPX file has no renderable track or route.',
    );
  }
  return {
    parserVersion: GPX_PARSER_VERSION,
    geometryKind,
    segments,
    pointCount: segments.reduce((sum, segment) => sum + segment.points.length, 0),
    metadata: readMetadata(root, selected),
    warnings,
  };
}
