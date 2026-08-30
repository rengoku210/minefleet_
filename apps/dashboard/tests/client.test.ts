import { describe, it, expect } from 'vitest';
import { getAccessToken, setAccessToken } from '../src/api/client.js';

describe('Dashboard Client Utilities', () => {
  it('should store and retrieve access token', () => {
    setAccessToken('test-token-xyz');
    expect(getAccessToken()).toBe('test-token-xyz');

    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
  });
});
