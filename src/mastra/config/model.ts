import type { MastraModelConfig } from '@mastra/core/llm/model/shared.types';

type ModelConfigOverride = {
  id: `${string}/${string}`;
  url?: string;
  apiKey?: string;
  headers?: Record<string, string>;
};

const parseHeaders = (): Record<string, string> | undefined => {
  const raw = process.env.LLM_EXTRA_HEADERS;
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') {
          record[key] = value;
        }
      }
      return Object.keys(record).length ? record : undefined;
    }
  } catch {
    // ignore malformed JSON and fall back to undefined
  }
  return undefined;
};

export const getDefaultModelConfig = (): MastraModelConfig => {
  const id = (process.env.LLM_MODEL_ID as `${string}/${string}` | undefined) ?? 'openai/gpt-4o-mini';
  const url = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  const headers = parseHeaders();

  const override: ModelConfigOverride = { id };

  if (url) {
    override.url = url;
  }
  if (apiKey) {
    override.apiKey = apiKey;
  }
  if (headers) {
    override.headers = headers;
  }

  const hasOverride = Boolean(override.url || override.apiKey || override.headers);

  return hasOverride ? override : id;
};
