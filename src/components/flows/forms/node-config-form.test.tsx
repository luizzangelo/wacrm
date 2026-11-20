import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const TAG_ID = '69fd9abb-2898-4f18-b2a4-b322dffc8964';

describe('flow tag selector value', () => {
  it('renders the selected tag label instead of its stored id', () => {
    const tags = [{ id: TAG_ID, name: 'Atacado' }];
    const html = renderToStaticMarkup(
      <Select
        value={TAG_ID}
        items={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {tags.map((tag) => (
            <SelectItem key={tag.id} value={tag.id}>
              {tag.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>,
    );

    expect(html).toMatch(/data-slot="select-value"[^>]*>Atacado<\/span>/);
    expect(html).not.toMatch(
      new RegExp(`data-slot="select-value"[^>]*>${TAG_ID}`),
    );
  });
});
