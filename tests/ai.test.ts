/**
 * AI layer tests: response parsing (including hostile/malformed model output), the HTTP
 * provider with an injected transport, fallback behaviour, and the conversion of a model
 * response into a valid simulation document.
 *
 * No test in this file touches the network: the transport is always injected.
 */
import { describe, expect, it } from 'vitest';
import { AI_LIMITS, extractJson, parseScenarioResponse } from '../src/ai/schema';
import { createHttpProvider, redact } from '../src/ai/http';
import {
  DEFAULT_SETTINGS,
  normaliseEffects,
  toResult,
  type FetchLike,
  type GenerationRequest,
  type ProviderSettings,
} from '../src/ai/provider';
import { composeScenario, offlineProvider } from '../src/ai/offline';
import {
  documentFromResponse,
  generateUniverse,
  offlineUniverse,
  selectProvider,
} from '../src/ai/orchestrator';
import { validateGraph } from '../src/core/graph';
import { validateDocument } from '../src/core/validate';
import { ALL_VARS } from '../src/core/packs/vars';
import type { ScenarioPrompt, SimulationDoc } from '../src/core/types';

const prompt: ScenarioPrompt = {
  situation: 'I have worked in support for three years and want to move into software engineering.',
  decision: 'Should I take a six-month bootcamp or keep self-studying while working?',
  goals: ['Become a developer'],
  constraints: [],
  horizon: 24,
  branchCount: 3,
  imagination: 0.3,
  resources: ['savings of 12000'],
  archetypes: [],
  title: 'Bootcamp or self-study?',
};

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return { kind: 'initial-branches', prompt, vars: [...ALL_VARS], ...overrides };
}

function settings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  return {
    ...DEFAULT_SETTINGS,
    id: 'openai-compatible',
    label: 'Test provider',
    baseUrl: 'https://example.test/v1',
    model: 'test-model',
    keyless: true,
    ...overrides,
  };
}

type StubResponse = Awaited<ReturnType<FetchLike>>;

/** A well-formed chat completion envelope carrying `content` as its message. */
function completion(content: string): StubResponse {
  const payload = JSON.stringify({ choices: [{ message: { content } }] });
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(payload),
    json: () => Promise.resolve(JSON.parse(payload)),
  };
}

function response(raw: string, init: { ok?: boolean; status?: number } = {}): StubResponse {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: () => Promise.resolve(raw),
    json: () => Promise.resolve(JSON.parse(raw)),
  };
}

const VALID_CONTENT = JSON.stringify({
  schema: 'whatif.scenario.v1',
  branchLabel: 'Model path',
  nodes: [
    { ref: 'start', type: 'start', title: 'Now', summary: 'Where things stand today.', t: 0 },
    { ref: 'a', type: 'decision', title: 'Take the bootcamp', summary: 'You enrol.', t: 3 },
    { ref: 'b', type: 'milestone', title: 'First portfolio piece', summary: 'Shipped.', t: 9 },
  ],
  edges: [
    {
      from: 'start',
      to: 'a',
      kind: 'choice',
      hypothesis: 'You choose to enrol.',
      confidence: 'high',
    },
    {
      from: 'a',
      to: 'b',
      kind: 'causal',
      hypothesis: 'The course produces work.',
      confidence: 'medium',
    },
  ],
});

// ---------------------------------------------------------------------------
// extractJson
// ---------------------------------------------------------------------------

describe('extractJson', () => {
  it('takes a bare object', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it('strips a markdown fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips a fence with no language tag', () => {
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('finds an object buried in prose', () => {
    const out = extractJson(
      'Sure! Here is the JSON you asked for:\n{"a": {"b": 2}}\nHope that helps.'
    );
    expect(out).toBe('{"a": {"b": 2}}');
  });

  it('strips a byte-order mark', () => {
    expect(extractJson('\uFEFF{"a":1}')).toBe('{"a":1}');
  });

  it('respects braces inside strings', () => {
    const out = extractJson('text {"s": "a } brace inside", "n": 1}');
    expect(out).toBe('{"s": "a } brace inside", "n": 1}');
  });

  it('respects escaped quotes', () => {
    const out = extractJson('x {"s": "quote \\" and } brace", "n": 1}');
    expect(out).toBe('{"s": "quote \\" and } brace", "n": 1}');
  });

  it('returns null when there is no object', () => {
    expect(extractJson('I am afraid I cannot help with that.')).toBeNull();
  });

  it('hands a leading object straight through — JSON.parse is the judge, not this helper', () => {
    // extractJson only unwraps; malformed JSON must be caught by parseScenarioResponse, which
    // reports it as a typed fatal error rather than silently discarding the response.
    expect(extractJson('{"a": {"b": 1}')).toBe('{"a": {"b": 1}');
    const parsed = parseScenarioResponse('{"a": {"b": 1}');
    expect(parsed.ok).toBe(false);
    expect(parsed.issues[0]?.message).toContain('not valid JSON');
  });
});

// ---------------------------------------------------------------------------
// parseScenarioResponse
// ---------------------------------------------------------------------------

describe('parseScenarioResponse', () => {
  it('accepts a well-formed response', () => {
    const parsed = parseScenarioResponse(VALID_CONTENT);
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.nodes).toHaveLength(3);
    expect(parsed.data?.edges).toHaveLength(2);
    expect(parsed.issues.filter((i) => i.fatal)).toEqual([]);
  });

  it('never throws on arbitrary junk', () => {
    const junk = ['', '   ', 'null', '[]', '"a string"', '42', '{', '{"nodes:', '   '];
    for (const input of junk) {
      expect(() => parseScenarioResponse(input)).not.toThrow();
      expect(parseScenarioResponse(input).ok).toBe(false);
    }
  });

  it('rejects an empty response with a fatal issue', () => {
    const parsed = parseScenarioResponse('   ');
    expect(parsed.ok).toBe(false);
    expect(parsed.issues[0]?.fatal).toBe(true);
    expect(parsed.issues[0]?.message).toContain('empty');
  });

  it('rejects a response with no JSON at all', () => {
    const parsed = parseScenarioResponse('I cannot produce that scenario.');
    expect(parsed.ok).toBe(false);
    expect(parsed.issues[0]?.message).toContain('No JSON object');
  });

  it('rejects JSON that is not an object', () => {
    const parsed = parseScenarioResponse('["nodes"]');
    expect(parsed.ok).toBe(false);
    expect(parsed.issues[0]?.fatal).toBe(true);
  });

  it('rejects a response with no nodes', () => {
    const parsed = parseScenarioResponse(JSON.stringify({ edges: [] }));
    expect(parsed.ok).toBe(false);
    expect(parsed.issues[0]?.path).toBe('nodes');
  });

  it('rejects an oversized response before parsing it', () => {
    const parsed = parseScenarioResponse('x'.repeat(AI_LIMITS.maxResponseChars + 1));
    expect(parsed.ok).toBe(false);
    expect(parsed.issues[0]?.message).toContain('exceeding the limit');
  });

  it('drops malformed nodes but keeps the good ones', () => {
    const parsed = parseScenarioResponse(
      JSON.stringify({
        nodes: [
          { ref: 'start', type: 'start', title: 'Now', summary: 'ok', t: 0 },
          'not an object',
          { ref: '', title: 'no ref' },
          { ref: 'noTitle', summary: 'no title at all' },
          { ref: 'good', type: 'event', title: 'Still here', summary: 'ok', t: 6 },
        ],
        edges: [
          { from: 'start', to: 'good', kind: 'causal', hypothesis: 'h', confidence: 'medium' },
        ],
      })
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.nodes.map((n) => n.ref)).toEqual(['start', 'good']);
    expect(parsed.dropped).toBe(3);
    expect(parsed.issues.some((i) => i.message.includes('missing a "ref"'))).toBe(true);
  });

  it('drops a duplicate node reference', () => {
    const parsed = parseScenarioResponse(
      JSON.stringify({
        nodes: [
          { ref: 'start', type: 'start', title: 'Now', summary: 'ok', t: 0 },
          { ref: 'start', type: 'event', title: 'Duplicate', summary: 'ok', t: 3 },
        ],
        edges: [],
      })
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.nodes).toHaveLength(1);
    expect(parsed.dropped).toBe(1);
  });

  it('coerces an unknown node type rather than rejecting the node', () => {
    const parsed = parseScenarioResponse(
      JSON.stringify({
        nodes: [
          { ref: 'start', type: 'start', title: 'Now', summary: 'ok', t: 0 },
          { ref: 'weird', type: 'wormhole', title: 'Odd', summary: 'ok', t: 3 },
        ],
        edges: [
          { from: 'start', to: 'weird', kind: 'causal', hypothesis: 'h', confidence: 'medium' },
        ],
      })
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.nodes[1]?.type).toBe('event');
    expect(parsed.issues.some((i) => i.message.includes('wormhole'))).toBe(true);
  });

  it('truncates a response with too many nodes and says so', () => {
    const nodes = Array.from({ length: AI_LIMITS.maxNodes + 5 }, (_, i) => ({
      ref: `n${i}`,
      type: 'event',
      title: `Node ${i}`,
      summary: 'ok',
      t: i,
    }));
    const edges = nodes.slice(0, -1).map((n, i) => ({
      from: n.ref,
      to: nodes[i + 1]!.ref,
      kind: 'causal',
      hypothesis: 'h',
      confidence: 'medium' as const,
    }));
    const parsed = parseScenarioResponse(JSON.stringify({ nodes, edges }));
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.nodes).toHaveLength(AI_LIMITS.maxNodes);
    expect(parsed.issues.some((i) => i.message.includes('only the first'))).toBe(true);
  });

  it('drops edges that reference missing nodes, self-loops and duplicates', () => {
    const parsed = parseScenarioResponse(
      JSON.stringify({
        nodes: [
          { ref: 'start', type: 'start', title: 'Now', summary: 'ok', t: 0 },
          { ref: 'a', type: 'event', title: 'A', summary: 'ok', t: 3 },
        ],
        edges: [
          { from: 'start', to: 'a', kind: 'causal', hypothesis: 'h', confidence: 'medium' },
          { from: 'start', to: 'a', kind: 'causal', hypothesis: 'h', confidence: 'medium' },
          { from: 'start', to: 'ghost', kind: 'causal', hypothesis: 'h', confidence: 'medium' },
          { from: 'a', to: 'a', kind: 'causal', hypothesis: 'h', confidence: 'medium' },
        ],
      })
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.edges).toHaveLength(1);
    expect(parsed.dropped).toBe(3);
  });

  it('rejects a multi-node response whose edges are all unusable', () => {
    const parsed = parseScenarioResponse(
      JSON.stringify({
        nodes: [
          { ref: 'start', type: 'start', title: 'Now', summary: 'ok', t: 0 },
          { ref: 'a', type: 'event', title: 'A', summary: 'ok', t: 3 },
        ],
        edges: [{ from: 'x', to: 'y', kind: 'causal', hypothesis: 'h', confidence: 'medium' }],
      })
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.issues.some((i) => i.fatal && i.path === 'edges')).toBe(true);
  });

  it('drops effects with no reason or an unknown operation', () => {
    const parsed = parseScenarioResponse(
      JSON.stringify({
        nodes: [
          { ref: 'start', type: 'start', title: 'Now', summary: 'ok', t: 0 },
          {
            ref: 'a',
            type: 'event',
            title: 'A',
            summary: 'ok',
            t: 3,
            effects: [
              { key: 'money', op: 'add', value: 100, reason: 'a real reason' },
              { key: 'money', op: 'add', value: 100 },
              { key: 'money', op: 'teleport', value: 1, reason: 'nope' },
              { key: 'money', op: 'add', value: 'not a number', reason: 'nope' },
            ],
          },
        ],
        edges: [{ from: 'start', to: 'a', kind: 'causal', hypothesis: 'h', confidence: 'medium' }],
      })
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.nodes[1]?.effects).toHaveLength(1);
    expect(parsed.data?.nodes[1]?.effects?.[0]?.op).toBe('add');
    expect(parsed.issues.filter((i) => i.message.includes('effect'))).toHaveLength(3);
  });

  it('parses a response wrapped in a fence, as models often send', () => {
    const parsed = parseScenarioResponse(`Here you go:\n\`\`\`json\n${VALID_CONTENT}\n\`\`\``);
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.nodes).toHaveLength(3);
  });

  it('coerces unlabelled evidence to the cautious class instead of dropping it', () => {
    const parsed = parseScenarioResponse(
      JSON.stringify({
        nodes: [
          {
            ref: 'start',
            type: 'start',
            title: 'Now',
            summary: 'ok',
            t: 0,
            evidence: [{ text: 'unlabelled' }],
          },
        ],
        edges: [],
      })
    );
    expect(parsed.ok).toBe(true);
    // An unrecognised class is never trusted as-is: it is downgraded, not promoted.
    expect(parsed.data?.nodes[0]?.evidence[0]?.cls).toBe('assumption');
    expect(parsed.data?.nodes[0]?.evidence[0]?.text).toBe('unlabelled');
  });

  it('marks a node with no evidence at all as speculative', () => {
    const parsed = parseScenarioResponse(
      JSON.stringify({
        nodes: [{ ref: 'start', type: 'start', title: 'Now', summary: 'ok', t: 0, evidence: [] }],
        edges: [],
      })
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.nodes[0]?.evidence[0]?.cls).toBe('speculation');
  });
});

// ---------------------------------------------------------------------------
// provider helpers
// ---------------------------------------------------------------------------

describe('provider helpers', () => {
  it('turns a failed parse into a typed error result', () => {
    const result = toResult(parseScenarioResponse('junk'), 'openai-compatible', 'label', 5);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_response');
  });

  it('turns a good parse into a successful result carrying its notes', () => {
    const result = toResult(parseScenarioResponse(VALID_CONTENT), 'openai-compatible', 'label', 5);
    expect(result.ok).toBe(true);
    expect(result.data?.nodes).toHaveLength(3);
  });

  it('drops effects on keys no variable declares', () => {
    const parsed = parseScenarioResponse(VALID_CONTENT);
    expect(parsed.ok).toBe(true);
    if (!parsed.data) return;
    const withUnknown = {
      ...parsed.data,
      nodes: [
        {
          ...parsed.data.nodes[0]!,
          effects: [{ key: 'imaginary', op: 'add' as const, value: 1, reason: 'r' }],
        },
      ],
    };
    const normalised = normaliseEffects(withUnknown, ALL_VARS);
    expect(normalised.nodes[0]?.effects).toEqual([]);
  });

  it('redacts an API key from anything printable', () => {
    expect(redact('error at https://x?k=sk-abc123secret', 'sk-abc123secret')).not.toContain(
      'sk-abc123secret'
    );
    expect(redact('no key here', undefined)).toBe('no key here');
    // Too short to be worth redacting (would mangle ordinary text).
    expect(redact('abc', 'abc')).toBe('abc');
  });
});

// ---------------------------------------------------------------------------
// HTTP provider with an injected transport
// ---------------------------------------------------------------------------

describe('HTTP provider', () => {
  it('returns parsed data on a good response', async () => {
    const provider = createHttpProvider(settings(), {
      fetchImpl: () => Promise.resolve(completion(VALID_CONTENT)),
    });
    const result = await provider.generate(request());
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('openai-compatible');
    expect(result.data?.nodes).toHaveLength(3);
    expect(result.notes.some((n) => n.includes('Received from'))).toBe(true);
  });

  it('sends the model and the JSON response format, and no key when keyless', async () => {
    const captured: { url: string; headers: Record<string, string>; body: string }[] = [];
    const provider = createHttpProvider(settings(), {
      fetchImpl: (url, init) => {
        captured.push({ url, headers: init.headers, body: init.body });
        return Promise.resolve(completion(VALID_CONTENT));
      },
    });
    await provider.generate(request());
    expect(captured[0]?.url).toBe('https://example.test/v1/chat/completions');
    const body = JSON.parse(captured[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body['model']).toBe('test-model');
    expect(body['response_format']).toEqual({ type: 'json_object' });
    expect(captured[0]?.headers['Authorization']).toBeUndefined();
  });

  it('sends a bearer key when one is configured, and never exposes it on the provider', async () => {
    let seenAuth: string | undefined;
    const provider = createHttpProvider(settings({ apiKey: 'sk-secret-9999', keyless: false }), {
      fetchImpl: (_url, init) => {
        seenAuth = init.headers['Authorization'];
        return Promise.resolve(completion(VALID_CONTENT));
      },
    });
    const result = await provider.generate(request());
    expect(result.ok).toBe(true);
    expect(seenAuth).toBe('Bearer sk-secret-9999');
    expect(JSON.stringify(provider)).not.toContain('sk-secret-9999');
  });

  it('refuses to run without a key when the endpoint needs one', async () => {
    const provider = createHttpProvider(settings({ keyless: false }), {
      fetchImpl: () => Promise.resolve(completion(VALID_CONTENT)),
    });
    const result = await provider.generate(request());
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('missing_key');
  });

  it('reports an unconfigured endpoint', async () => {
    const provider = createHttpProvider(settings({ baseUrl: '', model: '' }));
    const result = await provider.generate(request());
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('not_configured');
  });

  it('falls back to the built-in engine on a 401, without leaking the key', async () => {
    const provider = createHttpProvider(settings({ apiKey: 'sk-bad-key-000', keyless: false }), {
      fetchImpl: () =>
        Promise.resolve(response('{"error":"bad key sk-bad-key-000"}', { ok: false, status: 401 })),
    });
    const result = await provider.generate(request());
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('offline');
    expect(result.data?.nodes.length).toBeGreaterThan(0);
    expect(result.error?.code).toBe('unauthorised');
    expect(JSON.stringify(result)).not.toContain('sk-bad-key-000');
  });

  it('does not fall back in strict mode, so the user sees the real failure', async () => {
    const provider = createHttpProvider(settings({ strict: true }), {
      fetchImpl: () => Promise.resolve(response('nope', { ok: false, status: 500 })),
    });
    const result = await provider.generate(request());
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('provider_error');
    expect(result.error?.message).toContain('500');
  });

  it('classifies rate limiting distinctly', async () => {
    const provider = createHttpProvider(settings({ strict: true }), {
      fetchImpl: () => Promise.resolve(response('slow down', { ok: false, status: 429 })),
    });
    const result = await provider.generate(request());
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('rate_limited');
  });

  it('falls back when the endpoint returns a non-JSON envelope', async () => {
    const provider = createHttpProvider(settings(), {
      fetchImpl: () => Promise.resolve(response('<html>gateway error</html>')),
    });
    const result = await provider.generate(request());
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('offline');
    expect(result.error?.code).toBe('bad_envelope');
  });

  it('falls back when the envelope carries no message content', async () => {
    const provider = createHttpProvider(settings(), {
      fetchImpl: () => Promise.resolve(response(JSON.stringify({ choices: [] }))),
    });
    const result = await provider.generate(request());
    expect(result.ok).toBe(true);
    expect(result.error?.code).toBe('empty_content');
  });

  it('falls back when the content is not a usable scenario', async () => {
    const provider = createHttpProvider(settings(), {
      fetchImpl: () => Promise.resolve(completion('{"nodes":[]}')),
    });
    const result = await provider.generate(request());
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('offline');
    expect(result.error?.code).toBe('invalid_response');
  });

  it('falls back when the transport throws', async () => {
    const provider = createHttpProvider(settings(), {
      fetchImpl: () => Promise.reject(new Error('ECONNREFUSED 127.0.0.1:11434')),
    });
    const result = await provider.generate(request());
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('offline');
    expect(result.error?.code).toBe('network_error');
    expect(`${result.error?.detail ?? ''}${result.error?.message ?? ''}`).toContain('ECONNREFUSED');
  });

  it('reports a cancellation as a cancellation, not a failure', async () => {
    const controller = new AbortController();
    const provider = createHttpProvider(settings({ strict: true }), {
      fetchImpl: () => Promise.reject(new Error('aborted')),
    });
    controller.abort();
    const result = await provider.generate(request({ signal: controller.signal }));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('cancelled');
  });

  it('reports progress notes through the callback', async () => {
    const notes: string[] = [];
    const provider = createHttpProvider(settings(), {
      fetchImpl: () => Promise.resolve(completion(VALID_CONTENT)),
    });
    await provider.generate(request({ onProgress: (n) => notes.push(n) }));
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some((n) => n.includes('Contacting'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Authenticated transport
//
// The desktop app keeps the provider key in the main process, so the request
// is made there. These tests cover the path that makes a configured provider
// actually usable instead of silently falling back to the built-in engine.
// ---------------------------------------------------------------------------

describe('HTTP provider with an authenticated transport', () => {
  it('works without a key in the settings, because the transport authenticates', async () => {
    // Regression guard: the provider used to insist on `settings.apiKey`,
    // which the renderer never has, so every keyed provider failed.
    const provider = createHttpProvider(settings({ keyless: false, apiKey: undefined }), {
      transport: {
        request: () =>
          Promise.resolve({
            ok: true,
            status: 200,
            text: JSON.stringify({ choices: [{ message: { content: VALID_CONTENT } }] }),
          }),
      },
    });
    const result = await provider.generate(request());
    expect(result.ok).toBe(true);
    expect(result.data?.nodes).toHaveLength(3);
  });

  it('hands the transport the URL, body, timeout and keyless flag', async () => {
    const captured: {
      url: string;
      body: string;
      timeoutMs: number;
      keyless?: boolean;
    }[] = [];
    const provider = createHttpProvider(settings({ timeoutMs: 1234, keyless: true }), {
      transport: {
        request: (input) => {
          captured.push(input);
          return Promise.resolve({
            ok: true,
            status: 200,
            text: JSON.stringify({ choices: [{ message: { content: VALID_CONTENT } }] }),
          });
        },
      },
    });
    await provider.generate(request());
    expect(captured[0]?.url).toBe('https://example.test/v1/chat/completions');
    expect(captured[0]?.timeoutMs).toBe(1234);
    expect(captured[0]?.keyless).toBe(true);
    expect(JSON.parse(captured[0]?.body ?? '{}')).toMatchObject({ model: 'test-model' });
  });

  it('explains a missing key instead of failing vaguely', async () => {
    const provider = createHttpProvider(settings({ keyless: false, strict: true }), {
      transport: {
        request: () =>
          Promise.resolve({
            ok: false,
            status: 0,
            text: '',
            transportError: 'no_key' as const,
            message: 'No API key is stored for this provider.',
          }),
      },
    });
    const result = await provider.generate(request());
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('no_key');
    expect(result.error?.message).toContain('API key');
  });

  it('falls back to the built-in engine when the transport cannot connect', async () => {
    const provider = createHttpProvider(settings(), {
      transport: {
        request: () =>
          Promise.resolve({
            ok: false,
            status: 0,
            text: '',
            transportError: 'network' as const,
            message: 'Could not reach the provider.',
          }),
      },
    });
    const result = await provider.generate(request());
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('offline');
    expect(result.notes.some((n) => n.includes('could not be used'))).toBe(true);
  });

  it('reports a provider rejection without falling back in strict mode', async () => {
    const provider = createHttpProvider(settings({ strict: true }), {
      transport: {
        request: () => Promise.resolve({ ok: false, status: 429, text: 'slow down' }),
      },
    });
    const result = await provider.generate(request());
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('rate_limited');
  });
});

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

describe('selectProvider', () => {
  it('uses the built-in engine for offline settings', () => {
    const provider = selectProvider(DEFAULT_SETTINGS);
    expect(provider.id).toBe('offline');
    expect(provider.available).toBe(true);
  });

  it('builds an HTTP provider when a remote endpoint is configured', () => {
    const provider = selectProvider(settings());
    expect(provider.id).toBe('openai-compatible');
  });

  it('prefers an injected main-process transport over in-renderer fetch', () => {
    const provider = selectProvider(settings(), {
      remoteGenerate: () =>
        Promise.resolve(
          toResult(parseScenarioResponse(VALID_CONTENT), 'openai-compatible', 'remote', 1)
        ),
    });
    expect(provider.label).toContain('remote');
  });
});

// ---------------------------------------------------------------------------
// Document construction from a model response
// ---------------------------------------------------------------------------

describe('documentFromResponse', () => {
  // Resolved once at collection time so the fixture is provably present for every test below.
  const baseResponse = (() => {
    const parsed = parseScenarioResponse(VALID_CONTENT);
    if (!parsed.data) throw new Error('fixture response must parse');
    return parsed.data;
  })();
  const meta = { generator: 'ai' as const, providerLabel: 'test', provenance: 'test' };

  it('produces exactly one start node even when the model calls the root something else', () => {
    const doc = documentFromResponse(baseResponse, prompt, 42, 'sim-1', meta);
    expect(Object.values(doc.nodes).filter((n) => n.type === 'start')).toHaveLength(1);
    expect(validateGraph(doc).errors).toEqual([]);
  });

  it('coerces a non-root node the model labelled "start" into an event', () => {
    const doc = documentFromResponse(
      {
        ...baseResponse,
        nodes: [
          {
            ref: 'root',
            type: 'event',
            title: 'Root',
            summary: 'ok',
            t: 0,
            assumptions: [],
            uncertainties: [],
            evidence: [{ cls: 'speculation', text: 'x' }],
          },
          {
            ref: 'wrong',
            type: 'start',
            title: 'Not the start',
            summary: 'ok',
            t: 4,
            assumptions: [],
            uncertainties: [],
            evidence: [{ cls: 'speculation', text: 'x' }],
          },
          {
            ref: 'tail',
            type: 'event',
            title: 'Tail',
            summary: 'ok',
            t: 8,
            assumptions: [],
            uncertainties: [],
            evidence: [{ cls: 'speculation', text: 'x' }],
          },
        ],
        edges: [
          { from: 'root', to: 'wrong', kind: 'causal', hypothesis: 'h', confidence: 'medium' },
          { from: 'wrong', to: 'tail', kind: 'causal', hypothesis: 'h', confidence: 'medium' },
        ],
      },
      prompt,
      1,
      'sim-2',
      meta
    );

    const starts = Object.values(doc.nodes).filter((n) => n.type === 'start');
    expect(starts).toHaveLength(1);
    expect(starts[0]?.id).toBe('n0');
    expect(validateGraph(doc).errors).toEqual([]);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('keeps parents/children consistent with the edge list', () => {
    const doc = documentFromResponse(baseResponse, prompt, 42, 'sim-3', meta);
    for (const edge of Object.values(doc.edges)) {
      expect(doc.nodes[edge.from]?.children).toContain(edge.to);
      expect(doc.nodes[edge.to]?.parents).toContain(edge.from);
    }
  });

  it('assigns every node a branch and every branch a real root', () => {
    const doc = documentFromResponse(baseResponse, prompt, 42, 'sim-4', meta);
    for (const node of Object.values(doc.nodes)) {
      expect(doc.branches[node.branch]).toBeDefined();
    }
    for (const branch of Object.values(doc.branches)) {
      expect(doc.nodes[branch.root]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end generation
// ---------------------------------------------------------------------------

describe('generateUniverse', () => {
  it('builds a valid universe with the offline engine and no provider configured', async () => {
    const outcome = await generateUniverse({
      prompt,
      settings: DEFAULT_SETTINGS,
      seed: 42,
      id: 'sim-offline',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.doc.meta.generator).toBe('offline');
    expect(validateGraph(outcome.doc).errors).toEqual([]);
    expect(Object.values(outcome.doc.nodes).filter((n) => n.type === 'start')).toHaveLength(1);
    expect(outcome.result.provider).toBe('offline');
  });

  it('uses a remote transport when one is injected, and marks the provenance honestly', async () => {
    const outcome = await generateUniverse({
      prompt,
      settings: settings(),
      seed: 7,
      id: 'sim-remote',
      deps: {
        remoteGenerate: () =>
          Promise.resolve(
            toResult(parseScenarioResponse(VALID_CONTENT), 'openai-compatible', 'remote-test', 3)
          ),
      },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.doc.meta.generator).toBe('ai');
    expect(outcome.doc.meta.provenance).toContain('remote-test');
    expect(validateGraph(outcome.doc).errors).toEqual([]);
    expect(Object.values(outcome.doc.nodes).filter((n) => n.type === 'start')).toHaveLength(1);
  });

  it('degrades to the built-in engine when the remote provider fails, and says so', async () => {
    const outcome = await generateUniverse({
      prompt,
      settings: settings(),
      seed: 7,
      id: 'sim-degraded',
      deps: {
        remoteGenerate: () =>
          Promise.resolve({
            ok: false,
            provider: 'openai-compatible',
            providerLabel: 'remote',
            notes: [],
            elapsedMs: 2,
            error: { code: 'provider_error', message: 'server exploded' },
          }),
      },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.doc.meta.generator).toBe('offline');
    expect(validateGraph(outcome.doc).errors).toEqual([]);
    expect(outcome.result.notes.join(' ')).toContain('server exploded');
  });

  it('degrades when the remote transport throws', async () => {
    const outcome = await generateUniverse({
      prompt,
      settings: settings(),
      seed: 7,
      id: 'sim-throws',
      deps: { remoteGenerate: () => Promise.reject(new Error('socket hang up')) },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.doc.meta.generator).toBe('offline');
    expect(validateGraph(outcome.doc).errors).toEqual([]);
  });

  it('detects archetypes the prompt did not declare', async () => {
    const outcome = await generateUniverse({
      prompt: { ...prompt, archetypes: [] },
      settings: DEFAULT_SETTINGS,
      seed: 1,
      id: 'sim-arch',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.doc.prompt.archetypes.length).toBeGreaterThan(0);
  });

  it('reports progress while generating', async () => {
    const notes: string[] = [];
    await generateUniverse({
      prompt,
      settings: DEFAULT_SETTINGS,
      seed: 1,
      id: 'sim-progress',
      onProgress: (n) => notes.push(n),
    });
    expect(notes.length).toBeGreaterThan(0);
  });
});

describe('offline provider and universe', () => {
  it('is always available', () => {
    expect(offlineProvider.available).toBe(true);
  });

  it('composes a response that round-trips through the schema validator', async () => {
    const result = await offlineProvider.generate(request());
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    const reparsed = parseScenarioResponse(JSON.stringify(result.data));
    expect(reparsed.ok).toBe(true);
  });

  it('is deterministic for the same prompt', async () => {
    const a = await offlineProvider.generate(request());
    const b = await offlineProvider.generate(request());
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
  });

  it('composes a different scenario for a different prompt', () => {
    const a = composeScenario(prompt);
    const b = composeScenario({
      ...prompt,
      situation: 'I want to move to Lisbon and start a cafe.',
      archetypes: ['business', 'relocation'],
    });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('offlineUniverse produces a valid document', () => {
    const doc: SimulationDoc = offlineUniverse(prompt, 42, 'sim-bypass');
    expect(validateGraph(doc).errors).toEqual([]);
    expect(validateDocument(doc).ok).toBe(true);
    expect(doc.id).toBe('sim-bypass');
  });
});
