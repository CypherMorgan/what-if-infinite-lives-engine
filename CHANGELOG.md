# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-10-21

### Fixed

- **The installed app would not start.** Electron derives `userData` from `productName`, and `"What If? — The Infinite Lives Engine"` contains a `?`, which Windows forbids in a path. Chromium aborted during startup (exit code `-36861`), so no window appeared and no data folder was created. The main process now sets a filesystem-safe app name before anything touches `userData`; the styled title is kept for the window and menus. `npm run appname:verify` now guards this in CI.
- App icon alpha channel was written on the wrong scale, rendering it invisible
- NSIS installer and portable build collided on the same artifact filename
- Release assets used spaces locally but hyphens on GitHub; names are now consistent
- Release workflow produced duplicate GitHub releases (electron-builder published each asset batch separately; a single release step now attaches all assets)

### Added

- Automated Windows release workflow (installer + portable attached to GitHub Releases)
- README screenshot gallery generated from the real UI (`npm run screenshots`)
- `icon:verify`, `appname:verify` and `screenshots:verify` integrity checks, wired into CI

### Changed

- The app version is now injected from `package.json` at build time, so exported universes, generated path reports and the About dialog always report the version that was actually shipped

## [1.0.0] - 2026-10-20

> **Do not use 1.0.0.** The build shipped an application name containing a `?`,
> which is illegal in a Windows path, so the app aborted on startup and never
> showed a window. Upgrade to 1.0.1 or later.

### Added

- Initial release: What If? — The Infinite Lives Engine
- Interactive multiverse graph (Canvas2D) with pan/zoom/drag/search/minimap
- Deterministic rule-based simulation engine (76 rules, 12 packs)
- Counterfactuals with lineage, snapshots, diffs, stability analysis
- Versioned JSON persistence with migrations (v1→v3) and repair-on-import
- Import/export `.whatif.json` envelope
- Offline-first provider + optional OpenAI-compatible HTTP provider with secure key storage (safeStorage)
- Undo/redo, branch collapse, auto-layout, comparison
- Dark cinematic UI with reduced-motion support
- Windows desktop app (Electron 44.9.0) with NSIS installer + portable
- Comprehensive test suite (146 passing tests)
- Documentation (README, ARCHITECTURE, CONTRIBUTING, SECURITY)
