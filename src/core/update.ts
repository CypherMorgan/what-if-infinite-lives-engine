/**
 * Update checking.
 *
 * The app deliberately does **not** install updates by itself. The Windows
 * build is not code-signed, and a silent download-and-install on an unsigned
 * binary produces SmartScreen prompts and half-finished installs that are worse
 * than not offering the feature at all. Instead the app asks the public release
 * feed whether something newer exists and links the user to the release page,
 * where the installer is fetched exactly the way it always has been.
 *
 * This module is pure so it can be unit-tested without a network or Electron.
 */

/** The parts of a published release the app cares about. */
export interface ReleaseInfo {
  /** Version without the leading `v`, e.g. `1.1.0`. */
  version: string;
  /** The original tag, e.g. `v1.1.0`. */
  tag: string;
  /** Human-facing page for the release. */
  url: string;
  /** Release title. */
  title: string;
  /** Release notes, plain text. */
  notes: string;
  /** ISO timestamp, or an empty string when unknown. */
  publishedAt: string;
  /** Whether the publisher marked this as a pre-release. */
  prerelease: boolean;
}

export type UpdateStatus =
  /** The installed version is the newest one published. */
  | 'up-to-date'
  /** A newer version is published. */
  | 'update-available'
  /** The feed answered, but nothing usable was in it. */
  | 'unavailable'
  /** The check itself failed — offline, rate limited, and so on. */
  | 'error';

export interface UpdateCheck {
  status: UpdateStatus;
  /** The version currently running. */
  current: string;
  /** The newest published version, when one was found. */
  latest?: string;
  /** Where to get it. */
  url?: string;
  /** Release notes, when available. */
  notes?: string;
  /** Human-readable explanation for the `unavailable` and `error` states. */
  message?: string;
}

/** Extract a comparable version from a tag such as `v1.2.3` or `1.2.3-beta.1`. */
interface ParsedVersion {
  parts: [number, number, number];
  prerelease: boolean;
}

function parseVersion(raw: string): ParsedVersion {
  const cleaned = raw.trim().replace(/^v/i, '');
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+](.*))?$/.exec(cleaned);
  if (!match) return { parts: [0, 0, 0], prerelease: false };
  const parts: [number, number, number] = [
    Number(match[1] ?? 0),
    Number(match[2] ?? 0),
    Number(match[3] ?? 0),
  ];
  return { parts, prerelease: Boolean(match[4]) };
}

/**
 * Compare two version strings.
 *
 * Returns a positive number when `a` is newer than `b`, negative when `a` is
 * older, and zero when they are the same release. A pre-release always sorts
 * before the matching final release, so `1.2.0-beta.1` is older than `1.2.0`.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = pa.parts[i]! - pb.parts[i]!;
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (pa.prerelease === pb.prerelease) return 0;
  return pa.prerelease ? -1 : 1;
}

/** True when `candidate` is strictly newer than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

/**
 * Pull release information out of a GitHub releases API payload.
 *
 * Returns null when the payload is not a release we can use — an empty feed, a
 * draft, a malformed entry, or something that is not an object at all.
 */
export function parseLatestRelease(payload: unknown): ReleaseInfo | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;

  const rawTag = record['tag_name'];
  if (typeof rawTag !== 'string' || rawTag.trim().length === 0) return null;

  const tag = rawTag.trim();
  const version = tag.replace(/^v/i, '');

  const rawUrl = record['html_url'];
  const url = typeof rawUrl === 'string' && /^https:\/\/github\.com\//i.test(rawUrl) ? rawUrl : '';

  const rawName = record['name'];
  const title = typeof rawName === 'string' && rawName.trim().length > 0 ? rawName.trim() : tag;

  const rawBody = record['body'];
  const notes = typeof rawBody === 'string' ? rawBody.trim() : '';

  const rawPublished = record['published_at'];
  const publishedAt = typeof rawPublished === 'string' ? rawPublished : '';

  const prerelease = record['prerelease'] === true || record['draft'] === true;

  return { version, tag, url, title, notes, publishedAt, prerelease };
}

/**
 * Decide what to tell the user about a published release.
 *
 * Pre-releases are never offered as an update: they are published for people
 * who went looking for them, and prompting everyone to install one would be
 * noise, not a service.
 */
export function evaluateUpdate(current: string, release: ReleaseInfo): UpdateCheck {
  if (release.prerelease) {
    return {
      status: 'up-to-date',
      current,
      latest: release.version,
      url: release.url,
      notes: release.notes,
      message: `Version ${release.version} is a pre-release, so it is not being offered.`,
    };
  }
  if (isNewerVersion(release.version, current)) {
    return {
      status: 'update-available',
      current,
      latest: release.version,
      url: release.url,
      notes: release.notes,
    };
  }
  return {
    status: 'up-to-date',
    current,
    latest: release.version,
    url: release.url,
    notes: release.notes,
  };
}

/** Turn whatever the main process returned into a check the UI can render. */
export function readUpdateResponse(current: string, response: unknown): UpdateCheck {
  if (!response || typeof response !== 'object') {
    return { status: 'error', current, message: 'The update check returned nothing useful.' };
  }
  const record = response as Record<string, unknown>;
  const error = record['error'];
  if (typeof error === 'string' && error.length > 0) {
    return { status: 'error', current, message: error };
  }
  const release = parseLatestRelease(record['payload']);
  if (!release) {
    return {
      status: 'unavailable',
      current,
      message: 'No published release was found on the update feed.',
    };
  }
  return evaluateUpdate(current, release);
}
