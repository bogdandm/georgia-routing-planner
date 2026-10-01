import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';

import { mswServer } from './mswServer';

// WorkspaceShell hydration crosses fake IndexedDB, GPX parsing, and several React
// commits. The one-second default for findBy*/waitFor expires on loaded CI runners and
// shared workstations; one suite-wide bound keeps tests free of per-call timeouts.
configure({ asyncUtilTimeout: 5_000 });

beforeAll(() => {
  mswServer.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  cleanup();
  mswServer.resetHandlers();
  vi.restoreAllMocks();
});

afterAll(() => {
  mswServer.close();
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  value: vi.fn(() => 'blob:test'),
});
Object.defineProperty(URL, 'revokeObjectURL', {
  configurable: true,
  value: vi.fn(),
});
