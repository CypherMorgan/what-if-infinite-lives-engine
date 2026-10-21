/**
 * Provider-neutral AI interface.
 *
 * Three real implementations sit behind this interface (offline rules engine, offline
 * narrative composer, OpenAI-compatible HTTP). Everything above this file — the UI, the
 * persistence layer — treats them identically, so the application is fully usable with no
 * provider configured and gains capability rather than changing behaviour when one is.
 *
 * Provider secrets never exist in this layer: the OpenAI-compatible adapter receives an
 * already-decrypted key from the main process and never stores it.
 */
import type { ScenarioPrompt, VarDef, StateVector } from '../core/types';
import type { AiParseResult, AiScenarioResponse } from './schema';

export type ProviderId = 'offline' | 'openai-compatible';

export interface ProviderSettings {
  id: ProviderId;
  label: string;
  /** Base URL for OpenAI-compatible endpoints. Ignored by the offline provider. */
  baseUrl: string;
  model: string;
  /** Present only in the main process, and only for the duration of a request. */
  apiKey?: string;
  /** Whether the server needs no key, e.g. a local Ollama or llama.cpp server. */
  keyless: boolean;
  timeoutMs: number;
  maxTokens: number;
  /** When false, provider failures fall back to the offline generator. */
  strict: boolean;
}

export interface GenerationRequest {
  kind: 'initial-branches' | 'expand-node' | 'explain-node';
  prompt: ScenarioPrompt;
  /** Current state vector when expanding or explaining. */
  state?: StateVector;
  /** Node title being expanded. */
  nodeTitle?: string;
  nodeSummary?: string;
  /** Variables the model may reference in effects. */
  vars: VarDef[];
  /** Abort signal from the caller; the adapter must honour it. */
  signal?: AbortSignal;
  /** Called with short human-readable progress notes for the activity panel. */
  onProgress?: (note: string) => void;
}

export interface GenerationResult {
  ok: boolean;
  provider: ProviderId;
  /** Free-text label shown in the UI, e.g. "llama3.1 via http://localhost:11434". */
  providerLabel: string;
  data?: AiScenarioResponse;
  /** Non-fatal validation notes worth surfacing. */
  notes: string[];
  error?: { code: string; message: string; detail?: string };
  /** Milliseconds spent, for the activity panel. */
  elapsedMs: number;
}

export interface ScenarioProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** True when the provider needs no configuration to work. */
  readonly available: boolean;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}

/** Injectable transport so the HTTP adapter can be unit-tested without a network. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  }
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

/**
 * A transport that owns authentication.
 *
 * The packaged desktop app must never hold the provider key in the renderer —
 * it is encrypted by `safeStorage` in the main process and is deliberately
 * unreadable from the UI. A `ProviderTransport` therefore performs the request
 * itself, attaches the credential on the far side of the bridge, and returns
 * only the response body. The renderer never sees the key.
 *
 * This is also what makes the provider actually usable: routing the request
 * through the renderer with no key would be rejected by every provider that
 * requires one.
 */
export interface ProviderTransportRequest {
  /** Fully-formed endpoint URL. */
  url: string;
  /** Serialised JSON request body. */
  body: string;
  /** Milliseconds before the request is abandoned. */
  timeoutMs: number;
  /** Whether this provider needs no credential at all, such as a local Ollama server. */
  keyless?: boolean;
}

export interface ProviderTransportResponse {
  /** True when the provider answered with a success status. */
  ok: boolean;
  /** HTTP status, or 0 when the request never reached the provider. */
  status: number;
  /** The response body, already size-capped by the transport. */
  text: string;
  /** Set when the request failed before the provider could answer. */
  transportError?: 'no_key' | 'network' | 'timeout' | 'blocked';
  /** Human-readable detail, already redacted of any credential. */
  message?: string;
}

export interface ProviderTransport {
  request(
    input: ProviderTransportRequest,
    signal?: AbortSignal
  ): Promise<ProviderTransportResponse>;
}

export const DEFAULT_SETTINGS: ProviderSettings = {
  id: 'offline',
  label: 'Built-in engine',
  baseUrl: '',
  model: '',
  keyless: false,
  timeoutMs: 60_000,
  maxTokens: 4000,
  strict: false,
};

/** Presets shown in settings, so users do not have to know the exact URLs. */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  keyless: boolean;
  hint: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyless: false,
    hint: 'Requires an API key. Scenario text is sent to OpenAI when you generate.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    keyless: false,
    hint: 'Requires an API key. Gives access to many models through one endpoint.',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    keyless: false,
    hint: 'Requires an API key. Fast inference.',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    keyless: true,
    hint: 'No key needed. Nothing leaves this machine.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    keyless: true,
    hint: 'No key needed. Nothing leaves this machine.',
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible',
    baseUrl: '',
    model: '',
    keyless: false,
    hint: 'Any server implementing /chat/completions.',
  },
];

/**
 * Maps a validated model response onto engine effects, clamping every key to the variables the
 * scenario actually declares. An effect on an unknown key is dropped rather than silently
 * creating a state variable nothing knows how to display.
 */
export function normaliseEffects(
  response: AiScenarioResponse,
  vars: readonly VarDef[]
): AiScenarioResponse {
  const allowed = new Set(vars.map((v) => v.key));
  return {
    ...response,
    nodes: response.nodes.map((node) => ({
      ...node,
      effects: node.effects?.filter((e) => allowed.has(e.key)),
    })),
  };
}

/** Convenience: unwrap a parse result into a provider result. */
export function toResult(
  parsed: AiParseResult,
  provider: ProviderId,
  providerLabel: string,
  elapsedMs: number
): GenerationResult {
  const notes = parsed.issues.filter((i) => !i.fatal).map((i) => `${i.path}: ${i.message}`);
  if (!parsed.ok || !parsed.data) {
    const fatal = parsed.issues.find((i) => i.fatal);
    return {
      ok: false,
      provider,
      providerLabel,
      notes,
      elapsedMs,
      error: {
        code: 'invalid_response',
        message: fatal?.message ?? 'The provider response could not be used.',
        detail: notes.slice(0, 6).join('\n'),
      },
    };
  }
  return { ok: true, provider, providerLabel, data: parsed.data, notes, elapsedMs };
}
