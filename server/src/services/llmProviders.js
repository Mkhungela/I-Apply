/**
 * AI provider registry.
 *
 * The platform works completely without any of these — matching, tailoring and
 * document generation are deterministic. A provider here only *enriches* the prose
 * (cover-letter polish, match explanations). Everything it writes still passes
 * through the truth guard, so no model can introduce a claim that is not in the CV.
 *
 * Every hosted provider listed in `FREE_HOSTED` can be used on a free account with
 * only an email sign-up — no credit card. Several of them together (tried in order,
 * falling through on rate limits) give a genuinely large free daily allowance, which
 * is why the app stores a *list* of providers rather than a single one.
 *
 * Developed by Lulamile Mkhungela.
 */

/** Providers with a permanent free tier and no card required, in the order most people should try them. */
export const FREE_HOSTED = [
  {
    id: 'google',
    name: 'Google AI Studio (Gemini)',
    signup: 'https://aistudio.google.com/app/apikey',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash-lite',
    models: ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    freeTier: 'Free tier, no card. Roughly 15 requests/minute and up to ~1,000–1,500 requests/day on the Flash-Lite and Flash models.',
    catch: 'Google may use free-tier prompts to improve its products. Do not use the free tier for confidential material you are unwilling to share.',
    keyLabel: 'API key from AI Studio',
    bestFor: 'Best overall free tier — strongest models and a very large context window.',
  },
  {
    id: 'groq',
    name: 'Groq',
    signup: 'https://console.groq.com/keys',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b'],
    freeTier: 'Free tier, no card. Around 30 requests/minute and roughly 1,000–14,400 requests/day depending on model.',
    catch: 'A daily token ceiling usually binds before the request count. Groq does not train on your data.',
    keyLabel: 'API key from the Groq console',
    bestFor: 'Very fast responses and a high request ceiling.',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    signup: 'https://cloud.cerebras.ai/',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama-3.3-70b',
    models: ['llama-3.3-70b', 'llama3.1-8b', 'qwen-3-32b'],
    freeTier: 'Free tier, no card. About 30 requests/minute and up to ~1M tokens/day on the listed models.',
    catch: 'Some accounts see a stricter trial limit at first (about 5 requests/minute) until the account is reviewed.',
    keyLabel: 'API key from Cerebras Cloud',
    bestFor: 'The most free tokens per day — good for long cover-letter work.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    signup: 'https://openrouter.ai/keys',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    models: [
      'meta-llama/llama-3.3-70b-instruct:free',
      'deepseek/deepseek-chat-v3-0324:free',
      'qwen/qwen3-32b:free',
      'google/gemma-3-27b-it:free',
    ],
    freeTier: 'Free `:free` model variants, no card. About 20 requests/minute and 50 requests/day (1,000/day once you have ever bought $10 of credit).',
    catch: 'The free roster rotates, and a failed request still counts against your daily 50. Model names must end in `:free`.',
    keyLabel: 'API key from OpenRouter',
    bestFor: 'One key that reaches roughly 25 different free models.',
  },
  {
    id: 'github',
    name: 'GitHub Models',
    signup: 'https://github.com/settings/tokens',
    baseUrl: 'https://models.github.ai/inference',
    defaultModel: 'openai/gpt-4o-mini',
    models: ['openai/gpt-4o-mini', 'openai/gpt-4.1-mini', 'meta/Llama-3.3-70B-Instruct', 'mistral-ai/Mistral-Small-3.1'],
    freeTier: 'Free for experimentation with any GitHub account, no card. Roughly 10–15 requests/minute and 50–150 requests/day depending on model tier.',
    catch: 'Intended for experimentation, with an 8K-input / 4K-output cap per request. Create a classic token with the `models:read` scope.',
    keyLabel: 'GitHub personal access token (models:read)',
    bestFor: 'No new signup if you already have GitHub — the quickest one to start with.',
  },
  {
    id: 'mistral',
    name: 'Mistral (La Plateforme)',
    signup: 'https://console.mistral.ai/api-keys',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    models: ['mistral-small-latest', 'open-mistral-nemo', 'codestral-latest'],
    freeTier: 'Free "Experiment" tier, no card. Roughly 1 billion tokens per month — among the most generous allowances available.',
    catch: 'Phone verification is required, and the Experiment tier opts your data into training. Rate limits are low (around 1–2 requests/second).',
    keyLabel: 'API key from the Mistral console',
    bestFor: 'Very large monthly volume if you are comfortable with the data terms.',
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    signup: 'https://build.nvidia.com/',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    models: ['meta/llama-3.3-70b-instruct', 'mistralai/mistral-small-24b-instruct', 'qwen/qwen2.5-72b-instruct'],
    freeTier: 'Free developer access to 100+ open-weight models through an OpenAI-compatible endpoint.',
    catch: 'Developer-tier credits are metered; a production key needs an enterprise agreement.',
    keyLabel: 'API key from build.nvidia.com',
    bestFor: 'A wide choice of open models behind one key.',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face Inference',
    signup: 'https://huggingface.co/settings/tokens',
    baseUrl: 'https://router.huggingface.co/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    models: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct'],
    freeTier: 'Free monthly inference credits with any Hugging Face account, no card.',
    catch: 'Popular models queue on the free tier and credits are modest, so treat it as a backup rather than the primary.',
    keyLabel: 'Hugging Face access token',
    bestFor: 'A spare provider for when the others are rate-limited.',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    signup: 'https://dash.cloudflare.com/profile/api-tokens',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1',
    defaultModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    models: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'],
    freeTier: 'A free daily neuron allocation on every Cloudflare account, with no card required.',
    catch: 'Needs both an API token and your account ID, and the free allowance resets daily rather than monthly.',
    keyLabel: 'Cloudflare API token',
    needsAccountId: true,
    bestFor: 'A solid fallback if you already use Cloudflare.',
  },
];

/** Paid or locally-hosted options, kept for completeness. */
export const OTHER_PROVIDERS = [
  {
    id: 'ollama',
    name: 'Ollama (local, unlimited)',
    signup: 'https://ollama.com/download',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'llama3.1',
    models: ['llama3.1', 'qwen2.5', 'mistral'],
    freeTier: 'Completely free and unlimited — the model runs on your own computer. Nothing leaves your machine.',
    catch: 'Requires a machine with enough memory, and the app must be able to reach Ollama on the same host.',
    keyLabel: 'API key (not needed for Ollama — leave empty)',
    local: true,
    bestFor: 'Full privacy and no rate limits at all.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    signup: 'https://platform.openai.com/api-keys',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o'],
    freeTier: 'No free tier — paid API key required.',
    keyLabel: 'OpenAI API key',
    bestFor: 'Consistent quality if you are already paying for it.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    signup: 'https://console.anthropic.com/settings/keys',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-haiku-latest',
    models: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest'],
    freeTier: 'No free tier — paid API key required.',
    keyLabel: 'Anthropic API key',
    native: 'anthropic',
    bestFor: 'Strong long-form writing if you are already paying for it.',
  },
];

export const ALL_PROVIDERS = [...FREE_HOSTED, ...OTHER_PROVIDERS];

export function getProvider(id) {
  return ALL_PROVIDERS.find((p) => p.id === id) || null;
}

/** The registry as the browser should see it: no secrets, everything else included. */
export function providerCatalogue() {
  return ALL_PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    signup: p.signup,
    defaultModel: p.defaultModel,
    models: p.models,
    freeTier: p.freeTier,
    catch: p.catch || null,
    keyLabel: p.keyLabel,
    bestFor: p.bestFor,
    free: FREE_HOSTED.some((f) => f.id === p.id),
    needsAccountId: !!p.needsAccountId,
    local: !!p.local,
  }));
}

/** Builds the chat-completions URL for a provider, substituting the account id if needed. */
export function endpointFor(provider, accountId) {
  const base = String(provider.baseUrl || '').replace(/\/$/, '');
  return `${base.replace('{accountId}', accountId || '')}/chat/completions`;
}
