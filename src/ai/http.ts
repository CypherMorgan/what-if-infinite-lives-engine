/**
 * OpenAI-compatible HTTP adapter.
 *
 * Covers OpenAI, OpenRouter, Groq, Azure-style gateways, Ollama and LM Studio, because they all
 * expose `/chat/completions` with the same request shape. Anything that does not is not
 * supported, and the settings UI says so.
 *
 * Security posture:
 *  - The API key lives in the main process only, for the duration of a request. It is never
 *    written to logs, never included in error messages, and never sent to the renderer.
 *  - Request bodies are size-capped before dispatch.
 *  - Responses are size-capped before parsing, and validated by `parseScenarioResponse`.
 *  - Timeouts and aborts are honoured, and a provider failure degrades to the offline engine
 *    unless the user has explicitly asked for strict behaviour.
 */
import { parseScenarioResponse, RESPONSE_SCHEMA_SPEC, AI_LIMITS } from './schema';
import {
  normaliseEffects,
  toResult,
  type FetchLike,
  type GenerationRequest,
  type GenerationResult,
  type ProviderSettings,
  type ProviderTransport,
  type ProviderTransportResponse,
  type ScenarioProvider,
} from './provider';
import { composeScenario } from './offline';
import { ALL_PACKS } from '../core/packs';
import { activeRules } from '../core/engine';
import { detectArchetypes } from '../core/archetypes';

const SYSTEM_PROMPT = `You are the scenario modelling component of "What If?", a tool for exploring the plausible consequences of life decisions.

You produce structured, conditional scenarios. You follow these rules absolutely:

1. You never claim to know what will actually happen to this person. Every statement is conditional on the assumptions you state.
2. You never state a probability of a real-world outcome. If something is uncertain, you describe what would make it more or less likely instead.
3. You always classify each statement as "user-fact", "research" (only if you can cite a real, well-known source), "assumption", or "speculation". Never fabricate a citation, statistic, study name or number.
4. You include plausible setbacks and costs, not only successes. A path with no downside is a modelling failure.
5. You explain causal mechanisms, not just outcomes. Say why one step leads to the next.
6. You name the trade-offs and opportunity costs of each route.
7. You avoid generic filler. Every node must be specific to the situation described.
8. You never ask for or infer sensitive personal information beyond what the user volunteered.`;

function userPrompt(request: GenerationRequest): string {
  const { prompt } = request;
  const archetypes =
    prompt.archetypes.length > 0
      ? prompt.archetypes
      : detectArchetypes(`${prompt.situation} ${prompt.decision} ${prompt.goals.join(' ')}`);
  const availableRules = activeRules(ALL_PACKS, archetypes)
    .slice(0, 40)
    .map((r) => `- ${r.id}: ${r.label}`)
    .join('\n');

  const varList = request.vars
    .map((v) => `- ${v.key} (${v.label}, ${v.unit}${v.hint ? `, ${v.hint}` : ''})`)
    .join('\n');

  const task =
    request.kind === 'expand-node'
      ? `Continue the existing timeline from the node below. Produce 3 to 6 new nodes that plausibly follow it, plus the edges connecting them. The "from" of the first edge should be "start", which represents the existing node.`
      : request.kind === 'explain-node'
        ? `Explain the node below: what led to it, what it changes, and what would make it more or less likely. Produce a small node graph (2 to 4 nodes) that expands on it.`
        : `Produce the initial branching future for this scenario: between ${prompt.branchCount} and ${prompt.branchCount + 1} mutually exclusive branches, each with 3 to 5 subsequent steps. Total nodes must not exceed ${AI_LIMITS.maxNodes}.`;

  const imaginationNote =
    prompt.imagination < 0.34
      ? 'Register: GROUNDED. Prefer ordinary, defensible developments. Avoid dramatic turns.'
      : prompt.imagination < 0.67
        ? 'Register: BALANCED. Mostly grounded, with some less obvious possibilities explored.'
        : 'Register: IMAGINATIVE. Explore less likely but internally coherent directions, and label them clearly as speculation.';

  return `${task}

STARTING SITUATION
${prompt.situation || '(not stated)'}

DECISION UNDER CONSIDERATION
${prompt.decision || '(not stated)'}

GOALS THE PERSON STATED
${prompt.goals.length > 0 ? prompt.goals.map((g) => `- ${g}`).join('\n') : '(none stated)'}

CONSTRAINTS THEY STATED
${prompt.constraints.length > 0 ? prompt.constraints.map((c) => `- ${c}`).join('\n') : '(none stated)'}

RESOURCES / CIRCUMSTANCES
${prompt.resources.length > 0 ? prompt.resources.map((r) => `- ${r}`).join('\n') : '(none stated)'}

TIME HORIZON
${prompt.horizon} months. "t" on each node is months from now and must not exceed this.

${imaginationNote}

STATE VARIABLES YOU MAY REFERENCE IN "effects"
Only these keys exist. An effect on any other key is discarded.
${varList}

RULE CATALOGUE (these are the dynamics the deterministic engine can model; reuse these ids in prose where they fit, and prefer their flavour over inventing new dynamics)
${availableRules}

${request.kind === 'expand-node' && request.nodeTitle ? `NODE TO CONTINUE FROM\nTitle: ${request.nodeTitle}\nSummary: ${request.nodeSummary ?? ''}\n` : ''}
${request.kind === 'explain-node' && request.nodeTitle ? `NODE TO EXPLAIN\nTitle: ${request.nodeTitle}\nSummary: ${request.nodeSummary ?? ''}\n` : ''}
${RESPONSE_SCHEMA_SPEC}`;
}

/** Strips a key from anything destined for a log, an error message or the renderer. */
export function redact(text: string, apiKey?: string): string {
  if (!apiKey || apiKey.length < 6) return text;
  return text.split(apiKey).join('[redacted]');
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: unknown } }[];
}

function extractContent(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const choices = (payload as ChatCompletionResponse).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = choices[0]?.message?.content;
  if (typeof content === 'string') return content;
  // Some gateways return an array of content parts.
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        typeof part === 'object' &&
        part !== null &&
        typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : ''
      )
      .join('');
    return text || null;
  }
  return null;
}

export interface HttpProviderDeps {
  fetchImpl?: FetchLike;
  /**
   * Transport that owns authentication. When present it performs the request
   * and adds the credential itself, so the provider must not insist on finding
   * an API key in `settings`.
   */
  transport?: ProviderTransport;
  /** Test hook: the offline fallback can be disabled to assert on error paths. */
  allowFallback?: boolean;
}

/**
 * Builds the HTTP provider. Exported as a factory so the transport can be injected in tests and
 * so the key can be passed in per-request rather than held on the instance.
 */
export function createHttpProvider(
  settings: ProviderSettings,
  deps: HttpProviderDeps = {}
): ScenarioProvider {
  const fetchImpl: FetchLike =
    deps.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
  const transport = deps.transport;
  const allowFallback = deps.allowFallback !== false;
  const label =
    settings.model && settings.baseUrl
      ? `${settings.model} via ${shortHost(settings.baseUrl)}`
      : settings.label;

  async function fallback(
    request: GenerationRequest,
    started: number,
    code: string,
    message: string,
    detail?: string
  ): Promise<GenerationResult> {
    request.onProgress?.('Provider unavailable — using the built-in engine');
    const data = composeScenario(request.prompt, request.vars);
    return {
      ok: true,
      provider: 'offline',
      providerLabel: 'Built-in engine (fallback)',
      data,
      notes: [
        `The configured provider could not be used: ${message}`,
        'The built-in rules engine produced this universe instead, so nothing was lost. You can retry with the provider from the activity panel.',
      ],
      elapsedMs: Date.now() - started,
      error: { code, message, ...(detail ? { detail } : {}) },
    };
  }

  return {
    id: 'openai-compatible',
    label,
    available: Boolean(settings.baseUrl && settings.model),

    async generate(request: GenerationRequest): Promise<GenerationResult> {
      const started = Date.now();

      if (!settings.baseUrl || !settings.model) {
        return {
          ok: false,
          provider: 'openai-compatible',
          providerLabel: label,
          notes: [],
          elapsedMs: Date.now() - started,
          error: {
            code: 'not_configured',
            message:
              'No provider is configured. Add a base URL and model in Settings, or use the built-in engine.',
          },
        };
      }
      if (!settings.keyless && !settings.apiKey && !transport) {
        return {
          ok: false,
          provider: 'openai-compatible',
          providerLabel: label,
          notes: [],
          elapsedMs: Date.now() - started,
          error: {
            code: 'missing_key',
            message:
              'This provider needs an API key. Add one in Settings, or use the built-in engine.',
          },
        };
      }

      const body = JSON.stringify({
        model: settings.model,
        temperature: 0.75,
        max_tokens: settings.maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt(request) },
        ],
      });

      const controller = new AbortController();
      const onExternalAbort = (): void => controller.abort();
      request.signal?.addEventListener('abort', onExternalAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), settings.timeoutMs);

      try {
        request.onProgress?.('Contacting the provider');
        const url = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;

        // Two ways to make the request. The transport owns authentication and
        // runs on the far side of the main-process bridge, so the credential
        // never enters the renderer. The plain fetch path is for environments
        // where the key is genuinely available in-process, such as tests.
        let ok: boolean;
        let status: number;
        let raw: string;
        let transportError: ProviderTransportResponse['transportError'];
        let transportMessage: string | undefined;

        if (transport) {
          const response = await transport.request(
            { url, body, timeoutMs: settings.timeoutMs, keyless: settings.keyless },
            controller.signal
          );
          ok = response.ok;
          status = response.status;
          raw = response.text;
          transportError = response.transportError;
          transportMessage = response.message;
        } else {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (settings.apiKey) headers['Authorization'] = `Bearer ${settings.apiKey}`;
          const response = await fetchImpl(url, {
            method: 'POST',
            headers,
            body,
            signal: controller.signal,
          });
          ok = response.ok;
          status = response.status;
          raw = await response.text().catch(() => '');
        }

        if (transportError) {
          const message =
            transportError === 'no_key'
              ? 'No API key is stored for this provider. Add one in Settings, or use the built-in engine.'
              : transportError === 'timeout'
                ? `The provider did not respond within ${Math.round(settings.timeoutMs / 1000)} seconds.`
                : transportError === 'blocked'
                  ? 'The request was blocked before it reached the provider.'
                  : (transportMessage ?? 'The provider could not be reached.');
          if (allowFallback && !settings.strict)
            return fallback(request, started, transportError, message, transportMessage);
          return {
            ok: false,
            provider: 'openai-compatible',
            providerLabel: label,
            notes: [],
            elapsedMs: Date.now() - started,
            error: {
              code: transportError,
              message,
              ...(transportMessage ? { detail: transportMessage } : {}),
            },
          };
        }

        if (!ok) {
          const safe = redact(raw.slice(0, 600), settings.apiKey);
          const code =
            status === 401 || status === 403
              ? 'unauthorised'
              : status === 429
                ? 'rate_limited'
                : status >= 500
                  ? 'provider_error'
                  : 'request_rejected';
          const message =
            code === 'unauthorised'
              ? 'The provider rejected the API key.'
              : code === 'rate_limited'
                ? 'The provider is rate limiting requests. Try again shortly.'
                : code === 'provider_error'
                  ? `The provider returned a server error (${status}).`
                  : `The provider rejected the request (${status}).`;
          if (allowFallback && !settings.strict)
            return fallback(request, started, code, message, safe);
          return {
            ok: false,
            provider: 'openai-compatible',
            providerLabel: label,
            notes: [],
            elapsedMs: Date.now() - started,
            error: { code, message, detail: safe },
          };
        }

        request.onProgress?.('Reading the response');
        const text = raw;
        if (text.length > AI_LIMITS.maxResponseChars) {
          const message = 'The provider returned more data than the application will accept.';
          if (allowFallback && !settings.strict)
            return fallback(request, started, 'oversized', message);
          return {
            ok: false,
            provider: 'openai-compatible',
            providerLabel: label,
            notes: [],
            elapsedMs: Date.now() - started,
            error: { code: 'oversized', message },
          };
        }

        let payload: unknown;
        try {
          payload = JSON.parse(text);
        } catch {
          const message = 'The provider did not return valid JSON.';
          if (allowFallback && !settings.strict)
            return fallback(request, started, 'bad_envelope', message);
          return {
            ok: false,
            provider: 'openai-compatible',
            providerLabel: label,
            notes: [],
            elapsedMs: Date.now() - started,
            error: {
              code: 'bad_envelope',
              message,
              detail: redact(text.slice(0, 400), settings.apiKey),
            },
          };
        }

        const content = extractContent(payload);
        if (!content) {
          const message = 'The provider response contained no message content.';
          if (allowFallback && !settings.strict)
            return fallback(request, started, 'empty_content', message);
          return {
            ok: false,
            provider: 'openai-compatible',
            providerLabel: label,
            notes: [],
            elapsedMs: Date.now() - started,
            error: { code: 'empty_content', message },
          };
        }

        request.onProgress?.('Validating the structured scenario');
        const parsed = parseScenarioResponse(content);

        if (!parsed.ok || !parsed.data) {
          const fatal = parsed.issues.find((i) => i.fatal);
          const message =
            fatal?.message ?? 'The provider returned data that did not pass validation.';
          const detail = parsed.issues
            .slice(0, 6)
            .map((i) => `${i.path}: ${i.message}`)
            .join('\n');
          if (allowFallback && !settings.strict)
            return fallback(request, started, 'invalid_response', message, detail);
          return {
            ok: false,
            provider: 'openai-compatible',
            providerLabel: label,
            notes: [],
            elapsedMs: Date.now() - started,
            error: { code: 'invalid_response', message, detail },
          };
        }

        const result = toResult(parsed, 'openai-compatible', label, Date.now() - started);
        if (result.data) result.data = normaliseEffects(result.data, request.vars);
        result.notes.unshift(
          `Received from ${label}. Scenario text was transmitted to that provider.`
        );
        return result;
      } catch (e) {
        const aborted =
          e instanceof Error && (e.name === 'AbortError' || controller.signal.aborted);
        if (request.signal?.aborted) {
          return {
            ok: false,
            provider: 'openai-compatible',
            providerLabel: label,
            notes: [],
            elapsedMs: Date.now() - started,
            error: { code: 'cancelled', message: 'Generation was cancelled.' },
          };
        }
        const message = aborted
          ? `The provider did not respond within ${Math.round(settings.timeoutMs / 1000)} seconds.`
          : e instanceof Error
            ? redact(e.message, settings.apiKey)
            : 'An unknown network error occurred.';
        const code = aborted ? 'timeout' : 'network_error';
        if (allowFallback && !settings.strict) return fallback(request, started, code, message);
        return {
          ok: false,
          provider: 'openai-compatible',
          providerLabel: label,
          notes: [],
          elapsedMs: Date.now() - started,
          error: { code, message },
        };
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onExternalAbort);
      }
    },
  };
}

function shortHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] ?? url;
  }
}
