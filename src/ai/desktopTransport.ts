/**
 * The desktop transport for AI provider requests.
 *
 * In the packaged app the provider credential is encrypted by `safeStorage` in
 * the main process and is deliberately unreadable from the renderer. The
 * request therefore has to be made on the far side of the bridge, where the
 * key can be attached without ever being exposed here.
 *
 * This adapter is what makes a configured provider actually work. Previously
 * the request was made straight from the renderer, where the key is not — so
 * every provider that requires one rejected the call with "missing key" and
 * the app silently fell back to the built-in engine.
 */
import type {
  ProviderTransport,
  ProviderTransportRequest,
  ProviderTransportResponse,
} from './provider';

type Bridge = {
  aiRequest(request: {
    url: string;
    body: string;
    timeoutMs: number;
    keyless?: boolean;
  }): Promise<ProviderTransportResponse>;
};

function bridge(): Bridge | null {
  if (typeof window === 'undefined') return null;
  return (window as { whatifs?: Bridge }).whatifs ?? null;
}

/**
 * Builds a transport backed by the desktop shell.
 *
 * Returns null when the app is running somewhere without the bridge — a plain
 * browser, or a test harness — so the caller can fall back to an in-process
 * fetch instead.
 */
export function createDesktopTransport(): ProviderTransport | null {
  const api = bridge();
  if (!api) return null;

  return {
    async request(
      input: ProviderTransportRequest,
      signal?: AbortSignal
    ): Promise<ProviderTransportResponse> {
      if (signal?.aborted) {
        return {
          ok: false,
          status: 0,
          text: '',
          transportError: 'network',
          message: 'The request was cancelled.',
        };
      }
      try {
        const response = await api.aiRequest({
          url: input.url,
          body: input.body,
          timeoutMs: input.timeoutMs,
          ...(input.keyless !== undefined ? { keyless: input.keyless } : {}),
        });
        return {
          ok: response.ok,
          status: response.status,
          text: response.text,
          ...(response.transportError ? { transportError: response.transportError } : {}),
          ...(response.message ? { message: response.message } : {}),
        };
      } catch (err) {
        return {
          ok: false,
          status: 0,
          text: '',
          transportError: 'network',
          message: err instanceof Error ? err.message : 'The request could not be made.',
        };
      }
    },
  };
}
