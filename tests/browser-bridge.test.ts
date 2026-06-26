import { describe, expect, test } from 'vitest';
import { parseBrowserBridgeEnvelope } from '../src/browser-bridge.js';

describe('parseBrowserBridgeEnvelope', () => {
  test('parses ok envelopes', () => {
    expect(parseBrowserBridgeEnvelope('{"ok":true,"result":{"courses":[]}}')).toMatchObject({
      ok: true,
      result: { courses: [] },
    });
  });

  test('normalizes adapter errors', () => {
    expect(
      parseBrowserBridgeEnvelope('{"ok":false,"error":{"code":"auth","message":"login needed"}}'),
    ).toMatchObject({
      ok: false,
      error: { code: 'auth', message: 'login needed' },
    });
  });

  test('reports invalid JSON', () => {
    expect(parseBrowserBridgeEnvelope('not json')).toMatchObject({
      ok: false,
      error: { code: 'invalid_envelope' },
    });
  });
});
