# Security Policy

## Supported Versions

We support the latest release on the `main` branch.

## Reporting a Vulnerability

If you discover a security vulnerability, please do **not** open a public issue. Instead:

1. Email the maintainers with details (include steps to reproduce if possible)
2. Allow reasonable time for a fix before disclosure
3. We'll acknowledge receipt and keep you updated on progress

## Security Notes

- **Local-first**: No telemetry or outbound calls by default
- **Secrets**: API keys are encrypted with Windows DPAPI via Electron's `safeStorage` and stored in the app data directory
- **Renderer isolation**: `contextIsolation: true`, `nodeIntegration: false`, CSP enforced
- **Network**: Only when an OpenAI-compatible provider is explicitly configured; requests go through the main process proxy
- **No native modules**: Reduces attack surface from native code
