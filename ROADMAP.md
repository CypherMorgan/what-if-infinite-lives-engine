# Roadmap

What If? is a local-first desktop app for exploring plausible alternative
lives. This is what has been built, what is being built, and what is being
deliberately left alone.

The guiding rule, in priority order:

1. **Never fake it.** No invented numbers, no placeholder charts, no buttons
   that do nothing. If the model has nothing to say, the app says so.
2. **The model is a model.** It is labelled as such everywhere. "Model spread"
   is engine variance, never a probability of anything happening to you.
3. **A newcomer must be able to use it.** If a person who has never seen the
   app cannot tell what they are looking at, the app is not finished, however
   many features it has.
4. **Local first.** Everything works offline, with no account, no key, no
   telemetry. The network is optional and only used if you point it at a
   provider yourself.

---

## Shipped

### v1.0.0 — the engine

- Deterministic, seeded simulation engine over a typed variable and state
  system. The same prompt and seed always produce the same universe.
- Branching graph with a hand-written layered layout, Canvas 2D renderer,
  minimap, search, branch collapsing, keyboard navigation.
- Counterfactuals: change any assumption or choose a decision option to fork
  a new universe, with full lineage, snapshots, diffs and stability analysis.
- Evidence model: every claim is tagged `user-fact`, `research`, `assumption`
  or `speculation`.
- Versioned local persistence with migrations, atomic writes, validated
  import/export, and a library index.
- Optional OpenAI-compatible provider, with the credential held in the main
  process and never written to disk in plain text.

### v1.0.1 — the launch

- Fixed the crash that stopped the installed app from starting: a `?` in the
  product name produced a `userData` path Windows refuses, and Chromium
  aborted before a window appeared. Guarded in CI.
- Single release per tag, with all four assets attached to it.
- Icon, artifact-name and screenshot integrity checks in CI.

### v1.1.0 — making it legible

The release that turned a capable tool into one a person can actually use.

- **The graph got a vocabulary.** One source of truth (`src/core/graphLegend.ts`)
  describing every shape, every colour, which way time flows, and what each
  kind of step _means_ — in plain words, not in the language of the codebase.
- **A key, not a legend.** An on-screen panel that explains the symbols,
  the colours, the direction of time, and how to read a card. Open by default.
- **An introduction, not a tutorial.** A first-run card that explains the app
  in a paragraph, with a walkthrough available on demand rather than fired at
  you unbidden.
- **Plain language everywhere.** "Steps", not "nodes". "Paths", not
  "branches". "Connections", not "edges". "Looking ahead 3 years", not
  "Horizon 36 months". "Balanced reach", not "imagination 45%".
- **The future dossier.** A readable brief on any path: where it leads, what
  it buys, what it costs, what could go wrong, how the model got there, what
  it rests on, and how much the model is allowed to wobble. Every figure in it
  is computed by the engine.
- **Real sensitivity.** Assumption influence is now measured by perturbing the
  input and re-projecting the universe, not estimated.
- **A working update channel.** A user-initiated check of the GitHub releases
  API, dependency-free, with no silent install.
- **A working provider.** The credential never crosses the bridge, and the
  request is made where the credential can be attached.
- **A real test suite** over the engine, the counterfactual machinery, the
  update channel, the variable registry, the dossier and the store.

---

## Being built

### v1.2.0 — reach and report

Two of the four are done and waiting on the next release:

- **A visual branch diff.** ✓ Done. Two paths side by side, the point where
  they diverge, and what changes from there — compared at a common moment, so
  the difference is in the path and not in the timing.
- **Accessibility pass.** ✓ Done. Keyboard reachability for every control,
  focus that moves into a dialog and comes back out of it, a live status
  line, one `h1` and no skipped heading levels, a canvas that describes
  itself, and a contrast check on the palette.
- **PDF export.** The Markdown path report becomes a document somebody can
  print and share: the dossier, the timeline, and the graph itself.
- **A printable dossier.** The same brief as the view, laid out for paper.

### v1.3.0 — depth

- **Comparable universes.** Put two forks of the same decision side by side,
  with the assumptions that differ between them called out.
- **Scenario templates.** Starting points for the questions people actually
  ask — the job offer, the move, the child, the pivot.
- **Session notes.** A written record of what you concluded, kept alongside
  the universe.
- **A rule-pack format people can write.** The engine's rules are the honest
  core of the app; making them authorable is the single biggest increase in
  what it can say.

---

## Deliberately not planned

- **Accounts, sync, and a server.** The app is local-first on purpose. A
  backend would be a different product.
- **Telemetry or crash reporting.** Nothing leaves the machine.
- **Predictions.** The app models consequences from stated inputs. It does not
  claim to know what will happen to you, and the wording is checked to keep it
  that way.
- **An infinite generator.** The engine simulates a bounded horizon because
  unbounded extrapolation would be guessing with extra steps.

---

## Principles for changes

Every change to this project should pass these, in order.

1. **Is the number real?** If a figure cannot be traced to a computation in
   the engine, it does not ship.
2. **Would a newcomer understand it?** New vocabulary needs a plain-language
   definition in the same place it is used.
3. **Does it work offline?** A feature that needs the network must work
   without it.
4. **Is it tested?** The engine, the store and the format all have suites. A
   change that cannot be tested is a change that needs a better design.
5. **Is it committed?** One logical change, one conventional commit, on a
   branch that builds and passes.
