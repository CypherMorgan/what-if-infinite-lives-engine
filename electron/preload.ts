/**
 * Preload bridge.
 *
 * The renderer gets an explicit, minimal API surface — no `require`, no
 * `ipcRenderer`, no Node. Everything is contextBridge-exposed and auditable.
 */
import { contextBridge, ipcRenderer } from 'electron';

type Filter = { name: string; extensions: string[] };

const api = {
  platform: process.platform,

  /* files */
  openFile: (filters?: Filter[]): Promise<{ path: string; text: string } | null> =>
    ipcRenderer.invoke('file:open', filters),
  saveFile: (defaultName: string, text: string, filters?: Filter[]): Promise<string | null> =>
    ipcRenderer.invoke('file:save', defaultName, text, filters),

  /* clipboard */
  writeText: (text: string): Promise<boolean> => ipcRenderer.invoke('clipboard:write', text),
  readText: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),

  /* secrets — stored encrypted in the user data directory, never in the renderer */
  setSecret: (key: string, value: string): Promise<boolean> =>
    ipcRenderer.invoke('secret:set', key, value),
  getSecret: (key: string): Promise<string | null> => ipcRenderer.invoke('secret:get', key),
  deleteSecret: (key: string): Promise<boolean> => ipcRenderer.invoke('secret:delete', key),

  /* application menu → renderer */
  onMenu: (handler: (payload: { kind: string }) => void): (() => void) => {
    const listener = (_e: unknown, payload: { kind: string }): void => handler(payload);
    ipcRenderer.on('menu', listener);
    return () => ipcRenderer.removeListener('menu', listener);
  },

  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
};

contextBridge.exposeInMainWorld('whatifs', api);

export type WhatIfsApi = typeof api;
