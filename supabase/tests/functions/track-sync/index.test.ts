import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14';
import type { SupabaseContext } from 'npm:@supabase/server@1.4.1';

import fixtureV1 from '../../../../tests/fixtures/track-sync/geometry-v1.json' with { type: 'json' };
import fixtureV2 from '../../../../tests/fixtures/track-sync/geometry-v2.json' with { type: 'json' };
import {
  TRACK_GEOMETRY_BUCKET,
  TRACK_QUOTA_BYTES,
} from '../../../functions/track-sync/internal/contracts.ts';
import {
  validateCanonicalGeometry,
  validateGeometryUpload,
} from '../../../functions/track-sync/internal/geometry.ts';
import { SupabaseTrackSyncGateway } from '../../../functions/track-sync/internal/supabase-track-sync-gateway.ts';
import { handleTrackSync } from '../../../functions/track-sync/track-sync.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const UPLOAD_ID = '33333333-3333-4333-8333-333333333333';
const CONTENT_HASH = fixtureV1.sha256;
const OBJECT_PATH = `${USER_ID}/${CONTENT_HASH}/${UPLOAD_ID}.grpt.gz`;

type RpcResult =
  | { readonly data: unknown; readonly error: null }
  | { readonly data: null; readonly error: { readonly message: string } };

interface Call {
  readonly kind: 'rpc' | 'list' | 'upload' | 'remove' | 'select';
  readonly name: string;
  readonly value?: unknown;
}

interface FakeState {
  readonly calls: Call[];
  readonly rpcResults: Map<string, RpcResult[]>;
  readonly rpcEffects: Map<string, () => void>;
  readonly objects: Set<string>;
  readonly activePaths: Set<string>;
  trackMetadata: Record<string, unknown> | null;
  usage: { readonly used_bytes: number; readonly reserved_bytes: number } | null;
  uploadError: {
    readonly message: string;
    readonly statusCode?: string | number;
  } | null;
  removeErrors: Array<{ readonly message: string } | null>;
}

function bytesFromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (value) => Number.parseInt(value, 16));
}

function varUint(value: number): number[] {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 128);
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
}

function v2ElevationEnvelope(elevationMeters: number): Uint8Array {
  const bytes = Uint8Array.from([
    0x47, 0x52, 0x50, 0x54, 2, 0x02, 1, 2, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  new DataView(bytes.buffer).setFloat64(11, elevationMeters, false);
  return bytes;
}

function queuedRpc(state: FakeState, name: string): RpcResult {
  const queue = state.rpcResults.get(name);
  if (queue === undefined || queue.length === 0) {
    return { data: { outcome: 'applied' }, error: null };
  }
  return queue.shift()!;
}

function directStorageEntries(
  state: FakeState,
  prefix: string,
): Array<{ id: string | null; name: string }> {
  const prefixWithSlash = `${prefix}/`;
  const children = new Map<string, string | null>();
  for (const path of state.objects) {
    if (!path.startsWith(prefixWithSlash)) continue;
    const remainder = path.slice(prefixWithSlash.length);
    const slash = remainder.indexOf('/');
    if (slash === -1) children.set(remainder, path);
    else children.set(remainder.slice(0, slash), null);
  }
  return Array.from(children, ([name, id]) => ({ id, name })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function makeState(): FakeState {
  return {
    calls: [],
    rpcResults: new Map(),
    rpcEffects: new Map(),
    objects: new Set(),
    activePaths: new Set(),
    trackMetadata: { lineageHash: CONTENT_HASH, geometryVersion: 1 },
    usage: null,
    uploadError: null,
    removeErrors: [],
  };
}

function makeContext(state: FakeState, userId = USER_ID): SupabaseContext {
  const bucket = {
    async list(
      prefix: string,
      options: { readonly offset: number; readonly limit: number },
    ) {
      state.calls.push({ kind: 'list', name: prefix });
      const entries = directStorageEntries(state, prefix);
      return {
        data: entries.slice(options.offset, options.offset + options.limit),
        error: null,
      };
    },
    async upload(
      path: string,
      body: ArrayBuffer,
      options: { readonly contentType: string },
    ) {
      state.calls.push({ kind: 'upload', name: path, value: { body, options } });
      if (state.uploadError !== null) return { data: null, error: state.uploadError };
      state.objects.add(path);
      return { data: { path }, error: null };
    },
    async remove(paths: readonly string[]) {
      state.calls.push({ kind: 'remove', name: TRACK_GEOMETRY_BUCKET, value: paths });
      const error = state.removeErrors.shift() ?? null;
      if (error === null) {
        for (const path of paths) state.objects.delete(path);
      }
      return { data: null, error };
    },
  };

  const admin = {
    storage: {
      from(name: string) {
        assertEquals(name, TRACK_GEOMETRY_BUCKET);
        return bucket;
      },
    },
    async rpc(name: string, parameters: Record<string, unknown>) {
      assertEquals(this, admin);
      state.calls.push({ kind: 'rpc', name, value: parameters });
      state.rpcEffects.get(name)?.();
      return queuedRpc(state, name);
    },
    from(table: string) {
      return {
        select() {
          const filters = new Map<string, unknown>();
          const builder = {
            eq(column: string, value: unknown) {
              filters.set(column, value);
              return builder;
            },
            order(column: string) {
              assertEquals(column, 'object_path');
              return builder;
            },
            async range(start: number, end: number) {
              state.calls.push({
                kind: 'select',
                name: table,
                value: { userId: filters.get('user_id'), start, end },
              });
              const paths = Array.from(state.activePaths, (object_path) => ({
                object_path,
              })).sort((left, right) =>
                left.object_path.localeCompare(right.object_path),
              );
              return { data: paths.slice(start, end + 1), error: null };
            },
            then(resolve: (value: unknown) => void) {
              state.calls.push({
                kind: 'select',
                name: table,
                value: filters.get('user_id'),
              });
              if (table === 'track_records') {
                resolve({
                  data: Array.from(state.activePaths, (object_path) => ({
                    object_path,
                  })),
                  error: null,
                });
              } else {
                resolve({ data: state.usage, error: null });
              }
            },
            async maybeSingle() {
              state.calls.push({
                kind: 'select',
                name: table,
                value: Object.fromEntries(filters),
              });
              if (table === 'track_records') {
                return {
                  data:
                    state.trackMetadata === null
                      ? null
                      : { metadata: state.trackMetadata },
                  error: null,
                };
              }
              return { data: state.usage, error: null };
            },
          };
          return builder;
        },
      };
    },
  };

  return {
    authMode: 'user',
    authKeyName: undefined,
    userClaims: { id: userId },
    jwtClaims: { sub: userId },
    supabase: {},
    supabaseAdmin: admin,
  } as unknown as SupabaseContext;
}

function jsonRequest(value: unknown): Request {
  return new Request('https://example.test/track-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

function syncMetadata(values: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Synthetic track',
    lineageHash: CONTENT_HASH,
    geometryVersion: 1,
    ...values,
  };
}

function uploadRequest(
  overrides: {
    readonly contentHash?: string;
    readonly baseRevision?: number;
    readonly compressedBytes?: number;
    readonly gzipHex?: string;
    readonly metadata?: unknown;
  } = {},
): Request {
  const geometry = bytesFromHex(overrides.gzipHex ?? fixtureV1.gzipHex);
  const form = new FormData();
  form.set('action', 'upload');
  form.set('baseRevision', String(overrides.baseRevision ?? 0));
  form.set('contentHash', overrides.contentHash ?? CONTENT_HASH);
  form.set('compressedBytes', String(overrides.compressedBytes ?? geometry.byteLength));
  form.set('metadata', JSON.stringify(overrides.metadata ?? syncMetadata()));
  form.set(
    'geometry',
    new File([new Uint8Array(geometry).buffer], 'geometry.grpt.gz', {
      type: 'application/gzip',
    }),
  );
  return new Request('https://example.test/track-sync', { method: 'POST', body: form });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function captureConsoleErrors(
  run: () => Promise<Response>,
): Promise<{ readonly response: Response; readonly messages: readonly string[] }> {
  const messages: string[] = [];
  const original = console.error;
  console.error = (...values: unknown[]) => {
    messages.push(values.map(String).join(' '));
  };
  try {
    return { response: await run(), messages };
  } finally {
    console.error = original;
  }
}

Deno.test('both shared GRPT fixtures match their envelope and hash', async () => {
  for (const [fixture, version] of [
    [fixtureV1, 1],
    [fixtureV2, 2],
  ] as const) {
    const canonical = bytesFromHex(fixture.canonicalHex);
    assertEquals(validateCanonicalGeometry(canonical), version);
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new Uint8Array(canonical).buffer),
    );
    const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
    assertEquals(hash, fixture.sha256);
    assertEquals(
      await validateGeometryUpload(bytesFromHex(fixture.gzipHex), fixture.sha256),
      {
        geometryVersion: version,
        lineageHash: version === 1 ? fixtureV1.sha256 : fixtureV2.lineageSha256,
      },
    );
  }
});

Deno.test(
  'unsupported codecs and malformed envelopes are rejected deterministically',
  () => {
    const unsupported = bytesFromHex(fixtureV1.canonicalHex);
    unsupported[4] = 3;
    assertThrows(
      () => validateCanonicalGeometry(unsupported),
      Error,
      'Only GRPT codec versions 1 and 2',
    );
    for (const [fixture, unknownFlag] of [
      [fixtureV1, 0x02],
      [fixtureV2, 0x04],
    ] as const) {
      const unsupportedFlags = bytesFromHex(fixture.canonicalHex);
      unsupportedFlags[5] = unknownFlag;
      assertThrows(
        () => validateCanonicalGeometry(unsupportedFlags),
        Error,
        'unsupported flags',
      );
    }
    assertThrows(
      () => validateCanonicalGeometry(bytesFromHex(`${fixtureV1.canonicalHex}00`)),
      Error,
      'trailing bytes',
    );
    assertEquals(
      validateCanonicalGeometry(
        Uint8Array.from([0x47, 0x52, 0x50, 0x54, 2, 0, 1, 2, 0, 0, 0, 0]),
      ),
      2,
    );
    assertThrows(
      () =>
        validateCanonicalGeometry(
          Uint8Array.from([0x47, 0x52, 0x50, 0x54, 1, 0x01, 1, 2, 0, 0, 0, 0, 0, 0]),
        ),
      Error,
      'timestamp flag is not canonical',
    );
    assertThrows(
      () =>
        validateCanonicalGeometry(
          Uint8Array.from([0x47, 0x52, 0x50, 0x54, 1, 0, 0x81, 0]),
        ),
      Error,
      'non-canonical integer',
    );
  },
);

Deno.test('v2 elevations and browser geometry limits are enforced', () => {
  const invalidTag = Uint8Array.from([0x47, 0x52, 0x50, 0x54, 2, 0x02, 1, 2, 0, 0, 2]);
  const truncatedValue = Uint8Array.from([
    0x47, 0x52, 0x50, 0x54, 2, 0x02, 1, 2, 0, 0, 1, 0, 0,
  ]);
  for (const malformed of [
    invalidTag,
    truncatedValue,
    v2ElevationEnvelope(Number.NaN),
    v2ElevationEnvelope(Number.POSITIVE_INFINITY),
    v2ElevationEnvelope(Number.NEGATIVE_INFINITY),
  ]) {
    assertThrows(
      () => validateCanonicalGeometry(malformed),
      Error,
      'invalid elevation',
    );
  }

  for (const version of [1, 2]) {
    assertThrows(
      () =>
        validateCanonicalGeometry(
          Uint8Array.from([0x47, 0x52, 0x50, 0x54, version, 0, ...varUint(513)]),
        ),
      Error,
      'invalid segment count',
    );
    assertThrows(
      () =>
        validateCanonicalGeometry(
          Uint8Array.from([0x47, 0x52, 0x50, 0x54, version, 0, 1, ...varUint(100_001)]),
        ),
      Error,
      'too many points',
    );
  }
});

Deno.test(
  'lineage metadata and envelope versions are validated before backend access',
  async () => {
    const invalidUploads = [
      uploadRequest({ metadata: { name: 'Missing lineage' } }),
      uploadRequest({
        metadata: { lineageHash: 'A'.repeat(64), geometryVersion: 1 },
      }),
      uploadRequest({
        metadata: { lineageHash: CONTENT_HASH, geometryVersion: 3 },
      }),
      uploadRequest({
        metadata: { lineageHash: CONTENT_HASH, geometryVersion: 2 },
      }),
      uploadRequest({
        contentHash: fixtureV2.sha256,
        gzipHex: fixtureV2.gzipHex,
        metadata: { lineageHash: CONTENT_HASH },
      }),
      uploadRequest({
        contentHash: fixtureV2.sha256,
        gzipHex: fixtureV2.gzipHex,
        metadata: { lineageHash: CONTENT_HASH, geometryVersion: 1 },
      }),
      uploadRequest({
        contentHash: fixtureV2.sha256,
        gzipHex: fixtureV2.gzipHex,
        metadata: { lineageHash: 'b'.repeat(64), geometryVersion: 2 },
      }),
    ];

    for (const request of invalidUploads) {
      const state = makeState();
      const response = await handleTrackSync(request, makeContext(state));
      assertEquals(response.status, 400);
      assertEquals(
        ((await responseJson(response)).error as Record<string, unknown>).code,
        'invalid_metadata',
      );
      assertEquals(state.calls.length, 0);
    }

    const state = makeState();
    state.rpcResults.set('reserve_track_upload', [
      {
        data: {
          outcome: 'conflict',
          record: { content_hash: fixtureV2.sha256, revision: 1 },
        },
        error: null,
      },
    ]);
    const validV2 = await handleTrackSync(
      uploadRequest({
        contentHash: fixtureV2.sha256,
        gzipHex: fixtureV2.gzipHex,
        metadata: { lineageHash: fixtureV2.lineageSha256, geometryVersion: 2 },
      }),
      makeContext(state),
    );
    assertEquals(validV2.status, 200);
    assertEquals(
      state.calls.filter((call) => call.kind === 'rpc').map((call) => call.name),
      ['reserve_track_upload'],
    );
  },
);

Deno.test('metadata mutations cannot change a stored lineage identity', async () => {
  const state = makeState();
  const response = await handleTrackSync(
    jsonRequest({
      action: 'metadata',
      contentHash: CONTENT_HASH,
      baseRevision: 7,
      metadata: syncMetadata({
        lineageHash: 'b'.repeat(64),
        geometryVersion: 2,
      }),
    }),
    makeContext(state),
  );

  assertEquals(response.status, 400);
  assertEquals(
    ((await responseJson(response)).error as Record<string, unknown>).code,
    'invalid_metadata',
  );
  assertEquals(
    state.calls.some(
      (call) => call.kind === 'rpc' && call.name === 'apply_track_metadata',
    ),
    false,
  );

  const legacyState = makeState();
  legacyState.trackMetadata = {};
  const upgraded = await handleTrackSync(
    jsonRequest({
      action: 'metadata',
      contentHash: CONTENT_HASH,
      baseRevision: 7,
      metadata: syncMetadata({ name: 'Legacy metadata' }),
    }),
    makeContext(legacyState),
  );
  assertEquals(upgraded.status, 200);
  assertEquals(
    legacyState.calls.some(
      (call) => call.kind === 'rpc' && call.name === 'apply_track_metadata',
    ),
    true,
  );
});

Deno.test(
  'invalid verified claims and invalid request bodies are rejected before backend access',
  async () => {
    const state = makeState();
    const context = makeContext(state);
    const invalidContext = { ...context, userClaims: null } as SupabaseContext;
    const invalidJwt = await handleTrackSync(
      jsonRequest({ action: 'status' }),
      invalidContext,
    );
    assertEquals(invalidJwt.status, 401);

    const invalidBody = await handleTrackSync(
      jsonRequest({ action: 'delete', contentHash: 'not-a-hash', baseRevision: 0 }),
      context,
    );
    assertEquals(invalidBody.status, 400);

    const clientIdentity = await handleTrackSync(
      jsonRequest({
        action: 'delete',
        contentHash: CONTENT_HASH,
        baseRevision: 0,
        user_id: OTHER_USER_ID,
      }),
      context,
    );
    assertEquals(clientIdentity.status, 400);

    const removedPurge = await handleTrackSync(
      jsonRequest({ action: 'purge' }),
      context,
    );
    assertEquals(removedPurge.status, 400);
    assertEquals(await responseJson(removedPurge), {
      error: {
        code: 'invalid_action',
        message: 'Unsupported track synchronization action.',
      },
    });
    assertEquals(state.calls.length, 0);
  },
);

Deno.test('a geometry hash mismatch is rejected before reservation', async () => {
  const state = makeState();
  const response = await handleTrackSync(
    uploadRequest({ contentHash: 'a'.repeat(64) }),
    makeContext(state),
  );
  assertEquals(response.status, 400);
  assertEquals((await responseJson(response)).error, {
    code: 'content_hash_mismatch',
    message: 'Declared and computed geometry hashes differ.',
  });
  assertEquals(state.calls.length, 0);
});

Deno.test(
  'quota errors include authoritative usage without accepting client quota values',
  async () => {
    const state = makeState();
    state.usage = { used_bytes: TRACK_QUOTA_BYTES - 10, reserved_bytes: 10 };
    state.rpcResults.set('reserve_track_upload', [
      { data: null, error: { message: 'track geometry quota exceeded' } },
    ]);
    const response = await handleTrackSync(uploadRequest(), makeContext(state));
    assertEquals(response.status, 413);
    assertEquals(await responseJson(response), {
      usedBytes: TRACK_QUOTA_BYTES - 10,
      reservedBytes: 10,
      limitBytes: TRACK_QUOTA_BYTES,
      error: { code: 'quota_exceeded', message: 'Track geometry quota exceeded.' },
    });
  },
);

Deno.test(
  'conflict, existing, upload, and missing RPC outcomes remain explicit',
  async () => {
    for (const outcome of ['conflict', 'existing', 'missing'] as const) {
      const state = makeState();
      state.rpcResults.set('apply_track_metadata', [
        { data: { outcome }, error: null },
      ]);
      const response = await handleTrackSync(
        jsonRequest({
          action: 'metadata',
          contentHash: CONTENT_HASH,
          baseRevision: 7,
          metadata: syncMetadata({ name: 'Updated' }),
        }),
        makeContext(state),
      );
      assertEquals((await responseJson(response)).outcome, outcome);
    }

    const state = makeState();
    state.rpcResults.set('reserve_track_upload', [
      { data: { outcome: 'upload', objectPath: OBJECT_PATH }, error: null },
    ]);
    state.rpcResults.set('finalize_track_upload', [
      {
        data: {
          outcome: 'applied',
          record: { content_hash: CONTENT_HASH, revision: 1 },
        },
        error: null,
      },
    ]);
    const response = await handleTrackSync(uploadRequest(), makeContext(state));
    assertEquals((await responseJson(response)).outcome, 'applied');
    assert(state.objects.has(OBJECT_PATH));
    const uploadCall = state.calls.find((call) => call.kind === 'upload');
    const uploadValue = uploadCall?.value as
      | {
          readonly body: ArrayBuffer;
          readonly options: { readonly contentType: string };
        }
      | undefined;
    assert(uploadValue !== undefined);
    assert(uploadValue.body instanceof ArrayBuffer);
    assertEquals(uploadValue.options.contentType, 'application/gzip');
    assertEquals(new Uint8Array(uploadValue.body), bytesFromHex(fixtureV1.gzipHex));
  },
);

Deno.test(
  'storage upload failures are logged safely, return a bounded code, and release',
  async () => {
    const state = makeState();
    state.uploadError = {
      message:
        `provider rejected ${USER_ID}/${CONTENT_HASH} for user@example.test ` +
        'Bearer private-token',
      statusCode: 500,
    };
    state.rpcResults.set('reserve_track_upload', [
      { data: { outcome: 'upload', objectPath: OBJECT_PATH }, error: null },
    ]);

    const { response, messages } = await captureConsoleErrors(
      async () => await handleTrackSync(uploadRequest(), makeContext(state)),
    );
    const body = await responseJson(response);

    assertEquals(response.status, 502);
    assertEquals(body, {
      error: {
        code: 'storage_upload_failed',
        message: 'Track geometry storage is unavailable.',
      },
    });
    assertEquals(messages.length, 1);
    assertEquals(JSON.parse(messages[0]!), {
      event: 'track_sync_failure',
      method: 'POST',
      action: 'upload',
      status: 502,
      code: 'storage_upload_failed',
      cause: {
        message:
          'provider rejected [redacted-uuid]/[redacted-hash] for [redacted-email] [redacted-token]',
        statusCode: 500,
      },
    });
    const release = state.calls.find((call) => call.name === 'release_track_upload');
    assertEquals(release?.value, {
      p_user_id: USER_ID,
      p_content_hash: CONTENT_HASH,
      p_object_path: OBJECT_PATH,
    });
  },
);

Deno.test(
  'unexpected RPC failures are logged safely without exposing details',
  async () => {
    const state = makeState();
    state.rpcResults.set('apply_track_metadata', [
      {
        data: null,
        error: {
          message: `database rejected ${USER_ID}/${CONTENT_HASH} for user@example.test`,
        },
      },
    ]);

    const { response, messages } = await captureConsoleErrors(
      async () =>
        await handleTrackSync(
          jsonRequest({
            action: 'metadata',
            contentHash: CONTENT_HASH,
            baseRevision: 7,
            metadata: syncMetadata({ name: 'Updated' }),
          }),
          makeContext(state),
        ),
    );

    assertEquals(response.status, 500);
    assertEquals(await responseJson(response), {
      error: {
        code: 'internal_error',
        message: 'Track synchronization failed.',
      },
    });
    assertEquals(messages.length, 1);
    assertEquals(JSON.parse(messages[0]!), {
      event: 'track_sync_failure',
      method: 'POST',
      action: 'metadata',
      status: 500,
      code: 'internal_error',
      cause: {
        name: 'Error',
        message:
          'apply_track_metadata failed: database rejected [redacted-uuid]/[redacted-hash] for [redacted-email]',
      },
    });
  },
);

Deno.test(
  'a stale upload returns the current record without storing geometry',
  async () => {
    const state = makeState();
    state.rpcResults.set('reserve_track_upload', [
      {
        data: {
          outcome: 'conflict',
          record: { content_hash: CONTENT_HASH, revision: 12 },
        },
        error: null,
      },
    ]);

    const response = await handleTrackSync(
      uploadRequest({ baseRevision: 7 }),
      makeContext(state),
    );

    assertEquals((await responseJson(response)).outcome, 'conflict');
    assertEquals(
      (
        state.calls.find((call) => call.name === 'reserve_track_upload')
          ?.value as Record<string, unknown>
      ).p_base_revision,
      7,
    );
    assertEquals(
      state.calls.some((call) => call.kind === 'upload'),
      false,
    );
  },
);

Deno.test(
  'a reservation path for another user is rejected without storage access',
  async () => {
    const state = makeState();
    state.rpcResults.set('reserve_track_upload', [
      {
        data: {
          outcome: 'upload',
          objectPath: `${OTHER_USER_ID}/${CONTENT_HASH}/${UPLOAD_ID}.grpt.gz`,
        },
        error: null,
      },
    ]);
    const response = await handleTrackSync(uploadRequest(), makeContext(state));
    assertEquals(response.status, 500);
    assertEquals(
      state.calls.filter((call) => call.kind === 'rpc').map((call) => call.name),
      ['reserve_track_upload'],
    );
    assertEquals(
      state.calls.some((call) => call.kind === 'upload'),
      false,
    );
  },
);

Deno.test(
  'Asset Already Exists is finalized as a concurrent upload without compensation',
  async () => {
    const state = makeState();
    state.uploadError = { message: 'The resource already exists', statusCode: '409' };
    state.rpcResults.set('reserve_track_upload', [
      { data: { outcome: 'upload', objectPath: OBJECT_PATH }, error: null },
    ]);
    state.rpcResults.set('finalize_track_upload', [
      {
        data: {
          outcome: 'existing',
          record: { content_hash: CONTENT_HASH, revision: 1 },
        },
        error: null,
      },
    ]);
    const response = await handleTrackSync(uploadRequest(), makeContext(state));
    assertEquals((await responseJson(response)).outcome, 'existing');
    assertEquals(
      state.calls.some((call) => call.name === 'release_track_upload'),
      false,
    );
    assertEquals(
      state.calls.some((call) => call.kind === 'remove'),
      false,
    );
  },
);

Deno.test(
  'finalization failure removes only this upload and releases its reservation',
  async () => {
    const state = makeState();
    state.rpcResults.set('reserve_track_upload', [
      { data: { outcome: 'upload', objectPath: OBJECT_PATH }, error: null },
    ]);
    state.rpcResults.set('finalize_track_upload', [
      { data: null, error: { message: 'finalize failed' } },
    ]);
    const response = await handleTrackSync(uploadRequest(), makeContext(state));
    assertEquals(response.status, 500);
    assertEquals(state.objects.has(OBJECT_PATH), false);
    assertEquals(
      state.calls.filter((call) => call.kind === 'rpc').map((call) => call.name),
      ['reserve_track_upload', 'finalize_track_upload', 'release_track_upload'],
    );
  },
);

Deno.test(
  'reservation release still runs when compensating object deletion fails',
  async () => {
    const state = makeState();
    state.removeErrors.push({ message: 'storage unavailable' });
    state.rpcResults.set('reserve_track_upload', [
      { data: { outcome: 'upload', objectPath: OBJECT_PATH }, error: null },
    ]);
    state.rpcResults.set('finalize_track_upload', [
      { data: null, error: { message: 'finalize failed' } },
    ]);
    const { response, messages } = await captureConsoleErrors(
      async () => await handleTrackSync(uploadRequest(), makeContext(state)),
    );
    assertEquals(response.status, 500);
    assert(state.objects.has(OBJECT_PATH));
    assert(state.calls.some((call) => call.name === 'release_track_upload'));
    assertEquals(messages.length, 1);
    assertEquals(JSON.parse(messages[0]!), {
      event: 'track_sync_failure',
      method: 'POST',
      action: 'upload',
      status: 500,
      code: 'internal_error',
      cause: {
        name: 'AggregateError',
        message: 'Track upload finalization failed.',
        errors: [
          {
            name: 'Error',
            message: 'finalize_track_upload failed: finalize failed',
          },
          {
            name: 'Error',
            message:
              'Uploaded object cleanup failed: Unable to delete track geometry: storage unavailable',
          },
        ],
      },
    });
  },
);

Deno.test(
  'hard deletion commits before idempotent object removal and returns no tombstone',
  async () => {
    const state = makeState();
    state.objects.add(OBJECT_PATH);
    state.activePaths.add(OBJECT_PATH);
    state.rpcResults.set('delete_track', [
      { data: { outcome: 'applied', objectPath: OBJECT_PATH }, error: null },
    ]);
    const response = await handleTrackSync(
      jsonRequest({ action: 'delete', contentHash: CONTENT_HASH, baseRevision: 3 }),
      makeContext(state),
    );
    const deleteCall = state.calls.findIndex((call) => call.name === 'delete_track');
    const removeCall = state.calls.findIndex((call) => call.kind === 'remove');
    assert(deleteCall >= 0 && removeCall > deleteCall);
    assertEquals(await responseJson(response), { outcome: 'applied' });
    assertEquals(state.objects.has(OBJECT_PATH), false);
  },
);

Deno.test(
  'orphan cleanup preserves every current reserved or ready path and removes absent paths',
  async () => {
    const state = makeState();
    const orphanPath = `${USER_ID}/${CONTENT_HASH}/44444444-4444-4444-8444-444444444444.grpt.gz`;
    state.objects.add(OBJECT_PATH);
    state.objects.add(orphanPath);
    state.activePaths.add(OBJECT_PATH);
    await new SupabaseTrackSyncGateway(makeContext(state), USER_ID).cleanupOrphans();
    assert(state.objects.has(OBJECT_PATH));
    assertEquals(state.objects.has(orphanPath), false);
    assertEquals(
      state.calls.filter((call) => call.kind === 'remove').map((call) => call.value),
      [[orphanPath]],
    );
  },
);

Deno.test(
  'orphan cleanup accepts and fully pages the exact active-path bound',
  async () => {
    const state = makeState();
    for (let index = 0; index < 10_000; index += 1) {
      const uploadId = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
      const path = `${USER_ID}/${CONTENT_HASH}/${uploadId}.grpt.gz`;
      state.activePaths.add(path);
      if (index === 0) state.objects.add(path);
    }
    const orphanPath = `${USER_ID}/${CONTENT_HASH}/77777777-7777-4777-8777-777777777777.grpt.gz`;
    state.objects.add(orphanPath);

    await new SupabaseTrackSyncGateway(makeContext(state), USER_ID).cleanupOrphans();

    assertEquals(state.objects.size, 1);
    assertEquals(state.objects.has(orphanPath), false);
    assertEquals(state.calls.filter((call) => call.kind === 'select').length, 11);
  },
);

Deno.test(
  'a deletion and metadata race returns missing without creating a row',
  async () => {
    const state = makeState();
    state.rpcResults.set('apply_track_metadata', [
      { data: { outcome: 'missing' }, error: null },
    ]);
    const response = await handleTrackSync(
      jsonRequest({
        action: 'metadata',
        contentHash: CONTENT_HASH,
        baseRevision: 9,
        metadata: syncMetadata({ name: 'Late update' }),
      }),
      makeContext(state),
    );
    assertEquals(await responseJson(response), { outcome: 'missing' });
    const rpc = state.calls.find((call) => call.name === 'apply_track_metadata');
    assertEquals((rpc?.value as Record<string, unknown>).p_base_revision, 9);
  },
);

Deno.test('status cleans orphans before returning quota', async () => {
  const state = makeState();
  state.usage = { used_bytes: 123, reserved_bytes: 45 };
  const orphanPath = `${USER_ID}/${CONTENT_HASH}/55555555-5555-4555-8555-555555555555.grpt.gz`;
  state.objects.add(orphanPath);
  const status = await handleTrackSync(
    jsonRequest({ action: 'status' }),
    makeContext(state),
  );
  assertEquals(await responseJson(status), {
    usedBytes: 123,
    reservedBytes: 45,
    limitBytes: TRACK_QUOTA_BYTES,
  });
  assertEquals(state.objects.size, 0);
});

Deno.test(
  'oversized and malformed upload declarations fail without filesystem, network, or environment access',
  async () => {
    const state = makeState();
    const response = await handleTrackSync(
      uploadRequest({ compressedBytes: TRACK_QUOTA_BYTES + 1 }),
      makeContext(state),
    );
    assertEquals(response.status, 400);
    const malformed = await handleTrackSync(
      uploadRequest({ gzipHex: '00' }),
      makeContext(state),
    );
    assertEquals(malformed.status, 400);
  },
);

Deno.test(
  'marker commands use the verified owner and preserve bounded outcomes',
  async () => {
    const state = makeState();
    state.rpcResults.set('upsert_marker', [
      {
        data: {
          outcome: 'applied',
          record: {
            marker_id: 'marker-a',
            revision: 1,
            payload: {
              schemaVersion: 1,
              id: 'marker-a',
              name: 'Marker',
              normalizedName: 'marker',
              coordinate: [44.8, 41.7],
              iconKey: 'place',
              colorKey: 'blue',
              createdAt: '2026-08-10T00:00:00.000Z',
              updatedAt: '2026-08-10T00:00:00.000Z',
            },
          },
        },
        error: null,
      },
    ]);
    const response = await handleTrackSync(
      jsonRequest({
        action: 'marker-upsert',
        markerId: 'marker-a',
        baseRevision: 0,
        marker: {
          schemaVersion: 1,
          id: 'marker-a',
          name: 'Marker',
          normalizedName: 'marker',
          coordinate: [44.8, 41.7],
          iconKey: 'place',
          colorKey: 'blue',
          createdAt: '2026-08-10T00:00:00.000Z',
          updatedAt: '2026-08-10T00:00:00.000Z',
        },
      }),
      makeContext(state),
    );
    assertEquals(response.status, 200);
    assertEquals((await responseJson(response)).outcome, 'applied');
    assertEquals(state.calls.find((call) => call.name === 'upsert_marker')?.value, {
      p_user_id: USER_ID,
      p_marker_id: 'marker-a',
      p_payload: {
        schemaVersion: 1,
        id: 'marker-a',
        name: 'Marker',
        normalizedName: 'marker',
        coordinate: [44.8, 41.7],
        iconKey: 'place',
        colorKey: 'blue',
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-10T00:00:00.000Z',
      },
      p_base_revision: 0,
    });
  },
);

Deno.test('marker limits are bounded conflict responses', async () => {
  const state = makeState();
  state.rpcResults.set('upsert_marker', [{ data: { outcome: 'limit' }, error: null }]);
  const response = await handleTrackSync(
    jsonRequest({
      action: 'marker-upsert',
      markerId: 'marker-a',
      baseRevision: 0,
      marker: {
        schemaVersion: 1,
        id: 'marker-a',
        name: 'Marker',
        normalizedName: 'marker',
        coordinate: [44.8, 41.7],
        iconKey: 'place',
        colorKey: 'blue',
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-10T00:00:00.000Z',
      },
    }),
    makeContext(state),
  );
  assertEquals(response.status, 409);
  assertEquals((await responseJson(response)).error, {
    code: 'marker_limit',
    message: 'Cloud marker limit reached.',
  });
});
