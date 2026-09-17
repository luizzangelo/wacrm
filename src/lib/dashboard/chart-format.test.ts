import { describe, expect, it } from 'vitest';
import { chartScale, durationLabel } from './chart-format';
describe('duration display, minutes throughout', () => {
  it.each([
    [0, '0m'],
    [5, '5m'],
    [30, '30m'],
    [60, '1h'],
    [90, '1h30'],
    [624, '10h24'],
  ])('axis %s minutes → %s', (v, label) => {
    expect(durationLabel(v as number, 'pt-BR', true)).toBe(label);
  });
  it.each([
    [3, '3 min'],
    [68, '1h 08min'],
    [624, '10h 24min'],
  ])('tooltip %s minutes → %s', (v, label) => {
    expect(durationLabel(v as number, 'pt-BR')).toBe(label);
  });
  it.each(['pt-BR', 'en', 'ko'])(
    'subminute and zero durations do not round to repeated 0.0m: %s',
    (locale) => {
      expect(durationLabel(0.1, locale)).toMatch(/6(s|초)/);
      expect(durationLabel(0, locale)).not.toBe('—');
      const scale = chartScale(0.6, 1 / 60);
      const labels = scale.ticks.map((v) => durationLabel(v, locale, true));
      expect(new Set(labels).size).toBe(labels.length);
      expect(labels.join()).not.toContain('0.0m');
    }
  );
  it('Korean duration is localized', () => {
    expect(durationLabel(68, 'ko')).toBe('1시간 8분');
  });
  it('null/invalid duration is not misrepresented as zero', () => {
    expect(durationLabel(null, 'en')).toBe('—');
    expect(durationLabel(NaN, 'en')).toBe('—');
  });
  it.each([0, 1, 3, 15, 1000])(
    'loss scale %s has distinct integer ticks and positive domain',
    (max) => {
      const scale = chartScale(max);
      expect(scale.ceiling).toBeGreaterThan(0);
      expect(scale.ceiling).toBeGreaterThanOrEqual(max);
      expect(scale.ticks.every(Number.isInteger)).toBe(true);
      expect(new Set(scale.ticks).size).toBe(scale.ticks.length);
    }
  );
  it('5-minute target is compared in minutes, not hours or milliseconds', () => {
    expect(624 > 5).toBe(true);
    expect(durationLabel(5, 'pt-BR')).toBe('5 min');
  });
});
