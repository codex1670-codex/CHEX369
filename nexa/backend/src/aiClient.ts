import { config } from './config.js';

export interface AiChatRequest { message: string; locale?: string; history?: { role: 'user' | 'assistant'; content: string }[] }
export interface AiChatResponse { reply: string; model: string }
export interface AiTranslateResponse { translation: string; detectedLanguage?: string }

class AiUnavailableError extends Error {
  constructor(msg = 'AI service is not configured') { super(msg); this.name = 'AiUnavailableError'; }
}

async function call<T>(path: string, body: unknown, timeoutMs = 20_000): Promise<T> {
  if (!config.AI_SERVICE_URL) throw new AiUnavailableError();
  const res = await fetch(new URL(path, config.AI_SERVICE_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.AI_SERVICE_TOKEN ? { Authorization: `Bearer ${config.AI_SERVICE_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`AI service ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

/** Typed client for the Python/FastAPI AI microservice. */
export const ai = {
  enabled: () => !!config.AI_SERVICE_URL,
  chat: (req: AiChatRequest) => call<AiChatResponse>('/v1/chat', req),
  translate: (text: string, target: string) => call<AiTranslateResponse>('/v1/translate', { text, target }),
  moderate: (text: string) => call<{ flagged: boolean; categories: string[] }>('/v1/moderate', { text }),
};
export { AiUnavailableError };
