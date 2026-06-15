import { describe, it, expect } from 'vitest';
import { classifyControl } from './control';

describe('classifyControl', () => {
  it('matches STOP case- and whitespace-insensitively', () => {
    for (const s of ['STOP', 'stop', ' Stop ', 'sToP', '  S T O P  ', '\tstop\n']) {
      expect(classifyControl(s)).toBe('stop');
    }
  });

  it('matches START as a trimmed exact keyword', () => {
    for (const s of ['START', 'start', ' Start ']) {
      expect(classifyControl(s)).toBe('start');
    }
  });

  it('does not treat a sentence containing start/stop as control', () => {
    expect(classifyControl('how do I start my sourdough?')).toBeNull();
    expect(classifyControl('please stop by the shop')).toBeNull();
    expect(classifyControl('whats your best recipe')).toBeNull();
  });
});
