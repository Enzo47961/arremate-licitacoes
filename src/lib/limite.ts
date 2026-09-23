/**
 * Limite de uso da IA na demonstração pública.
 *
 * Mesmo com um provedor gratuito, sem limite qualquer pessoa esgotaria a cota
 * diária e a demo pararia para todo mundo. Janela deslizante em memória: por IP
 * (4 análises novas por hora) e por instância (40 por dia). Resultados vindos
 * do cache (mesmo PDF) não contam.
 *
 * Limitação conhecida: em serverless cada instância tem a própria memória. Para
 * um limite global exato, trocar por um contador no banco (Redis/Postgres).
 */
import { AppError } from './errors';

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const POR_IP_HORA = Number(process.env.AI_LIMITE_POR_IP_HORA ?? 4);
const GLOBAL_DIA = Number(process.env.AI_LIMITE_DIARIO ?? 40);

type Estado = { porIp: Map<string, number[]>; global: number[] };
const ref = globalThis as unknown as { __limiteIa?: Estado };
const estado: Estado = ref.__limiteIa ?? (ref.__limiteIa = { porIp: new Map(), global: [] });

export function ipDaRequisicao(request: Request): string {
  const encaminhado = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return encaminhado || request.headers.get('x-real-ip') || 'desconhecido';
}

/** Registra uma análise nova com IA ou lança erro amigável se o limite estourou. */
export function consumirAnalise(ip: string, agora = Date.now()): void {
  estado.global = estado.global.filter((t) => agora - t < DIA);
  const doIp = (estado.porIp.get(ip) ?? []).filter((t) => agora - t < HORA);

  if (estado.global.length >= GLOBAL_DIA) {
    throw new AppError('LIMITE_ATINGIDO', 'A cota diária de análises com IA da demonstração acabou.', {
      status: 429,
      hint: 'Use "Analisar edital de demonstração" (resultado em cache) ou tente amanhã.',
    });
  }
  if (doIp.length >= POR_IP_HORA) {
    const libera = Math.ceil((HORA - (agora - doIp[0])) / 60_000);
    throw new AppError('LIMITE_ATINGIDO', `Você já fez ${POR_IP_HORA} análises com IA na última hora.`, {
      status: 429,
      hint: `Tente de novo em ${libera} minuto(s). O limite existe para a demonstração pública não esgotar para todos.`,
    });
  }

  doIp.push(agora);
  estado.porIp.set(ip, doIp);
  estado.global.push(agora);
  if (estado.porIp.size > 5000) estado.porIp.clear();
}
