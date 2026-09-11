import { describe, expect, it } from 'vitest';

import { resolveSection, SECTION_META } from './settings-sections';

describe('Meta Conversions settings navigation', () => {
  it('resolves the Meta Conversions deep link', () => {
    expect(resolveSection('meta-conversions')).toBe('meta-conversions');
  });

  it('places Meta Conversions in the Workspace group', () => {
    expect(SECTION_META['meta-conversions'].group).toBe('workspace');
  });
});
