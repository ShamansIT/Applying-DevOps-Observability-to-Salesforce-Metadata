import { describe, expect, it } from 'vitest';
import { main, selftest } from '../../src/experiment/cli.js';

describe('experiment cli', () => {
  it('runs the offline pipeline self-test', () => {
    expect(selftest()).toBe('experiment selftest: ok');
    expect(main(['selftest'])).toBe('experiment selftest: ok');
  });

  it('rejects an unknown command', () => {
    expect(() => main(['bogus'])).toThrow(/unknown command/);
  });

  it('needs an input path for schedule and power', () => {
    expect(() => main(['schedule'])).toThrow(/scenarios json/);
    expect(() => main(['power'])).toThrow(/pilot-diffs json/);
  });
});
