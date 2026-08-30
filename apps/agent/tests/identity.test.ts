import { describe, it, expect } from 'vitest';
import { generateMachineUid } from '../src/utils/identity.js';

describe('Machine Identity', () => {
  it('should generate a UID with mf_ prefix', () => {
    const uid = generateMachineUid();
    expect(uid).toMatch(/^mf_[a-f0-9]{32}$/);
  });

  it('should generate consistent UIDs', () => {
    const uid1 = generateMachineUid();
    const uid2 = generateMachineUid();
    // Should be the same on the same machine
    expect(uid1).toBe(uid2);
  });
});
