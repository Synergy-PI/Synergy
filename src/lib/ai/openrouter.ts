// Cliente mínimo do OpenRouter (https://openrouter.ai/docs): uma chamada de chat que devolve JSON e a
// verificação de uma chave. A chave vem do servidor (OPENROUTER_API_KEY) ou do perfil do usuário e nunca
// é registrada em log nem enviada ao navegador.
//
// Limites dos modelos gratuitos (":free") em nov/2026: 20 requisições por minuto e 50 por dia, ou 1.000
// por dia para contas que já compraram US$ 10 em créditos.

const BASE_URL = 'https://openrouter.ai/api/v1';
/** Modelo gratuito que respondeu certo aos 14 editais do teste de nov/2026 (mediana de 14 s). */
export const DEFAULT_AI_MODEL = 'nvidia/nemotron-3.5-super-vl:free';
const CHAT_TIMEOUT_MS = 120_000;
const KEY_CHECK_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_TOKENS = 8000;

export function aiModel(): string {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_AI_MODEL;
}

export type AiErrorCode =
  'invalid_key' | 'no_credits' | 'rate_limited' | 'unavailable' | 'bad_response';

/** Falha ao falar com a IA; `message` já está em português para ser exibida ao usuário. */
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

function httpError(status: number): AiError {
  if (status === 401 || status === 403) {
    return new AiError('invalid_key', 'O OpenRouter recusou a chave de API.');
  }
  if (status === 402) {
    return new AiError('no_credits', 'A conta do OpenRouter está sem créditos para este modelo.');
  }
  if (status === 429) {
    return new AiError(
      'rate_limited',
      'O limite de uso da IA foi atingido (os modelos gratuitos permitem 50 chamadas por dia). Tente mais tarde.',
    );
  }
  return new AiError(
    'unavailable',
    `O serviço de IA está indisponível no momento (HTTP ${status}).`,
  );
}

function networkError(error: unknown): AiError {
  const timedOut = error instanceof Error && error.name === 'TimeoutError';
  return new AiError(
    'unavailable',
    timedOut
      ? 'A IA demorou demais para responder.'
      : 'Não foi possível conectar ao serviço de IA.',
  );
}

export type ChatJsonInput = { apiKey: string; system: string; user: string; model?: string };

/** Envia uma instrução e um conteúdo e devolve o texto da resposta, que deve ser um JSON. */
export async function chatJson(
  input: ChatJsonInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ content: string; model: string }> {
  const model = input.model ?? aiModel();
  let response: Response;
  try {
    response = await fetchImpl(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: MAX_OUTPUT_TOKENS,
        response_format: { type: 'json_object' },
        // Modelos que "pensam" antes de responder gastam o limite de saída sem devolver nada.
        reasoning: { enabled: false },
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
  } catch (error) {
    throw networkError(error);
  }
  if (!response.ok) throw httpError(response.status);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AiError('bad_response', 'A IA devolveu uma resposta ilegível.');
  }
  const data = body as {
    error?: { code?: number };
    model?: string;
    choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }>;
  };
  // O OpenRouter às vezes responde 200 com o erro do provedor no corpo.
  if (data.error) throw httpError(typeof data.error.code === 'number' ? data.error.code : 502);
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (choice?.finish_reason === 'length') {
    throw new AiError('bad_response', 'A resposta da IA foi cortada antes do fim.');
  }
  if (typeof content !== 'string' || content.trim() === '') {
    throw new AiError('bad_response', 'A IA não devolveu conteúdo.');
  }
  return { content, model: typeof data.model === 'string' ? data.model : model };
}

export type ApiKeyCheck =
  /** `dailyLimit`: chamadas gratuitas por dia que a conta pode fazer, quando o OpenRouter informa. */
  | { status: 'valid'; dailyLimit: number | null }
  | { status: 'invalid' }
  /** Não foi possível consultar o OpenRouter agora: a chave não foi confirmada nem recusada. */
  | { status: 'unknown' };

/** Confere uma chave no OpenRouter sem gastar nenhuma chamada de modelo. */
export async function checkApiKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiKeyCheck> {
  try {
    const response = await fetchImpl(`${BASE_URL}/key`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) return { status: 'invalid' };
    if (!response.ok) return { status: 'unknown' };
    const body = (await response.json()) as {
      data?: { free_model_daily_requests?: { limit?: unknown } };
    };
    const limit = body.data?.free_model_daily_requests?.limit;
    return { status: 'valid', dailyLimit: typeof limit === 'number' ? limit : null };
  } catch {
    return { status: 'unknown' };
  }
}
