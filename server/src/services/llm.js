/**
 * Optional AI enrichment, across several providers.
 *
 * The platform works fully without any of this — matching, generation and documents are
 * deterministic. When providers are configured they *enrich* narrative quality: cover
 * letter prose, match explanations, CV summaries. Generated text still passes through
 * the truth guard, so a model cannot introduce a claim that is not in the CV.
 *
 * Multiple providers are tried in the order the user chose. Free tiers are small by
 * design, so when one returns 429 (or any other error) the next is used automatically,
 * and if all of them fail the app quietly falls back to the deterministic engine.
 *
 * Developed by Lulamile Mkhungela.
 */
import { config } from '../config.js';
import { loadLlmChain } from './integrationStore.js';
import { getProvider, endpointFor, ALL_PROVIDERS, FREE_HOSTED, providerCatalogue } from './llmProviders.js';
import { logger } from '../lib/logger.js';

const log = logger('llm');

/**
 * Providers configured in the environment, used when a user has not stored their own.
 * Supports LLM_PROVIDER/LLM_API_KEY plus numbered extras (LLM_PROVIDER_2 … _5).
 */
function envEntries() {
  const entries = [];
  const add = (slot) => {
    if (!slot.provider || slot.provider === 'none') return;
    const known = getProvider(slot.provider);
    if (!known && slot.provider !== 'openai') return;
    // Ollama runs locally and needs no key; everything else must have one.
    if (!slot.apiKey && slot.provider !== 'ollama') return;
    entries.push({
      id: known?.id || slot.provider,
      apiKey: slot.apiKey,
      model: slot.model || known?.defaultModel || '',
      baseUrl: slot.baseUrl || known?.baseUrl || (slot.provider === 'openai' ? 'https://api.openai.com/v1' : ''),
      accountId: '',
      enabled: true,
      origin: 'environment',
    });
  };
  add({ provider: config.llm.provider, apiKey: config.llm.apiKey, baseUrl: config.llm.baseUrl, model: config.llm.model });
  for (const extra of config.llm.extra || []) add(extra);
  return entries;
}

/**
 * The ordered list of providers to try for this user.
 * Their own saved list wins; otherwise the environment; otherwise nothing.
 */
export function chainFor(userId) {
  const stored = loadLlmChain(userId)
    .filter((p) => p.enabled && p.apiKey && getProvider(p.id))
    .map((p) => {
      const provider = getProvider(p.id);
      return {
        ...p,
        model: p.model || provider.defaultModel,
        baseUrl: p.baseUrl || provider.baseUrl,
        origin: 'account',
        // Ollama needs no key, so an empty one is fine there.
        usable: true,
      };
    });
  if (stored.length) return stored;
  return envEntries();
}

export function available(userId) {
  return chainFor(userId).length > 0;
}

/** Summary for the capabilities endpoint and the settings screen. */
export function describe(userId) {
  const chain = chainFor(userId);
  if (!chain.length) {
    return {
      enabled: false,
      provider: 'none',
      providers: [],
      note:
        'No AI provider configured, so the built-in deterministic engine writes your letters and summaries (no API key needed). Add a free key from any of the options below for richer wording.',
      freeOptions: FREE_HOSTED.length,
    };
  }
  return {
    enabled: true,
    provider: chain[0].id,
    providers: chain.map((c) => ({ id: c.id, model: c.model, origin: c.origin })),
    model: chain[0].model || '(default)',
    note:
      chain.length > 1
        ? `AI enrichment active with ${chain.length} providers — they are tried in order and the app moves to the next one when a free-tier rate limit is hit.`
        : 'AI enrichment active. Add a second free provider so a rate limit never interrupts generation.',
  };
}

/** The registry plus the user's current list, for the settings screen. */
export function catalogue(userId) {
  return {
    catalogue: providerCatalogue(),
    configured: loadLlmChain(userId).map((p) => ({
      id: p.id,
      model: p.model,
      accountId: p.accountId,
      enabled: p.enabled,
      keySet: !!p.apiKey,
      keyMasked: p.apiKey ? `${p.apiKey.slice(0, 4)}…${p.apiKey.slice(-4)}` : '',
    })),
    active: chainFor(userId).map((c) => c.id),
  };
}

/** One request to one provider. Throws on any failure so the caller can move on. */
async function callProvider(entry, { system, prompt, maxTokens, json, temperature }) {
  const provider = getProvider(entry.id) || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs);
  try {
    // Anthropic speaks its own protocol; everything else here is OpenAI-compatible.
    if (provider.native === 'anthropic') {
      const base = String(entry.baseUrl || provider.baseUrl).replace(/\/$/, '');
      const res = await fetch(`${base}/messages`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': entry.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: entry.model || provider.defaultModel,
          max_tokens: maxTokens,
          temperature,
          ...(system ? { system } : {}),
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.content?.map((c) => c.text).join('') ?? null;
    }

    const url = endpointFor({ baseUrl: entry.baseUrl || provider.baseUrl }, entry.accountId);
    const headers = { 'content-type': 'application/json' };
    if (entry.apiKey) headers.authorization = `Bearer ${entry.apiKey}`;
    // OpenRouter attributes traffic when these are present; harmless elsewhere.
    if (entry.id === 'openrouter') {
      headers['http-referer'] = 'https://github.com/LulamileMkhungela/i-Apply';
      headers['x-title'] = 'AI Job Hunter';
    }

    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        model: entry.model || provider.defaultModel,
        temperature,
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{ userId?: number, system?: string, prompt: string, maxTokens?: number, json?: boolean, temperature?: number }} opts
 * @returns {Promise<string|null>} the first successful answer, or null to use the deterministic engine
 */
export async function complete({ userId = null, system, prompt, maxTokens = 900, json = false, temperature = 0.2 }) {
  const chain = chainFor(userId);
  if (!chain.length) return null;

  for (const entry of chain) {
    try {
      const text = await callProvider(entry, { system, prompt, maxTokens, json, temperature });
      if (text) return text;
    } catch (err) {
      const rateLimited = err.status === 429;
      log.warn(
        `${entry.id} ${rateLimited ? 'rate-limited' : 'failed'} (trying the next provider): ${err.message}`
      );
    }
  }
  log.warn('every configured AI provider failed — using the deterministic engine');
  return null;
}

export async function completeJson(opts) {
  const text = await complete({ ...opts, json: true });
  if (!text) return null;
  try {
    const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * Tests each configured provider with a tiny prompt and reports which ones answered.
 * Used by the "Check my keys" button so the user can see exactly which keys work.
 */
export async function testProviders(userId) {
  const chain = chainFor(userId);
  const results = [];
  for (const entry of chain) {
    try {
      const text = await callProvider(entry, {
        prompt: 'Reply with the single word: ready',
        maxTokens: 12,
        json: false,
        temperature: 0,
      });
      results.push({ id: entry.id, ok: !!text, model: entry.model, reply: (text || '').trim().slice(0, 40) });
    } catch (err) {
      results.push({ id: entry.id, ok: false, model: entry.model, error: err.message });
    }
  }
  return {
    results,
    working: results.filter((r) => r.ok).length,
    tested: results.length,
    message: results.length
      ? `${results.filter((r) => r.ok).length} of ${results.length} provider(s) answered.`
      : 'No AI provider is configured yet — the deterministic engine is in use.',
  };
}

export { ALL_PROVIDERS, FREE_HOSTED };
