/** Minutes are the single internal unit (RPC, bars, summaries and target). */
export function durationLabel(
  minutes: number | null,
  locale: string,
  axis = false
): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const totalSeconds = Math.max(0, Math.round(minutes * 60));
  const ko = locale.startsWith('ko');
  if (totalSeconds > 0 && totalSeconds < 60)
    return `${totalSeconds}${ko ? '초' : 's'}`;
  const total = Math.round(totalSeconds / 60);
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  if (!hours) return `${total}${ko ? '분' : axis ? 'm' : ' min'}`;
  if (ko) return `${hours}시간${remainder ? ` ${remainder}분` : ''}`;
  if (axis)
    return `${hours}h${remainder ? String(remainder).padStart(2, '0') : ''}`;
  return `${hours}h${remainder ? ` ${String(remainder).padStart(2, '0')}min` : ''}`;
}

/** Explicit numeric ticks: stable zero domain, no duplicate rounded ticks. */
export function chartScale(max: number, minStep = 1) {
  const raw = Math.max(max / 4, minStep);
  const power = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / power;
  const step = Math.max(
    minStep,
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
      power
  );
  const ceiling = Math.max(step, Math.ceil(max / step) * step);
  return {
    ceiling,
    ticks: Array.from(
      { length: Math.round(ceiling / step) + 1 },
      (_, i) => i * step
    ),
  };
}

export const WEEKDAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;
