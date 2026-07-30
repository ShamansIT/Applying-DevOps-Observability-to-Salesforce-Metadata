import { describe, expect, it } from 'vitest';
import { main, selftest } from '../../src/experiment/cli.js';

describe('experiment cli', () => {
  it('runs the offline pipeline self-test', async () => {
    expect(selftest()).toBe('experiment selftest: ok');
    expect(await main(['selftest'])).toBe('experiment selftest: ok');
  });

  it('generates and validates a balanced benchmark plan', async () => {
    const generated = JSON.parse(await main(['generate', 'main'])) as {
      mainScenarios: number;
      ok: boolean;
    };
    expect(generated.mainScenarios).toBe(72);
    expect(generated.ok).toBe(true);
    expect(await main(['validate-plan'])).toMatch(/ok, 72 main/);
  });

  it('runs an offline walking skeleton end to end', async () => {
    const report = await main(['walking-skeleton']);
    expect(report).toMatch(/walking skeleton/);
    expect(report).toMatch(/oracle fail/);
  });

  it('rejects an unknown command', async () => {
    await expect(main(['bogus'])).rejects.toThrow(/unknown command/);
  });

  it('needs an input path for schedule and power', async () => {
    await expect(main(['schedule'])).rejects.toThrow(/scenarios json/);
    await expect(main(['power'])).rejects.toThrow(/pilot-diffs json/);
  });

  it('refuses a live org command without a Dev Hub alias', async () => {
    await expect(main(['walking-skeleton:org', 'freeze-01'])).rejects.toThrow(/Dev Hub/);
    await expect(main(['pilot:org', 'freeze-01'])).rejects.toThrow(/Dev Hub/);
  });
});
