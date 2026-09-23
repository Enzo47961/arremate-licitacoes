import { toPublicError } from '@/lib/errors';
import { renderReportHtml } from '@/lib/report/document';
import { getAnalysis } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Página HTML mínima para erros — evita devolver JSON cru numa aba do browser. */
function errorPage(title: string, detail: string, status: number): Response {
  return new Response(
    `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · Analisador Inteligente de Editais</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif; background:#f6f8fb; color:#0f172a; }
  .card { max-width: 32rem; margin: 1.5rem; padding: 2rem; background:#fff; border:1px solid #dee5ef;
          border-radius: 1.25rem; box-shadow: 0 24px 48px -16px rgb(15 23 42 / .22); }
  h1 { font-size: 1.35rem; margin: 0 0 .75rem; }
  p { color:#43536b; line-height:1.6; margin: 0 0 .75rem; }
  a { display:inline-block; margin-top: .75rem; padding: .7rem 1.2rem; border-radius: .75rem;
      background:#2748e3; color:#fff; text-decoration:none; font-weight:500; font-size:.9rem; }
</style></head>
<body><div class="card">
  <h1>${title}</h1>
  <p>${detail}</p>
  <p>Os resultados das análises ficam em memória no servidor por até 6 horas. Envie o edital novamente para gerar um
     novo relatório.</p>
  <a href="/">Analisar um edital</a>
</div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

/**
 * GET /api/jobs/:id/report.html
 *
 * Devolve a versão HTML do relatório exatamente como ela é impressa no PDF.
 * Serve para dois casos reais:
 *  1. abrir o relatório em uma aba e usar "Imprimir → Salvar como PDF" quando
 *     não há navegador headless disponível no servidor;
 *  2. integrar o relatório em outro sistema (iframe/print) sem depender do
 *     gerador de PDF do servidor.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const found = getAnalysis(id);

  if (!found) {
    return errorPage(
      'Análise não encontrada ou expirada',
      'Este relatório não está mais disponível no servidor (o resultado é mantido em memória por tempo limitado).',
      404,
    );
  }

  try {
    const download = new URL(request.url).searchParams.get('download') === '1';
    const html = renderReportHtml(found.analise, found.job.result?.meta ?? { engine: 'local-demo', avisos: [] });
    const fileName = `relatorio-editais-${found.job.id.slice(0, 8)}.html`;

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        ...(download ? { 'Content-Disposition': `attachment; filename="${fileName}"` } : {}),
      },
    });
  } catch (error) {
    const publicError = toPublicError(error);
    return errorPage('Não foi possível montar o relatório', publicError.message, 500);
  }
}
