/**
 * The renderer's view of the desktop shell.
 *
 * Everything the renderer can ask the main process to do is declared here, and
 * nothing else is reachable: there is no `require`, no `ipcRenderer` and no
 * Node in the renderer. The surface is deliberately small and explicit so it
 * can be audited in one place.
 *
 * The type mirrors `electron/preload.ts` exactly. When the two drift, the
 * renderer notices at compile time rather than at runtime.
 */

/** Filters offered in the native file dialogs. */
export interface FileFilter {
  name: string;
  extensions: string[];
}

/** A provider request handed to the main process, which authenticates it. */
export interface AiRequest {
  /** Fully-formed endpoint URL. */
  url: string;
  /** Serialised JSON request body. */
  body: string;
  /** Milliseconds before the request is abandoned. */
  timeoutMs: number;
  /**
   * Whether this provider needs no credential at all, such as a local Ollama
   * server. When false and no key is stored, the request is refused with a
   * clear reason instead of being sent without a credential and failing
   * somewhere less obvious.
   */
  keyless?: boolean;
}

/** The main process's answer to an {@link AiRequest}. */
export interface AiResponse {
  /** True when the provider answered with a success status. */
  ok: boolean;
  /** HTTP status, or 0 when the request never reached the provider. */
  status: number;
  /** The response body. */
  text: string;
  /** Set when the request failed before the provider could answer. */
  transportError?: 'no_key' | 'network' | 'timeout' | 'blocked';
  /** Human-readable detail, already stripped of any credential. */
  message?: string;
}

export interface WhatIfsBridge {
  /** `process.platform`, so the UI can adapt to the host OS. */
  platform: string;

  /* files */
  openFile(filters?: FileFilter[]): Promise<{ path: string; text: string } | null>;
  saveFile(defaultName: string, text: string, filters?: FileFilter[]): Promise<string | null>;

  /* clipboard */
  writeText(text: string): Promise<boolean>;
  readText(): Promise<string>;

  /* secrets — encrypted in the main process, never readable from the renderer */
  setSecret(key: string, value: string): Promise<boolean>;
  getSecret(key: string): Promise<string | null>;
  deleteSecret(key: string): Promise<boolean>;

  /* application menu → renderer */
  onMenu(handler: (payload: { kind: string }) => void): () => void;

  appVersion(): Promise<string>;

  /* updates — checked only when the user asks, never automatically */
  checkForUpdate(): Promise<unknown>;
  openReleasePage(url: string): Promise<boolean>;

  /* provider requests — authenticated in the main process */
  aiRequest(request: AiRequest): Promise<AiResponse>;
}

declare global {
  interface Window {
    whatifs?: WhatIfsBridge;
  }
}
