/**
 * Error Boundary component to catch React errors gracefully.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            background: 'var(--bg-void)',
            color: 'var(--text)',
            flexDirection: 'column',
            padding: 20,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: 24, marginBottom: 8, fontFamily: 'var(--font-display)' }}>
            Something went wrong
          </h2>
          <p style={{ color: 'var(--text-dim)', marginBottom: 24, maxWidth: 500 }}>
            The application encountered an unexpected error. You can try reloading or report this
            issue.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => window.location.reload()}
            style={{ marginBottom: 12 }}
          >
            Reload Application
          </button>
          {this.state.error && (
            <details style={{ marginTop: 16, maxWidth: 600, textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-dim)' }}>
                Error details
              </summary>
              <pre
                style={{
                  background: 'var(--bg-panel)',
                  padding: 12,
                  borderRadius: 8,
                  overflow: 'auto',
                  fontSize: 11,
                  marginTop: 8,
                  color: 'var(--rose)',
                }}
              >
                {this.state.error.toString()}
                {'\n\n'}
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
