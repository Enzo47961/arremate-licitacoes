import { createHash } from 'node:crypto';
import { createJob, findByHash, linkHash, refreshJobPresentation, type Job } from './store';
import { failJob, runAnalysis } from './analysis';
import { AppError } from './errors';
import { config, hasAIProvider } from './config';
import { consumirAnalise } from './limite';

/** Validação do upload: tipo, tamanho e nome. */
export function validateUpload(file: File, buffer: Buffer): void {
  const name = file.name || 'documento.pdf';
  const type = (file.type || '').toLowerCase();

  const extensionOk = /\.pdf$/i.test(name);
  const mimeOk = type === '' || type === 'application/pdf' || type === 'application/x-pdf';

  if (!extensionOk && !mimeOk) {
    throw new AppError('INVALID_FILE_TYPE', 'Formato de arquivo não aceito. Envie um arquivo PDF.', {
      status: 415,
      details: `Recebido: ${name}${type ? ` (${type})` : ''}`,
      hint: `Formatos aceitos: PDF com texto selecionável, até ${Math.round(config.upload.maxBytes / (1024 * 1024))} MB.`,
    });
  }

  if (buffer.byteLength > config.upload.maxBytes) {
    throw new AppError(
      'FILE_TOO_LARGE',
      `O arquivo tem ${(buffer.byteLength / (1024 * 1024)).toFixed(1)} MB e o limite é ${Math.round(config.upload.maxBytes / (1024 * 1024))} MB.`,
      { status: 413, hint: 'Reduza o PDF (remova imagens) ou aumente MAX_UPLOAD_MB no .env.' },
    );
  }
}

export const hashBuffer = (buffer: Buffer): string =>
  createHash('sha256').update(buffer).digest('hex').slice(0, 32);

/**
 * Chave de cache do resultado: conteúdo do arquivo + motor + modelo.
 * Sem o motor/modelo na chave, um resultado antigo continuaria sendo servido
 * depois de trocar o modelo ou de configurar a chave de IA.
 */
function cacheKey(buffer: Buffer): string {
  const engine = hasAIProvider() ? `ai:${config.ai.model}:${config.ai.synthesisModel}` : 'local';
  return `${hashBuffer(buffer)}|${engine}`;
}

export type StartAnalysisInput = {
  buffer: Buffer;
  fileName: string;
  fileSize: number;
  isDemo?: boolean;
  /** IP de quem pediu — usado no limite de uso da IA. */
  ip?: string;
};

export type StartedAnalysis = {
  job: Job;
  reused: boolean;
};

/**
 * Cria (ou reaproveita) o job e dispara o pipeline em background.
 * Retorna imediatamente para que a interface possa acompanhar o progresso.
 */
export function startAnalysis(input: StartAnalysisInput): StartedAnalysis {
  const key = cacheKey(input.buffer);

  // Reaproveita o resultado quando o MESMO arquivo já foi analisado com o mesmo
  // motor — evita gastar tokens em demonstrações repetidas.
  const existing = findByHash(key);
  if (existing?.result) {
    refreshJobPresentation(existing.id, {
      fileName: input.fileName,
      isDemo: Boolean(input.isDemo),
    });
    return { job: existing, reused: true };
  }

  // Só análises novas com IA consomem cota; o que veio do cache acima é de graça.
  if (hasAIProvider() && input.ip) consumirAnalise(input.ip);

  const job = createJob({
    fileName: input.fileName,
    fileSize: input.fileSize,
    isDemo: input.isDemo,
  });
  linkHash(key, job.id);

  // Execução em background: o stream de progresso acompanha o job.
  void runAnalysis(input.buffer, job.id, {
    fileName: input.fileName,
    fileSize: input.fileSize,
    isDemo: input.isDemo,
    hash: key,
  }).catch((error: unknown) => {
    failJob(job.id, error);
  });

  return { job, reused: false };
}
