import { NextResponse } from 'next/server';
import { getJob, toPublicJob } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/jobs/:id — estado do processamento (usado como fallback do SSE). */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Análise não encontrada ou expirada.' } },
      { status: 404 },
    );
  }
  return NextResponse.json({ job: toPublicJob(job), reused: false });
}
