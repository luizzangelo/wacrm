import { NextResponse } from 'next/server';
import {
  ForbiddenError,
  requireRole,
  UnauthorizedError,
} from '@/lib/auth/account';
import {
  DiagnosticFilterError,
  listEventDiagnostics,
  parseDiagnosticFilters,
} from '@/lib/meta-conversions/event-diagnostics';

export async function GET(request: Request) {
  try {
    const { accountId, supabase } = await requireRole('admin');
    const filters = parseDiagnosticFilters(new URL(request.url).searchParams);
    return NextResponse.json(
      await listEventDiagnostics(supabase, accountId, filters),
      {
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  } catch (error) {
    // Do not log raw database exceptions or return their messages.
    const status =
      error instanceof UnauthorizedError
        ? 401
        : error instanceof ForbiddenError
          ? 403
          : error instanceof DiagnosticFilterError
            ? 400
            : 500;
    return NextResponse.json(
      {
        error:
          status === 400 ? 'Filtros inválidos' : 'Diagnóstico indisponível',
      },
      {
        status,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  }
}
