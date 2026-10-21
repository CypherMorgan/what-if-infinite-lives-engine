/**
 * Update channel tests.
 *
 * The update check is the one place the app voluntarily talks to the network,
 * so its behaviour has to be exactly right: it must never report an update
 * that does not exist, never offer a pre-release by accident, and never fail
 * silently.
 */
import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  evaluateUpdate,
  isNewerVersion,
  parseLatestRelease,
  readUpdateResponse,
} from '../src/core/update';

function release(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: 'v1.2.0',
    name: 'Version 1.2.0',
    html_url: 'https://github.com/CypherMorgan/what-if-infinite-lives-engine/releases/tag/v1.2.0',
    body: 'Fixed a thing.',
    published_at: '2026-01-01T00:00:00Z',
    draft: false,
    prerelease: false,
    ...overrides,
  };
}

describe('compareVersions', () => {
  it('orders releases by number, not by string', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.9.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });

  it('treats a missing component as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
    expect(compareVersions('1.2.1', '1.2')).toBeGreaterThan(0);
  });

  it('ignores a leading v', () => {
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0);
  });

  it('sorts a pre-release before the matching final release', () => {
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBeLessThan(0);
    expect(compareVersions('1.2.0', '1.2.0-beta.1')).toBeGreaterThan(0);
  });

  it('handles rubbish without throwing', () => {
    expect(compareVersions('not-a-version', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('', '')).toBe(0);
  });

  it('exposes a simple "is newer" question', () => {
    expect(isNewerVersion('1.2.0', '1.1.9')).toBe(true);
    expect(isNewerVersion('1.1.9', '1.2.0')).toBe(false);
    expect(isNewerVersion('1.2.0', '1.2.0')).toBe(false);
  });
});

describe('parseLatestRelease', () => {
  it('reads a release payload', () => {
    const parsed = parseLatestRelease(release());
    expect(parsed).not.toBeNull();
    expect(parsed?.version).toBe('1.2.0');
    expect(parsed?.tag).toBe('v1.2.0');
    expect(parsed?.title).toBe('Version 1.2.0');
    expect(parsed?.notes).toBe('Fixed a thing.');
    expect(parsed?.prerelease).toBe(false);
  });

  it('rejects payloads it cannot use', () => {
    expect(parseLatestRelease(null)).toBeNull();
    expect(parseLatestRelease('a string')).toBeNull();
    expect(parseLatestRelease({})).toBeNull();
    expect(parseLatestRelease({ tag_name: '' })).toBeNull();
    expect(parseLatestRelease({ tag_name: 42 })).toBeNull();
  });

  it('drops a release URL that is not on GitHub', () => {
    const parsed = parseLatestRelease(release({ html_url: 'https://example.com/evil' }));
    expect(parsed?.url).toBe('');
  });

  it('treats a draft as a pre-release', () => {
    const parsed = parseLatestRelease(release({ draft: true }));
    expect(parsed?.prerelease).toBe(true);
  });
});

describe('evaluateUpdate', () => {
  it('reports an available update', () => {
    const parsed = parseLatestRelease(release());
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const check = evaluateUpdate('1.1.0', parsed);
    expect(check.status).toBe('update-available');
    expect(check.latest).toBe('1.2.0');
    expect(check.current).toBe('1.1.0');
  });

  it('reports being up to date', () => {
    const parsed = parseLatestRelease(release());
    if (!parsed) return;
    expect(evaluateUpdate('1.2.0', parsed).status).toBe('up-to-date');
    expect(evaluateUpdate('1.3.0', parsed).status).toBe('up-to-date');
  });

  it('never offers a pre-release', () => {
    const parsed = parseLatestRelease(release({ tag_name: 'v2.0.0-beta.1', prerelease: true }));
    if (!parsed) return;
    const check = evaluateUpdate('1.2.0', parsed);
    expect(check.status).not.toBe('update-available');
    expect(check.message).toContain('pre-release');
  });
});

describe('readUpdateResponse', () => {
  it('turns a payload into a check', () => {
    const check = readUpdateResponse('1.1.0', { payload: release() });
    expect(check.status).toBe('update-available');
    expect(check.latest).toBe('1.2.0');
  });

  it('surfaces an error from the main process', () => {
    const check = readUpdateResponse('1.1.0', { error: 'offline' });
    expect(check.status).toBe('error');
    expect(check.message).toBe('offline');
  });

  it('reports an empty feed as unavailable rather than as an error', () => {
    const check = readUpdateResponse('1.1.0', { payload: { nothing: true } });
    expect(check.status).toBe('unavailable');
  });

  it('survives a nonsensical response', () => {
    expect(readUpdateResponse('1.1.0', null).status).toBe('error');
    expect(readUpdateResponse('1.1.0', undefined).status).toBe('error');
    expect(readUpdateResponse('1.1.0', 'nope').status).toBe('error');
  });
});
