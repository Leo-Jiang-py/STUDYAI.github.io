import { setTimeout as sleep } from 'node:timers/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const CONFIG = Object.freeze({
  provider: {
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    timeoutMs: 15_000,
  },
  hyperparameters: {
    temperature: 0.2,
    top_p: 0.9,
    max_tokens: 400,
    frequency_penalty: 0.0,
  },
  retry: {
    maxAttempts: 4,
    baseDelayMs: 500,
    maxDelayMs: 8_000,
  },
  systemPrompt: [
    'You are a precise text analysis engine.',
    'Return ONLY a JSON object with exactly these keys:',
    '"summary" (string, max 40 words), "keywords" (array of 1 to 6 lowercase strings),',
    '"sentiment" (one of "positive", "negative", "neutral").',
    'Do not include markdown, code fences, or any other text.',
  ].join(' '),
});

const SENTIMENTS = new Set(['positive', 'negative', 'neutral']);

const log = {
  info: (msg, meta) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg, ...meta })),
  warn: (msg, meta) => console.warn(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', msg, ...meta })),
  error: (msg, meta) => console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg, ...meta })),
};

class ProviderError extends Error {
  constructor(message, { status, retryable } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryable = retryable ?? false;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

function validateAnalysis(candidate) {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new ValidationError('Output is not a JSON object.');
  }
  const { summary, keywords, sentiment } = candidate;

  if (typeof summary !== 'string' || summary.trim().length === 0) {
    throw new ValidationError('"summary" must be a non-empty string.');
  }
  // Aligned with system prompt (max 40 words)
  if (summary.trim().split(/\s+/).length > 40) {
    throw new ValidationError('"summary" exceeds the 40-word limit.');
  }
  if (!Array.isArray(keywords) || keywords.length < 1 || keywords.length > 6) {
    throw new ValidationError('"keywords" must be an array of 1 to 6 items.');
  }
  const normalizedKeywords = keywords.map((k) => {
    if (typeof k !== 'string' || k.trim().length === 0) {
      throw new ValidationError('Each keyword must be a non-empty string.');
    }
    return k.trim().toLowerCase();
  });
  if (!SENTIMENTS.has(sentiment)) {
    throw new ValidationError('"sentiment" must be positive, negative, or neutral.');
  }

  return { summary: summary.trim(), keywords: normalizedKeywords, sentiment };
}

function parseModelJson(raw) {
  if (typeof raw !== 'string') {
    throw new ValidationError('Model response is not a string.');
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new ValidationError('No JSON object found in model response.');
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    throw new ValidationError(`Invalid JSON: ${err.message}`);
  }
}

function backoffDelay(attempt) {
  const exp = Math.min(CONFIG.retry.maxDelayMs, CONFIG.retry.baseDelayMs * 2 ** attempt);
  const jitter = Math.floor(Math.random() * CONFIG.retry.baseDelayMs);
  return exp + jitter;
}

async function callChatCompletion(userText) {
  if (!CONFIG.provider.apiKey) {
    throw new ProviderError('OPENAI_API_KEY is not set.', { retryable: false });
  }

  const body = {
    model: CONFIG.provider.model,
    messages: [
      { role: 'system', content: CONFIG.systemPrompt },
      { role: 'user', content: `Analyze the following text:\n"""\n${userText}\n"""` },
    ],
    temperature: CONFIG.hyperparameters.temperature,
    top_p: CONFIG.hyperparameters.top_p,
    max_tokens: CONFIG.hyperparameters.max_tokens,
    frequency_penalty: CONFIG.hyperparameters.frequency_penalty,
    response_format: { type: 'json_object' },
  };

  let res;
  try {
    res = await fetch(`${CONFIG.provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CONFIG.provider.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CONFIG.provider.timeoutMs),
    });
  } catch (err) {
    throw new ProviderError(`Network failure: ${err.message}`, { retryable: true });
  }

  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    throw new ProviderError(`HTTP ${res.status}`, { status: res.status, retryable });
  }

  const payload = await res.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new ValidationError('Provider response missing message content.');
  }
  return content;
}

function fallbackAnalysis(text) {
  const words = text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  const keywords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([w]) => w);

  const positive = ['good', 'great', 'excellent', 'love', 'happy', 'fast', 'useful'];
  const negative = ['bad', 'poor', 'terrible', 'hate', 'slow', 'broken', 'worst'];
  const score = words.reduce(
    (acc, w) => acc + (positive.includes(w) ? 1 : 0) - (negative.includes(w) ? 1 : 0),
    0,
  );
  const sentiment = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';

  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const summary = sentences.slice(0, 2).join(' ').split(/\s+/).slice(0, 40).join(' ');

  return validateAnalysis({
    summary: summary || 'No summary available.',
    keywords: keywords.length ? keywords : ['general'],
    sentiment,
  });
}

async function analyzeText(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new ValidationError('Input text must be a non-empty string.');
  }

  for (let attempt = 0; attempt < CONFIG.retry.maxAttempts; attempt++) {
    try {
      const raw = await callChatCompletion(text);
      const result = validateAnalysis(parseModelJson(raw));
      return { source: 'model', ...result };
    } catch (err) {
      const retryable = err instanceof ProviderError && err.retryable;
      const isLast = attempt === CONFIG.retry.maxAttempts - 1;

      if (err instanceof ValidationError) {
        log.warn('Model output failed validation; retrying.', { attempt, reason: err.message });
      } else {
        log.warn('Provider call failed.', { attempt, reason: err.message, status: err.status });
      }

      if (!retryable && !(err instanceof ValidationError)) {
        break;
      }
      if (isLast) break;
      await sleep(backoffDelay(attempt));
    }
  }

  log.info('Falling back to deterministic local analysis.');
  return { source: 'fallback', ...fallbackAnalysis(text) };
}

async function main() {
  const samples = [
    'The new release is fast and useful. Installation was great and the docs are excellent.',
    'The service was slow and the dashboard is broken. Support was terrible and I am unhappy.',
    'The quarterly report contains revenue figures for three regions. Totals are listed in the appendix.',
  ];

  log.info('Starting analysis run.', {
    model: CONFIG.provider.model,
    hasApiKey: Boolean(CONFIG.provider.apiKey),
    hyperparameters: CONFIG.hyperparameters,
  });

  const results = [];
  for (const [index, text] of samples.entries()) {
    try {
      const result = await analyzeText(text);
      results.push({ index, ...result });
    } catch (err) {
      log.error('Analysis failed for sample.', { index, reason: err.message });
      results.push({ index, error: err.message });
    }
  }

  console.log(JSON.stringify(results, null, 2));
  log.info('Run complete.', { processed: results.length });
  return results;
}

// Cross-platform entrypoint check supporting Windows path separators
const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((err) => {
    log.error('Fatal error.', { reason: err.message });
    process.exitCode = 1;
  });
}

export { analyzeText, validateAnalysis, parseModelJson, fallbackAnalysis, main };
