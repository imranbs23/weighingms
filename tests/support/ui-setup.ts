/**
 * The UI test setup — the DOM matchers.
 *
 * **And it is scoped to the client's tests only** — the setup file is
 * registered for the whole suite, so it must not assume a DOM. The
 * `jest-dom` matchers are added only when a document exists, which is the
 * `jsdom` environment.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  // The DOM cleanup is a no-op outside a DOM environment — and the
  // server tests never build a tree.
  if (typeof document !== 'undefined') {
    cleanup();
  }
});
