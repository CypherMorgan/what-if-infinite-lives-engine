# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **A path you can print** — any path can now be exported as a PDF, laid out for paper rather than for a screen: the situation, a map of the whole universe drawn as parallel timelines with the path picked out and its steps numbered, the brief, every step in detail, and the assumptions the answer rests on. The report is one self-contained document that fetches nothing and runs no scripting, and everything you typed into the app is escaped before it goes anywhere near the markup. The desktop app prints it with Chromium's own PDF writer through a hidden window that has no Node, no preload and no JavaScript; in a browser there is no such thing, so the report opens in a new window and the browser's print dialog offers to save it. It is reached from the inspector and from the dossier, and it is not a screenshot of the app: it is a document written for the page.
- **Two paths, side by side** — the comparison view lines two paths up as the model actually built them, names the step where they part company, and lists what ends up different. The comparison is made at a common moment: both branches are projected forward to the horizon first, so the difference you see is a difference in the path rather than in the timing. "Favours" means the direction the model considers better for that variable; it is not a recommendation, and the view says so. The starting point is left out of it — it is where every path begins, not a path itself. The pair is remembered between sessions.

### Changed

- **The app can be used without a mouse, and read on a poor screen.** Focus moves into a dialog when it opens, lands on the field you would want to type into, stays inside while it is open, and returns to the control that opened it when it closes. `Esc` now closes a dialog from anywhere inside it, including from a text field. The app name is the only `h1`; every panel and card titles itself underneath it, and no heading level is skipped. The graph, the timeline, the dossier and the comparison are `main` regions, and the canvas describes itself in words with the same steps listed as text beside it. Every control has an accessible name — the on/off switches take theirs from the same string as their visible label, so the two cannot drift apart. `--text-faint` was below the 4.5:1 contrast threshold on every surface it was used on; it has been brought up, and the outline of a control now clears 3:1 against the background behind it.

### Fixed

- **The keyboard shortcuts modal was a dialog inside a dialog.** It rendered its own scrim and panel inside the one the modal host had already drawn, so there were two `aria-modal="true"` regions on the screen and the outer one had no name.
- **The orientation card announced itself as a dialog** it never took focus into. It is a card that sits beside the graph, so it is a labelled region now.

## [1.1.0] - 2026-10-21

The release that made the app usable by somebody who had never seen it.

### Added

- **The future dossier** — a plain-language brief on any path: where it leads, what it buys, what it costs, what could go wrong, how the model got there, what it rests on, and how much the model is allowed to wobble. Every figure in it is computed by the engine (`forecastFrom`, `outcomeSpread`, `whyThisPath`, `stabilityBetween`); where the model has nothing to say, the dossier says so rather than filling the gap. Reachable from the top bar and from every node, and it leads the Markdown path export.
- **A key, not a legend** — an on-screen panel explaining the symbols, the colours, which way time flows, and how to read a card. Open by default.
- **An introduction** — a first-run card that explains the app in a paragraph, with the walkthrough available on demand rather than fired at you unbidden.
- **Real sensitivity** — assumption influence is now measured by nudging the input ±25% and re-projecting the universe, rather than estimated.
- **A working update channel** — a user-initiated, dependency-free check of the GitHub releases API. No silent install; the app only ever links to the release page, and never offers a pre-release.
- **A working provider** — the credential is held in the main process and the request is made there, so the key never crosses the bridge. A configured provider now actually works.
- **`docs/EXPORT_FORMAT.md`** — the `.whatif.json` format specified in full: the envelope, every field of the document, the migration chain, the validation and repair rules, the limits.
- **`ROADMAP.md`** — what has shipped, what is being built, and what is deliberately not planned.
- **Store test suite** — 28 tests over the only code that mutates a simulation document: selection, camera, expansion, undo/redo, branch collapsing, assumption previews, the dossier cache, comparison, and the import/export round trip.
- **Dossier test suite** — 12 tests over construction, determinism, metric ordering, and the honesty of the prose.
- **Variable registry test suite** — guards against duplicate variable keys, which produced duplicate React keys on every load.

### Changed

- **Plain language everywhere.** "Steps", not "nodes". "Paths", not "branches". "Connections", not "edges". "Looking ahead 3 years", not "Horizon 36 months". "Balanced reach", not "imagination 45%". "Month 6", not "t = 6 mo". The right-hand panel is called "What this is" and leads with a plain-English explanation of the kind of thing you clicked.
- The graph legend is now a single source of truth (`src/core/graphLegend.ts`) shared by the canvas, the key and the inspector, so a symbol cannot mean two things.
- The tour no longer runs by itself. The introduction card is the first-run experience and offers the walkthrough.
- The status bar no longer overstates the number of paths: the starting point sits on a branch of its own, and a raw branch count was always one too many.
- The engine's explanation of a step no longer leads with an internal rule id in the dossier, and no longer says "at Now" for a decision.

### Fixed

- **A duplicated variable in the registry.** `information` was declared twice, which produced duplicate React keys and a warning on every load.
- **A new universe opened with an empty path.** The path was only derived when a saved focus node was restored, so a fresh universe showed a selected starting point with nothing behind it.
- **The toast timer required a browser.** It now schedules through whichever timer is available, which also made the store testable outside a renderer.
- The graph canvas now labels each branch with its name and marks where you are, instead of leaving you to work out which path is which.

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
