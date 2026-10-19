import { describe, expect, it } from 'vitest';
import { dueAtFromInputs, taskTimingState } from './time';

describe('taskTimingState', () => {
  const now = new Date(2026, 9, 19, 12);

  it('classifica vencimento, hoje e amanhã', () => {
    expect(taskTimingState(new Date(2026, 9, 19, 11).toISOString(), now)).toBe(
      'overdue'
    );
    expect(taskTimingState(new Date(2026, 9, 19, 18).toISOString(), now)).toBe(
      'today'
    );
    expect(taskTimingState(new Date(2026, 9, 20, 10).toISOString(), now)).toBe(
      'tomorrow'
    );
  });
});

describe('dueAtFromInputs', () => {
  it('trata data sem horário como dia todo no fim do dia', () => {
    const result = dueAtFromInputs('2026-10-20', '');
    const due = new Date(result.due_at);
    expect(result.all_day).toBe(true);
    expect(due.getHours()).toBe(23);
    expect(due.getMinutes()).toBe(59);
  });

  it('preserva horário informado', () => {
    const result = dueAtFromInputs('2026-10-20', '14:30');
    const due = new Date(result.due_at);
    expect(result.all_day).toBe(false);
    expect([due.getHours(), due.getMinutes()]).toEqual([14, 30]);
  });
});
