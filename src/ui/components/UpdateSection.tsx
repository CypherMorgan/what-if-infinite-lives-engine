/**
 * The "Updates" section of Settings.
 *
 * The check is explicit: the app never contacts the network on its own. It
 * asks only when the user presses the button, and it sends nothing but the
 * request itself — no identifier, no telemetry, no usage data.
 *
 * Updates are never installed automatically. The Windows build is not
 * code-signed, and a silent download-and-install on an unsigned binary ends
 * in SmartScreen prompts and half-finished installs. Instead the app links to
 * the release page, so the user always sees and chooses the download.
 */
import { useState } from 'react';
import { APP_VERSION } from '../../core/importExport';
import { readUpdateResponse, type UpdateCheck } from '../../core/update';

type Phase = 'idle' | 'checking' | 'done';

export function UpdateSection() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<UpdateCheck | null>(null);

  const check = async (): Promise<void> => {
    if (!window.whatifs) {
      setResult({
        status: 'error',
        current: APP_VERSION,
        message: 'Update checking is only available in the desktop app.',
      });
      setPhase('done');
      return;
    }
    setPhase('checking');
    try {
      const response = await window.whatifs.checkForUpdate();
      setResult(readUpdateResponse(APP_VERSION, response));
    } catch (err) {
      setResult({
        status: 'error',
        current: APP_VERSION,
        message: err instanceof Error ? err.message : 'The update check could not be completed.',
      });
    }
    setPhase('done');
  };

  const openRelease = async (): Promise<void> => {
    const url = result?.url;
    if (!url || !window.whatifs) return;
    await window.whatifs.openReleasePage(url);
  };

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontSize: 12.5 }}>Installed version</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            {APP_VERSION}
            {result?.latest ? ` · newest published is ${result.latest}` : ''}
          </div>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => void check()}
          disabled={phase === 'checking'}
        >
          {phase === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>
      </div>

      {result && <UpdateResult result={result} onOpen={() => void openRelease()} />}

      <div className="note" style={{ marginTop: 12 }}>
        Updates are never installed automatically. This build is not code-signed, so the installer
        always opens in your browser and you stay in control of when the app changes. Checking for
        updates contacts GitHub and sends nothing about you or your work.
      </div>
    </>
  );
}

function UpdateResult({ result, onOpen }: { result: UpdateCheck; onOpen: () => void }) {
  if (result.status === 'update-available') {
    return (
      <div
        className="note"
        style={{
          marginTop: 12,
          borderLeft: '2px solid var(--accent-cyan)',
          color: 'var(--text)',
        }}
      >
        <div style={{ fontSize: 12.5, marginBottom: 6 }}>
          Version {result.latest} is available. You are running {result.current}.
        </div>
        {result.notes ? (
          <details style={{ marginBottom: 8 }}>
            <summary style={{ cursor: 'pointer', fontSize: 11.5, color: 'var(--text-dim)' }}>
              What changed
            </summary>
            <pre
              style={{
                margin: '8px 0 0',
                whiteSpace: 'pre-wrap',
                fontSize: 11,
                color: 'var(--text-dim)',
                maxHeight: 220,
                overflowY: 'auto',
              }}
            >
              {result.notes}
            </pre>
          </details>
        ) : null}
        <button className="btn btn-primary" onClick={onOpen}>
          Open the release page
        </button>
      </div>
    );
  }

  if (result.status === 'up-to-date') {
    return (
      <div className="note" style={{ marginTop: 12 }}>
        {result.message ?? `You are on the newest published version (${result.current}).`}
      </div>
    );
  }

  return (
    <div className="note" style={{ marginTop: 12, borderLeft: '2px solid var(--warn, #ffb84d)' }}>
      <div style={{ fontSize: 12.5 }}>The update check did not complete</div>
      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
        {result.message ?? 'The release feed could not be read.'} Nothing was changed and no
        download was started. The app works exactly as it did before.
      </div>
    </div>
  );
}
