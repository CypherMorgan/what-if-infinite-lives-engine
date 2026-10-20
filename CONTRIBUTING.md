# Contributing

Thanks for considering contributing to **What If? — The Infinite Lives Engine**!

## Getting Started

1. Fork the repo and clone it
2. Install dependencies: `npm install`
3. Run dev: `npm run dev` (web) or `npm run dev:desktop` (Electron)
4. Run tests: `npm test`
5. Run checks: `npm run typecheck && npm run lint`

## Guidelines

- **Type safety**: Keep TypeScript strict. Avoid `any`; use the types in `src/core/types.ts`.
- **Determinism**: The engine must remain deterministic given a seed. Never introduce unseeded randomness in core simulation logic.
- **Offline-first**: New features must work without network access. Network calls only go through the provider interface in `src/ai/`.
- **Honesty**: If something is speculative/inferred, use evidence tags (`speculation`, `assumption`). Don't fabricate probabilities.
- **Tests**: Add/update tests for core logic changes in `tests/`. UI changes should not break existing tests.
- **No native modules**: Avoid adding native dependencies (they can't build in constrained environments). Stick to pure JS/TS.
- **Secrets**: Never log or persist API keys in the renderer. Use the secure IPC bridge.

## Pull Requests

- Keep PRs focused and small
- Include a clear description of the change
- Ensure `npm run typecheck`, `npm run lint`, and `npm test` all pass
- Update docs if behavior/API changes

## Code Style

- Follow existing patterns in the codebase
- Use clear, descriptive names
- Keep functions pure where possible
- Prefer explicit types over inference when it improves clarity
