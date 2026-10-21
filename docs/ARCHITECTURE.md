# Architecture & Decisions — What If? The Infinite Lives Engine

This document records the significant engineering decisions, what was considered, and why
the final choice was made. It is deliberately blunt about trade-offs and limitations.

## 0. Environment findings (measured, not assumed)

| Probe             | Result                                        |
| ----------------- | --------------------------------------------- |
| OS                | Windows x64                                   |
| Node.js           | v26.8.1                                       |
| npm               | 11.19.0 (registry reachable, HTTP 200)        |
| Python            | 3.11.9, pip 26.2.1 (PyPI reachable, HTTP 200) |
| GitHub            | reachable (HTTP 200)                          |
| `rustc` / `cargo` | **absent**                                    |
| `gcc` / `g++`     | **absent**                                    |
| .NET SDK          | **absent**                                    |
| git               | 2.52.0                                        |

The absence of any C/C++ toolchain and of the .NET SDK is decisive. It removes
C++/Qt, C#/WinUI, and Rust/Tauri from serious contention: Tauri and native Node
addons would both require installing a multi-gigabyte build toolchain and carry a real
risk of an unbuildable, unpackageable deliverable.

## 1. Stack decision

**Chosen: Electron 44 + TypeScript 5.9 + React 19 + Vite 7, with a hand-written Canvas2D
graph renderer, packaged by electron-builder 26 (NSIS installer + portable .exe).**

Rationale:

1. **It is the only stack here that produces a genuine Windows executable end-to-end with
   zero missing prerequisites.** Everything needed is already installed and verified.
2. **Visual ceiling.** The brief demands a distinctive, cinematic, animated interface. The
   web rendering pipeline (Canvas2D + CSS compositing + SVG) gives precise control over
   glow, gradients, curves, and animation that would take far longer to reach in QML or WPF.
3. **I can actually see and iterate on the UI.** This environment exposes browser preview
   tooling; a web renderer can be inspected visually during development rather than built blind.
4. **The renderer is not Electron-coupled.** `src/core`, `src/ai` and `src/render` are plain
   TypeScript with no `electron` import, so the same code runs in a plain browser and is
   unit-testable under Node.

Options rejected and why:

| Option                            | Verdict                                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C++ / Qt 6                        | No compiler on the machine; would require installing Qt + MSVC or MinGW first. Highest risk of shipping nothing.                                                 |
| C# / WinUI 3 or WPF               | No .NET SDK present.                                                                                                                                             |
| Rust / Tauri                      | No Rust toolchain; Tauri also needs the MSVC linker.                                                                                                             |
| Python / PySide6                  | Installs cleanly, but the animation/visual fidelity ceiling for an "impossible" UI is meaningfully lower and PyInstaller packaging adds fragility.               |
| Python simulation core + JS shell | Rejected as gratuitous: a second runtime, an IPC bridge, and two packaging stories for no accuracy gain. The model is arithmetic + rules, not numerically heavy. |

**Consequence to be honest about:** Electron ships a Chromium runtime, so the installer is
~90–110 MB and an installed app uses a few hundred MB of RAM. That is the price of the
guaranteed buildability and visual fidelity. Documented in the README.

## 2. Persistence decision

**Chosen: versioned JSON documents with atomic writes, a write-ahead `*.tmp` + rename
commit, per-document schema versions and an explicit migration chain — stored under the
Electron `userData` directory. Plus a JSON export/import format.**

Considered and rejected:

- **`better-sqlite3`** — the natural SQLite choice, but it is a native module. Without MSVC
  or a C++ toolchain it can only be used via prebuilt binaries, which pin an exact
  Electron ABI and break on every Electron upgrade. That is an unacceptable build risk.
- **`sql.js` (SQLite compiled to WASM)** — no native build, but it keeps the whole database
  in memory and requires the application to hand-persist the image after every write. It
  adds a persistence layer on top of a persistence layer for zero benefit: a simulation
  document is read and written whole, not queried relationally.
- **`node:sqlite`** — available in Node 24+, but it is still behind an experimental flag on
  some Electron builds and would silently break the browser-preview parity the app relies on.

The data model is document-shaped (a simulation is loaded, mutated and saved as a unit), so a
document store is the correct shape, not a compromise. Imported files are schema-validated
before they are allowed to touch the store, and size-limited.

## 3. AI architecture

- A single `ScenarioProvider` interface with three real implementations:
  1. **Offline rules-based engine** (default, always available, no network).
  2. **OpenAI-compatible cloud endpoint** (OpenAI, OpenRouter, Groq, Azure-compatible, …).
  3. **Local OpenAI-compatible server** (Ollama, LM Studio, llama.cpp server) — base URL, no key.
- **All network calls happen in the Electron main process.** The renderer never holds an API
  key and never talks to a provider directly; it sends an intent over IPC. This means a
  compromised renderer (e.g. injected content) cannot read the credential.
- API keys are encrypted at rest with Electron `safeStorage` (Windows DPAPI, per-user).
  If `safeStorage` is unavailable the app refuses to _persist_ the key and falls back to
  session-only memory, rather than writing plaintext to disk.
- Every model response is parsed and structurally validated. Malformed JSON, wrong types,
  dangling edge references, duplicate ids, over-long fields and oversized payloads are all
  rejected with a typed error, and the caller degrades to a rules-based partial result
  rather than crashing.

## 4. Simulation model

A rule pack is data, not code branches:

- `VarDef[]` — the variable registry (unit, domain, direction-is-good, format).
- `StateVector` — a flat `Record<string, number>`, so state is diffable and serialisable.
- `Rule[]` — `when` conditions over state, `effects` on state, plus narrative metadata,
  assumptions, uncertainties and evidence class.
- `simulate()` is a pure function of `(pack, initial state, choices, seed)`.

Branches are produced by layered traversal: each step selects among _eligible_ rules by
seeded weighted sampling, applies the effects, and may open a new decision point. Because
selection is seeded, **a simulation is exactly reproducible from its seed** — asserted by test.

Monte Carlo is used only for the explicitly-labelled "outcome spread" readout, where a
distribution must be supplied by the rule pack. Spread is always presented as
"model spread under these stated assumptions", never as a probability of a real-world outcome.

## 5. Graph rendering

Hand-written Canvas2D renderer, not a graph library.

- The research pass confirmed the standard advice: render outside React, batch per style,
  use `Path2D`, handle DPR explicitly, and do not bother with viewport culling below a few
  thousand nodes unless it is backed by a spatial index.
- Layout is a hand-written layered (Sugiyama-lite) pass: rank by depth, order within rank to
  reduce crossings, then resolve overlap. Description tree layout, not a generic DAG engine —
  a decision tree reconverges and has back-edges, which is precisely where dagre/ELK get
  awkward, and ELK is EPL-2.0 rather than MIT.
- Accessibility: the canvas is `role="img"` and is mirrored by a real DOM tree
  (`role="tree"`/`role="treeitem"` with `aria-level`/`aria-expanded`), so the graph is
  keyboard- and screen-reader-navigable. Reduced motion gates the rAF animation loop, not
  just CSS.

## 6. Testing

Vitest over `src/core` and `src/ai` — pure modules with no Electron or DOM dependency. The
suite covers graph integrity, transition determinism, branch expansion, assumption edits,
counterfactual diffing, serialisation round-trips, import validation, schema migration and
malformed-AI-response handling.
