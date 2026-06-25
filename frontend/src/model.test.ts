import { describe, expect, it } from 'vitest';
import { modeFootprint, nextChannelAddress } from './model';
import type { FixtureMode } from './types';

describe('DMX mode calculations', () => {
  it('uses the highest occupied byte as the footprint', () => {
    const mode = {
      id: 'm',
      name: 'test',
      channels: [
        { id: '1', address: 1, resolution: 16 },
        { id: '2', address: 10, resolution: 8 },
      ],
    } as FixtureMode;

    expect(modeFootprint(mode)).toBe(10);
    expect(nextChannelAddress(mode)).toBe(11);
  });

  it('starts empty modes at address 1', () => {
    expect(modeFootprint()).toBe(0);
    expect(nextChannelAddress()).toBe(1);
  });
});
