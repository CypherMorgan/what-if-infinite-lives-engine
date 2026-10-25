# The `.whatif.json` export format

A universe exported from What If? is a single JSON file with the extension
`.whatif.json`. The file is self-contained: it holds the whole simulation —
every step, every number, every note — so it can be opened on another machine,
archived, or read by something that is not this app.

The format is versioned twice over. The **envelope** carries a format version
that describes the file layout, and the **document** carries a schema version
that describes the shape of the simulation itself. The two move independently:
the envelope can change how a file is packaged without touching the model, and
the schema can change the model without changing how it is packaged.

Everything below is the actual format, not an aspiration. The canonical
implementation is `src/core/importExport.ts`, the model is `src/core/types.ts`,
and the migration chain is `src/core/migrations.ts`.

---

## 1. The envelope

```json
{
  "format": "whatif.universe",
  "formatVersion": 1,
  "schemaVersion": 4,
  "appVersion": "1.2.0",
  "exportedAt": "2026-10-21T09:14:02.118Z",
  "document": { "…": "the simulation document, see §2" },
  "checksum": "3f2a91c4"
}
```

| Field           | Type   | Meaning                                                                                                |
| --------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| `format`        | string | Always `"whatif.universe"`. A file whose `format` is anything else is treated as a bare document (§5). |
| `formatVersion` | number | The layout version of this envelope. Currently `1`.                                                    |
| `schemaVersion` | number | The schema version of the embedded document. Currently `4`.                                            |
| `appVersion`    | string | The version of the app that wrote the file, e.g. `"1.2.0"`.                                            |
| `exportedAt`    | string | ISO-8601 timestamp of the export.                                                                      |
| `document`      | object | The simulation document (§2).                                                                          |
| `checksum`      | string | FNV-1a hash of the serialised document, as eight lowercase hex digits.                                 |

The checksum is a truncation detector, not a security feature. On import the
document is re-serialised and re-hashed; if the result differs, the file was
edited by hand or cut short. The app says so in a warning and loads it anyway —
a hand-edited universe is a legitimate thing for a person to want, and
refusing it would be more annoying than helpful.

---

## 2. The document

The document is the simulation itself. Its fields:

```json
{
  "id": "s_8f3a2c1b",
  "schemaVersion": 4,
  "createdAt": "2026-10-21T09:02:44.901Z",
  "updatedAt": "2026-10-21T09:12:55.330Z",
  "title": "Bootcamp or self-study?",
  "seed": 3819422,
  "prompt": { "…": "§2.1" },
  "nodes": { "…": "§2.2" },
  "edges": { "…": "§2.3" },
  "branches": { "…": "§2.4" },
  "layout": { "…": "§2.5" },
  "vars": [ "…": "§2.6" ],
  "assumptions": [ "…": "§2.7" ],
  "collapsed": ["b2"],
  "sessionNotes": "The move only works if the rent stays under 1100. I would want three months of savings first.",
  "meta": { "…": "§2.8" },
  "parentId": "s_1d4b7e90",
  "counterfactual": { "…": "§2.9" },
  "focusNode": "n7",
  "camera": { "x": -420, "y": 88, "scale": 1.15 }
}
```

`parentId`, `counterfactual`, `focusNode` and `camera` are optional and are
absent on a universe that has never been forked or re-opened. `sessionNotes` is
always present on a schema-4 document: it is `""` until something is written.

### 2.1 `prompt` — what the person asked

```json
{
  "situation": "I have worked in support for three years…",
  "decision": "Should I take a six-month bootcamp or keep self-studying?",
  "goals": ["Become a developer", "Keep income stable"],
  "constraints": ["Mortgage payment"],
  "horizon": 24,
  "branchCount": 3,
  "imagination": 0.45,
  "resources": ["savings of 12000", "income 2400/month"],
  "archetypes": ["builder", "catalyst"],
  "title": "Bootcamp or self-study?"
}
```

`horizon` is in months. `imagination` runs from `0` (grounded analysis) to `1`
(imaginative exploration) and controls how far the engine is allowed to
extrapolate. `seed` on the document is the random seed that makes the
simulation reproducible: the same prompt and the same seed always produce the
same universe.

### 2.2 `nodes` — the steps, keyed by id

```json
{
  "n7": {
    "id": "n7",
    "type": "event",
    "title": "A quiet stretch",
    "summary": "Nothing much happens, which turns out to matter.",
    "detail": "Longer explanation shown in the inspector.",
    "t": 6,
    "horizon": "6–18 months",
    "branch": "b1",
    "depth": 2,
    "parents": ["n4"],
    "children": ["n9"],
    "assumptions": ["The current pace holds for two quarters."],
    "uncertainties": ["Whether the client renews."],
    "evidence": [
      { "cls": "user-fact", "text": "You said you have savings put aside." },
      { "cls": "assumption", "text": "Six months of runway is preserved." }
    ],
    "tradeoffs": {
      "gains": ["Focus time protected"],
      "costs": ["Six weeks of slower progress"]
    },
    "decision": {
      "question": "What do you do with the quiet stretch?",
      "options": [{ "id": "o1", "label": "Use it to study" }]
    },
    "state": { "money": 14200, "income": 3200, "runway": 11 },
    "delta": [
      {
        "key": "money",
        "before": 12000,
        "after": 14200,
        "unit": "currency",
        "reason": "Six months of living costs"
      }
    ],
    "nextSteps": ["Ask the client about the renewal"],
    "failurePoints": ["The renewal lands a quarter late."],
    "resources": ["The spare hours"],
    "expandable": true,
    "expanded": false,
    "ruleId": "career.slow-burn",
    "userNotes": "My own notes, markdown supported."
  }
}
```

`type` is one of `start`, `decision`, `event`, `opportunity`, `setback`,
`milestone`, `consequence`, `alternative`, `ending`.

`evidence[].cls` is the honesty backbone of the format. Every claim carries
one of:

| `cls`         | Means                                                  |
| ------------- | ------------------------------------------------------ |
| `user-fact`   | The person stated it. Treated as a given.              |
| `research`    | Grounded in an external reference the rule pack cites. |
| `assumption`  | A modelling assumption, stated and editable.           |
| `speculation` | Imaginative extrapolation. Clearly not a prediction.   |

`state` is a flat map of variable key to number. It is the only place numbers
are stored; every number the app displays is derived from it.

### 2.3 `edges` — the connections, keyed by id

```json
{
  "e4": {
    "id": "e4",
    "from": "n4",
    "to": "n7",
    "kind": "causal",
    "label": "because",
    "confidence": "medium",
    "hypothesis": "The quiet stretch follows the setback."
  }
}
```

`kind` is one of `causal`, `choice`, `alternative`, `consequence`.
`confidence` is `high`, `medium` or `low` and describes how strongly the causal
hypothesis is supported.

### 2.4 `branches` — the paths, keyed by id

```json
{
  "b1": {
    "id": "b1",
    "name": "The Paycheck Path",
    "hue": 190,
    "root": "n4",
    "description": "A steady job, steady money, slower movement."
  }
}
```

`hue` is in degrees and the renderer derives the whole palette from it, so a
branch keeps its colour across exports and imports.

### 2.5 `layout` — the canvas positions, keyed by node id

```json
{ "n7": { "x": 480, "y": 220 } }
```

This is cached display state. It is safe to delete: the layout is recomputed
from the graph when it is missing.

### 2.6 `vars` — the variable registry

```json
[
  {
    "key": "money",
    "label": "Liquid funds",
    "unit": "currency",
    "kind": "resource",
    "direction": "up",
    "domain": "financial",
    "primary": true,
    "hint": "What you could spend without touching income."
  }
]
```

`unit` is one of `currency`, `months`, `percent`, `count`, `level`, `index`.
`direction` says which way is good: `up`, `down` or `neutral`. `primary: true`
marks the variables the app shows by default.

### 2.7 `assumptions` — the editable inputs

```json
[
  {
    "id": "a1",
    "label": "Current savings",
    "varKey": "money",
    "unit": "currency",
    "baseValue": 12000,
    "value": 12000,
    "rationale": "Taken from what you told us.",
    "sensitivity": 0.42,
    "editable": true
  }
]
```

`sensitivity` is a model-derived 0–1 score of how much this input influences
the headline outcomes. It is recomputed on every save by nudging the input up
and down by 25% and re-projecting the universe; it is not a hand-written
number.

### 2.8 `meta` — where the universe came from

```json
{
  "generator": "offline",
  "providerLabel": "built-in engine",
  "modelLabel": "…",
  "provenance": "Generated offline by the built-in rules engine."
}
```

`generator` is `offline` or `ai`. When it is `ai`, `providerLabel` and
`modelLabel` name the provider that was used. No credentials are ever stored
in the document.

### 2.9 `counterfactual` — what changed to make this universe

```json
{
  "target": "Current savings",
  "fromValue": "12000",
  "toValue": "18000",
  "note": "Assumption changed: Current savings",
  "createdAt": "2026-10-21T09:11:02.774Z"
}
```

Present only on a universe that was forked from another one. `parentId` on the
document points back at its origin.

---

### 2.10 `sessionNotes` — what you concluded

A plain string holding the person's own notes for the whole universe, not for a
single step. It is free text: line breaks are preserved, it is never rendered
as Markdown, and it is escaped wherever it is printed. It is included in the
PDF report and the Markdown path export, under **Session notes**.

```json
{
  "sessionNotes": "The move only works if the rent stays under 1100.\nI would want three months of savings first."
}
```

The field is capped at 20,000 characters on save and on import, the same limit
as every other user-authored string. A saved universe keeps its notes when it is
exported, imported, re-opened or restored from an autosave; forks and rerolls
start with empty notes because they are new documents.

---

## 3. Schema versions and migrations

`schemaVersion` describes the model. It is currently **4**.

| From | To  | What changed                                                                                                                                   |
| ---- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 2   | Added `collapsed`, the `vars` registry, and the `primary` flag on variable definitions.                                                        |
| 2    | 3   | Added `focusNode`, `camera` and per-node `ruleId`; normalised `prompt.archetypes`, which older builds sometimes left as a comma-joined string. |
| 3    | 4   | Added `sessionNotes`, the person's own record of what they concluded. Older documents get an empty string rather than invented text.           |

On import, a document is walked forward one step at a time by
`src/core/migrations.ts`. Each step is a pure function of the previous shape
and is unit-tested.

Migrations are deliberately permissive about missing data. A field that does
not exist gets a sensible default rather than an error, because refusing to
open somebody's saved universe over an optional field is worse than opening it
with a default. A document that arrives with no `schemaVersion` at all is
treated as version 1.

---

## 4. Validation, repair and limits

After migration the document is validated by `src/core/validate.ts`, and then
its derived structure is repaired by `src/core/graph.ts`.

- **Fatal problems** reject the import with a message naming the field at
  fault. A file is rejected when it is not a JSON object, when it has no
  document id, when its `nodes` or `edges` maps are missing or are not
  objects, when it holds more than 5,000 nodes or 20,000 edges, or when it
  does not contain exactly one starting node.
- **Recoverable problems** are repaired and the import continues. Dangling
  edges, unreachable nodes, inconsistent parent/child lists and collapsed
  branches that no longer exist are all fixed, and the repair is reported to
  the user as a note.
- **Cosmetic problems** are normalised without comment. Strings longer than
  20,000 characters are truncated, arrays longer than 400 entries are cut, and
  unexpected primitive types are coerced to the closest sensible value.

Limits:

| Limit                       | Value             |
| --------------------------- | ----------------- |
| Maximum file size           | 32 MB             |
| Maximum nodes in a document | 5,000             |
| Maximum edges in a document | 20,000            |
| Maximum string length       | 20,000 characters |
| Maximum array length        | 400 entries       |

The import reports three kinds of feedback, and the app shows all of them:
**notes** (migrations applied, repairs made), **warnings** (the checksum did
not match, the file came from a newer build, some items were malformed), and
**errors** (the import was refused).

---

## 5. Importing by hand

A file that is a bare document — the object in §2 with no envelope around it —
is accepted. The app adds a warning that no envelope was found and loads the
document anyway. This is what makes a universe readable and editable in any
text editor, and it means a hand-written universe is a supported thing to
make.

The minimum a file needs is a `nodes` map. Everything else has a default.

---

## 6. Other things the app can export

The `.whatif.json` file is the complete form. The app can also produce:

- **A Markdown path report** — a readable document for one path, led by the
  future dossier: where the path leads, what it buys, what it costs, what
  could go wrong, and how much the model can wobble. Exported from the node
  inspector.
- **A PDF path report** — the same material as the Markdown report, laid out
  for paper rather than for a screen. See §6.1.
- **A PNG of the graph canvas** — the picture of the universe as it stands.
- **The library index** — a small list of saved universes, used by the app's
  own library screen. It is not meant to be shared.

### 6.1 The PDF path report

A PDF is not a format the app owns — it is what Chromium's print pipeline
produces — but the document that goes into it is fixed, and worth describing.

**The report.** One path, from the step you are standing on back to where
every path begins. In order:

1. **The masthead** — the app, the universe's title, the step, the path it
   belongs to, and the date the report was made.
2. **The situation** — the prompt the universe was built from: where you
   are, the decision, what you want, what you are bound by, what you have to
   work with, and how far ahead the model looks.
3. **The map** — the whole universe as parallel timelines: one row per path,
   one shared time axis, time running left to right. The path the report is
   about is drawn in blue and its steps are numbered, and the same numbers
   are used in the list below, so the picture and the text cannot drift
   apart. It is drawn as a diagram rather than as a copy of the canvas
   because the canvas is taller than a page.
4. **The brief** — the future dossier: the headline, the confidence in it,
   every variable the model moved, how much the headline number could wobble,
   what it buys, what it costs, what could go wrong, how the model got there,
   and what happens next.
5. **The path, step by step** — every step in order: what happened, what it
   cost and bought, what changed in the model and why, what happens next,
   where it could go wrong, and your own notes.
6. **What it rests on** — the assumptions the universe was built on, each one
   with the value it was given and the value it started from.
7. **The colophon** — the reminder that this is a model rather than a
   prophecy, where the universe came from, and which version of the app made
   the report.

**The rules.** The report obeys the same rules as the rest of the app.

- **Every figure is computed.** Nothing in it is typed by hand, and there
  are no charts of invented data. Where the model has nothing to say, the
  report says that too.
- **It is one file.** The document carries its own styles and its own
  diagram; it fetches nothing from anywhere and embeds no fonts.
- **Nothing you typed can become markup.** Every piece of text that came
  from you — the universe title, the situation, your notes on a step, the
  name of a path — is escaped before it goes into the document. A note
  reading `<img onerror=...>` appears in the report as the characters you
  typed.
- **It cannot reach the network.** The document's own content security
  policy forbids every kind of it, and the window that prints it has no
  scripting, no Node and no preload. The desktop shell additionally refuses
  a document that contains a script tag outright.

**Where it comes from.** `src/core/pdfReport.ts` builds the document from a
simulation document and a step; it is pure, deterministic and has no
knowledge of Electron. The desktop shell prints it through a hidden window
(`pdf:export` in `electron/main.ts`); a browser, which has no such thing,
opens it in a new window and lets the browser's own print dialog save it.

---

## 7. What is not in the file

- **No credentials.** A provider API key is encrypted by the operating system
  in the main process and is never written into a document, an export, or
  renderer storage.
- **No telemetry.** Nothing in the file says who made it, where, or when it
  was opened.
- **No network references.** A document is complete on its own. A universe
  written with an AI provider still opens on a machine with no network
  access, and the prose it contains is preserved verbatim.
- **No installed rule packs.** A pack is a local extension of the catalogue,
  not part of any one universe. Steps that a pack produced are in the file
  with the rule id that made them, so the history stays readable; the pack
  itself is not. Importing the universe on another machine and expanding it
  there uses that machine's catalogue — the built-in rules, plus whichever
  packs are installed. Hand over the `.whatif-pack.json` separately if the
  next person needs the same rules.

---

## 8. Stability promise

The envelope (`format: "whatif.universe"`, `formatVersion: 1`) is stable: a
file written by any 1.x build will be read by every later 1.x build.

The document schema is versioned and migrated, not frozen. A build always
reads the schema versions it knows how to migrate from, and refuses — with a
clear message — a document whose `schemaVersion` it cannot walk forward. A
newer `formatVersion` is loaded on a best-effort basis with a warning rather
than being refused outright.

The rule is simple: **the app will always try to open the universes you have
saved, and it will always tell you plainly when it could not.**
