# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Automated Windows release workflow (installer + portable attached to GitHub Releases)
- README screenshot gallery generated from the real UI (`npm run screenshots`)
- `icon:verify` and `screenshots:verify` integrity checks, wired into CI

### Fixed

- App icon alpha channel was written on the wrong scale, rendering it invisible
- NSIS installer and portable build collided on the same artifact filename

## [1.0.0] - 2026-10-20

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
