// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deal, PipelineStage } from '@/types';
import messages from '../../../messages/pt-BR.json';

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  move: vi.fn(),
  contacts: [
    { id: 'contact', name: 'Current contact', phone: 'fixture-phone' },
  ],
  changed: null as null | (() => Promise<void>),
  dragEnd: null as null | ((event: unknown) => void),
}));
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) =>
    `${namespace}.${key}`
      .split('.')
      .reduce(
        (value: unknown, part) => (value as Record<string, unknown>)[part],
        messages
      ),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ accountId: 'account', defaultCurrency: 'BRL' }),
}));
vi.mock('@/lib/deals/stage-client', () => ({
  requestDealStageMove: mocks.move,
}));
vi.mock('@/lib/meta-conversions/attribution-view', () => ({
  getDealMetaAttribution: async () => ({ attribution: null, source: null }),
}));
vi.mock('@/components/meta-conversions/meta-ads-attribution-card', () => ({
  MetaAdsAttributionCard: () => <div>Origem Meta Ads</div>,
}));
vi.mock('@/lib/supabase/client', () => {
  function chain(table: string) {
    const value = {
      select: () => value,
      order: () => value,
      eq: () => value,
      limit: () => value,
      maybeSingle: async () => ({ data: null }),
      insert: (data: unknown) => {
        mocks.insert(data);
        return Promise.resolve({ error: null });
      },
      update: (data: unknown) => {
        mocks.update(data);
        return value;
      },
      then: (done: (result: unknown) => unknown) =>
        Promise.resolve({
          data: table === 'contacts' ? mocks.contacts : [],
          error: null,
        }).then(done),
    };
    return value;
  }
  const client = {
    from: chain,
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'user' } } } }),
    },
    channel: () => ({
      on: (
        _event: unknown,
        _options: unknown,
        callback: () => Promise<void>
      ) => {
        mocks.changed = callback;
        return { subscribe: () => ({}) };
      },
    }),
    removeChannel: async () => {},
  };
  return { createClient: () => client };
});
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <section>{children}</section> : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  SheetTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <footer>{children}</footer>
  ),
}));
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragEnd: (event: unknown) => void;
  }) => {
    mocks.dragEnd = onDragEnd;
    return <div>{children}</div>;
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  useSensor: () => null,
  useSensors: () => [],
  PointerSensor: () => null,
  KeyboardSensor: () => null,
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
  useDraggable: () => ({
    setNodeRef: () => {},
    isDragging: false,
    attributes: {},
    listeners: {},
  }),
  closestCorners: () => null,
}));

import { DealForm } from './deal-form';
import { DealCard } from './deal-card';
import { PipelineBoard } from './pipeline-board';
const stages: PipelineStage[] = [
  {
    id: 'initial',
    pipeline_id: 'pipeline',
    name: 'Inicial',
    position: 0,
    color: '#123456',
    created_at: 'date',
  },
  {
    id: 'lead',
    pipeline_id: 'pipeline',
    name: 'Lead',
    position: 1,
    color: '#123456',
    created_at: 'date',
    meta_conversion_event: 'LeadSubmitted',
  },
  {
    id: 'lost',
    pipeline_id: 'pipeline',
    name: 'Not a textual identifier',
    position: -99,
    color: '#123456',
    created_at: 'date',
    is_lost_stage: true,
  },
];
const deal: Deal = {
  id: 'deal',
  user_id: 'user',
  pipeline_id: 'pipeline',
  stage_id: 'initial',
  contact_id: 'contact',
  contact: {
    id: 'contact',
    user_id: 'user',
    account_id: 'account',
    name: 'Current contact',
    phone: 'fixture-phone',
    created_at: 'date',
    updated_at: 'date',
  },
  title: 'Stale independent title',
  value: 100,
  currency: 'BRL',
  status: 'open',
  created_at: 'date',
  meta_attribution_id: 'frozen',
};
function form(existing?: Deal) {
  return render(
    <DealForm
      open
      onOpenChange={() => {}}
      deal={existing}
      pipelineId="pipeline"
      stages={stages}
      defaultStageId="lead"
      onSaved={() => {}}
    />
  );
}
beforeEach(() => {
  mocks.insert.mockReset();
  mocks.update.mockReset();
  mocks.move.mockReset().mockResolvedValue({});
  mocks.contacts = [
    { id: 'contact', name: 'Current contact', phone: 'fixture-phone' },
  ];
  mocks.changed = null;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('deal creation, contact display and deferred loss UX', () => {
  it.each([false, true])(
    'removes manual title in creation/edit (edit=%s)',
    async (edit) => {
      form(edit ? deal : undefined);
      await screen.findByText('Current contact', { selector: 'option' });
      expect(screen.queryByText('Título')).toBeNull();
      expect(screen.queryByPlaceholderText('Título do negócio')).toBeNull();
    }
  );
  it('shows initial stage but offers no stage selector during creation', async () => {
    form();
    await screen.findByText('Current contact', { selector: 'option' });
    expect(screen.getByText('Inicial')).toBeTruthy();
    expect(screen.queryByText('Lead', { selector: 'option' })).toBeNull();
    expect(
      screen.queryByText('Venda perdida', { selector: 'option' })
    ).toBeNull();
  });
  it('creates without independent title or client stage despite defaultStageId', async () => {
    form();
    await screen.findByText('Current contact', { selector: 'option' });
    const contactSelect = screen
      .getByText('Current contact', { selector: 'option' })
      .closest('select')!;
    fireEvent.change(contactSelect, { target: { value: 'contact' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar negócio' }));
    await waitFor(() => expect(mocks.insert).toHaveBeenCalledOnce());
    expect(mocks.insert.mock.calls[0][0]).not.toHaveProperty('title');
    expect(mocks.insert.mock.calls[0][0]).not.toHaveProperty('stage_id');
    expect(mocks.move).not.toHaveBeenCalled();
  });
  it('renders contact name instead of title and updates after contact rename', () => {
    const result = render(
      <DealCard deal={deal} stage={stages[0]} onEdit={() => {}} />
    );
    expect(screen.getByRole('heading').textContent).toBe('Current contact');
    expect(screen.queryByText(deal.title)).toBeNull();
    result.rerender(
      <DealCard
        deal={{
          ...deal,
          contact: { ...deal.contact!, name: 'Renamed contact' },
        }}
        stage={stages[0]}
        onEdit={() => {}}
      />
    );
    expect(screen.getByRole('heading').textContent).toBe('Renamed contact');
  });
  it('updates form name from contacts realtime without editing deals.title', async () => {
    form(deal);
    await screen.findByText('Current contact', { selector: 'option' });
    mocks.contacts = [
      { id: 'contact', name: 'Renamed contact', phone: 'fixture-phone' },
    ];
    await act(async () => {
      await mocks.changed?.();
    });
    expect(screen.getByText('Renamed contact', { selector: 'p' })).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('intercepts edit stage selection before any mutation and cancel leaves original stage', async () => {
    form(deal);
    await screen.findByText('Current contact', { selector: 'option' });
    const select = screen
      .getByText('Venda perdida', { selector: 'option' })
      .closest('select')!;
    fireEvent.change(select, { target: { value: 'lost' } });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(mocks.move).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Cancelar',
      })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(select.value).toBe('initial');
    expect(mocks.move).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('confirms form loss once through central route with reason and optional notes', async () => {
    form(deal);
    await screen.findByText('Current contact', { selector: 'option' });
    fireEvent.change(
      screen
        .getByText('Venda perdida', { selector: 'option' })
        .closest('select')!,
      { target: { value: 'lost' } }
    );
    const modal = within(screen.getByRole('dialog'));
    const confirm = modal.getByRole('button', { name: 'Confirmar perda' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(modal.getByLabelText('Motivo da perda'), {
      target: { value: 'other' },
    });
    fireEvent.change(modal.getByLabelText('Observação (opcional)'), {
      target: { value: 'Optional detail' },
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.move).toHaveBeenCalledOnce());
    expect(mocks.move).toHaveBeenCalledWith('deal', 'lost', undefined, {
      lostReason: 'other',
      lostReasonNotes: 'Optional detail',
    });
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('stage_id');
    expect(screen.getByText('Origem Meta Ads')).toBeTruthy();
  });
  it('shows stored reason only on the current technical lost stage', async () => {
    const result = form({
      ...deal,
      lost_reason: 'price',
      lost_reason_notes: 'History',
    });
    await screen.findByText('Current contact', { selector: 'option' });
    expect(screen.queryByLabelText('Motivo da perda')).toBeNull();
    result.unmount();
    form({
      ...deal,
      stage_id: 'lost',
      status: 'lost',
      lost_reason: 'price',
      lost_reason_notes: 'History',
    });
    await screen.findByText('Current contact', { selector: 'option' });
    expect(
      (screen.getByLabelText('Motivo da perda') as HTMLSelectElement).value
    ).toBe('price');
    expect(
      (screen.getByLabelText('Observação (opcional)') as HTMLTextAreaElement)
        .value
    ).toBe('History');
  });
  it('edits stored loss reason using same-stage RPC, not an outbox mutation', async () => {
    form({ ...deal, stage_id: 'lost', status: 'lost', lost_reason: 'price' });
    await screen.findByText('Current contact', { selector: 'option' });
    fireEvent.change(screen.getByLabelText('Motivo da perda'), {
      target: { value: 'other' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(mocks.move).toHaveBeenCalledOnce());
    expect(mocks.move).toHaveBeenCalledWith('deal', 'lost', undefined, {
      lostReason: 'other',
      lostReasonNotes: '',
    });
  });
  it('places technical lost column last regardless of name or position', () => {
    render(
      <PipelineBoard
        stages={stages}
        deals={[deal]}
        onDealMoved={async () => {}}
        onAddDeal={() => {}}
        onEditDeal={() => {}}
      />
    );
    expect(
      screen
        .getAllByRole('heading', { level: 3 })
        .map((node) => node.textContent)
    ).toEqual(['Inicial', 'Lead', 'Venda perdida']);
  });
  it('drag to lost opens reason dialog without mutation, and cancelling preserves the card', () => {
    const move = vi.fn(async () => {});
    render(
      <PipelineBoard
        stages={stages}
        deals={[deal]}
        onDealMoved={move}
        onAddDeal={() => {}}
        onEditDeal={() => {}}
      />
    );
    act(() => {
      mocks.dragEnd?.({ active: { id: 'deal' }, over: { id: 'lost' } });
    });
    expect(move).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Cancelar',
      })
    );
    expect(move).not.toHaveBeenCalled();
    expect(deal.stage_id).toBe('initial');
  });
  it('drag loss confirmation dispatches exactly once with selected reason', async () => {
    const move = vi.fn(async () => {});
    render(
      <PipelineBoard
        stages={stages}
        deals={[deal]}
        onDealMoved={move}
        onAddDeal={() => {}}
        onEditDeal={() => {}}
      />
    );
    act(() => {
      mocks.dragEnd?.({ active: { id: 'deal' }, over: { id: 'lost' } });
    });
    const modal = within(screen.getByRole('dialog'));
    fireEvent.change(modal.getByLabelText('Motivo da perda'), {
      target: { value: 'price' },
    });
    fireEvent.click(modal.getByRole('button', { name: 'Confirmar perda' }));
    await waitFor(() => expect(move).toHaveBeenCalledOnce());
    expect(move).toHaveBeenCalledWith('deal', 'lost', {
      lostReason: 'price',
      lostReasonNotes: null,
    });
  });
  it('normal drag continues through the existing stage-movement callback', () => {
    const move = vi.fn(async () => {});
    render(
      <PipelineBoard
        stages={stages}
        deals={[deal]}
        onDealMoved={move}
        onAddDeal={() => {}}
        onEditDeal={() => {}}
      />
    );
    act(() => {
      mocks.dragEnd?.({ active: { id: 'deal' }, over: { id: 'lead' } });
    });
    expect(move).toHaveBeenCalledWith('deal', 'lead');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
