# Writing a rule pack

A rule pack adds your own events, opportunities, setbacks and milestones to the
offline engine. Packs are data. They are never executed, they cannot fetch
anything, and they cannot change the app's code. The engine that runs the
built-in rules runs yours.

This document is the format, the limits, and the honest boundaries of what a
pack can say. The canonical implementation is `src/core/customPacks.ts`; the
built-in catalogue it sits beside is `src/core/packs/`.

---

## 1. Install and remove

Open **Settings → Rule packs** and choose a `.whatif-pack.json` file. The pack is
validated before it is accepted. If anything is wrong, the dialog lists every
problem it found and installs nothing.

Installed packs are saved on this machine, beside the library. They are listed
in the same section with their id and rule count, and **Remove** deletes one.
The built-in catalogue is always active and is not listed; it cannot be
removed.

A new pack applies to universes you create, fork, expand or reroll after it is
installed. It does not rewrite the past: steps that already exist keep the
state they were given. Re-expanding a node does use the newly installed rules.

The limit is **10 installed packs**, **100 rules per pack**, and **300 custom
rules in total**. The app checks the total when a pack is loaded.

Packs are local to the machine. They are **not** embedded in a
`.whatif.json` universe export, and they are not shared with another install.
A universe exported while a pack was active still opens elsewhere, but that
machine expands it with its own catalogue — the built-in rules, plus whatever
packs are installed there. If you want a step that came from a pack to remain
reproducible on another machine, export the universe (the steps and their
numbers are in the file) and give the recipient the pack file as well.

---

## 2. The file

A pack file is a JSON object with a small envelope, so a reader can tell at a
glance what the file is:

```json
{
  "format": "whatif.rulepack",
  "formatVersion": 1,
  "pack": {
    "id": "custom.example",
    "name": "The example pack",
    "description": "One sentence about what these rules add.",
    "rules": []
  }
}
```

| Field              | Required | Meaning                                                           |
| ------------------ | -------- | ----------------------------------------------------------------- |
| `format`           | yes      | Exactly `whatif.rulepack`.                                        |
| `formatVersion`    | yes      | Exactly `1`. A future version is rejected rather than guessed at. |
| `pack.id`          | yes      | Starts with `custom.` — for example `custom.sabbatical`.          |
| `pack.name`        | yes      | Shown in Settings. Up to 80 characters.                           |
| `pack.description` | yes      | What the pack is for. Up to 600 characters.                       |
| `pack.rules`       | yes      | At least one rule.                                                |

Every rule id must start with the pack id followed by a dot
(`custom.sabbatical.unpaid-trial`). That prefix makes the origin of a rule
obvious in the inspector and prevents two packs from colliding silently.

Unknown fields are rejected. A misspelled `effects` would otherwise produce a
rule that looks installed but never changes anything.

---

## 3. A rule

```json
{
  "id": "custom.example.a-month-off",
  "label": "A month off, unpaid",
  "summary": "You take four weeks away from work to test the idea properly.",
  "detail": "Optional longer explanation shown in the inspector.",
  "type": "opportunity",
  "requires": ["career"],
  "when": { "all": [{ "key": "runway", "op": ">=", "value": 3 }] },
  "weight": 7,
  "monthsMin": 2,
  "monthsMax": 18,
  "durationMonths": 1,
  "once": true,
  "imagination": 0.2,
  "effects": [
    {
      "key": "money",
      "op": "add",
      "value": -1200,
      "reason": "one month of living costs with no income"
    },
    {
      "key": "information",
      "op": "add",
      "value": 9,
      "reason": "a month of evidence instead of speculation"
    }
  ],
  "assumptions": ["Modelled at one month of costs, 1,200."],
  "uncertainties": ["A good month is not the same as a good year."],
  "evidence": [
    {
      "cls": "assumption",
      "text": "The cost is a stated modelling choice, not a measured outcome."
    }
  ],
  "tradeoffs": {
    "gains": ["Evidence before a permanent commitment."],
    "costs": ["One month of income."]
  },
  "nextSteps": ["Decide what evidence would make you continue."],
  "failurePoints": ["Treating the month as a holiday."]
}
```

### Required fields

| Field            | What it does                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | Unique. Must start with `<pack.id>.` and use `a-z`, `0-9`, `.`, `_`, `-`.                                                                                        |
| `label`          | The node title. Up to 140 characters.                                                                                                                            |
| `summary`        | The short explanation shown on the node. Up to 700 characters.                                                                                                   |
| `type`           | `decision`, `event`, `opportunity`, `setback`, `milestone`, `consequence`, `alternative` or `ending`.                                                            |
| `requires`       | At least one archetype id: `education`, `learning`, `career`, `business`, `relocation`, `creative`, `finance`, `health`, `relationships`, `time`, `uncertainty`. |
| `weight`         | Relative chance among eligible rules, from `0.01` to `100`. Higher is more frequent.                                                                             |
| `monthsMin`      | Earliest month in the horizon this rule can appear, `0`–`240`.                                                                                                   |
| `monthsMax`      | Latest month, `0`–`240`, not before `monthsMin`.                                                                                                                 |
| `durationMonths` | How long the resulting state lasts, `0`–`36` months.                                                                                                             |
| `effects`        | At least one change, at most 12. See below.                                                                                                                      |
| `evidence`       | At least one tag, at most 6. See below.                                                                                                                          |

### Optional fields

| Field                                                                     | What it does                                                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `detail`                                                                  | Longer text shown in the inspector. Up to 2,400 characters.                                       |
| `when`                                                                    | Conditions. Omit it, or use `{}`, for a rule that is always eligible.                             |
| `cooldown`                                                                | Months before this rule may fire again. `0`–`240`.                                                |
| `once`                                                                    | `true` means the rule can fire once per universe.                                                 |
| `imagination`                                                             | `0` grounded to `1` imaginative. It is filtered by the realism slider that is already in the app. |
| `assumptions`, `uncertainties`, `nextSteps`, `failurePoints`, `resources` | Lists of up to 12 plain strings, each up to 600 characters.                                       |
| `tradeoffs`                                                               | `{ "gains": [], "costs": [] }`, up to 8 items each.                                               |

### Conditions

`when` holds any combination of three lists:

```json
{
  "all": [{ "key": "runway", "op": ">=", "value": 3 }],
  "any": [{ "key": "stress", "op": ">", "value": 50 }],
  "none": [{ "key": "risk", "op": ">", "value": 80 }]
}
```

- `all` — every condition must hold.
- `any` — at least one condition must hold.
- `none` — none of these may hold.

An operator is one of `<`, `<=`, `>`, `>=`, `==`, `!=`. A condition names a
variable key and compares its current value. A key the app does not model is
rejected, because a condition that can never be true is worse than an error.

### Effects

Effects are applied in order, and each one sees the result of the one before
it. That is deliberate: "income falls, therefore runway shortens" is one rule
with two effects, not two rules that might run in different orders.

| `op`      | Meaning                                                                     |
| --------- | --------------------------------------------------------------------------- |
| `add`     | Add `value` to the variable.                                                |
| `set`     | Replace the variable with `value`.                                          |
| `mul`     | Multiply the variable by `value` (for example `0.9` for a ten percent cut). |
| `addFrom` | Add `from` multiplied by `scale` (default `1`) to the variable.             |

Optional **`noise`** is the relative standard deviation of the change, `0`–`1`.
It is sampled from the seeded random generator, so the universe stays
deterministic for a given seed. It is engine variance, never a probability of
anything happening to you in real life.

Optional **`clampMin`** and **`clampMax`** limit this one change before the
variable's own unit clamp is applied.

Every effect needs a **`reason`**. It is shown to the reader in the state-change
list, next to the number it caused. "Why did my money fall by 1,200?" should
never be a mystery.

### Evidence

Every rule must say how it knows what it claims. One tag:

```json
{ "cls": "assumption", "text": "The cost is a stated modelling choice." }
```

`cls` is one of `user-fact`, `research`, `assumption` or `speculation`. A
`research` tag may also carry a `source`. The four classes are rendered
differently so a grounded claim is never presented as if it were the same kind
of thing as an imaginative one. A pack cannot claim `user-fact`: it does not
know anything about you that you did not type into a universe.

---

## 4. Variable keys

A custom pack may only use a key the app already models. It cannot introduce a
new variable yet, because a key without a unit, a label and a direction would
be shown as a bare number — and a number with no meaning is exactly what this
app is trying to avoid.

The common keys are:

```
money income expenses runway goalProgress wellbeing stress optionality
risk network reputation energy focus information sleep stability
variance decisionConfidence credential portfolio projectHealth marketFit
audience healthBuffer visaSecurity
```

The skill keys are:

```
skill:business-building skill:client-work skill:communication skill:craft
skill:independence skill:professional-practice skill:remote-collaboration
skill:research skill:structured-theory
```

The full registry, with units and "which direction is good", is
`src/core/packs/vars.ts` and `src/core/packs/base.ts`. A validator test keeps
this list and the app's registry from drifting apart.

---

## 5. What a pack cannot do

These are deliberate limits, not missing features:

- **It cannot add a variable.** `pack.vars` must be empty if present. Use the
  keys above.
- **It cannot change the starting state.** `pack.startingModifiers` must be
  empty if present.
- **It cannot define a decision the engine will ask.** `decision` is part of the
  internal rule shape, but no engine path expands a rule-defined decision yet,
  so a pack that sets one is rejected rather than accepted and silently
  ignored.
- **It cannot replace or shadow a built-in rule.** Pack ids and rule ids must
  not collide with the built-in catalogue or with another installed pack.
- **It cannot run code, read files or reach the network.** Packs are parsed as
  JSON and copied into plain objects.
- **It cannot change an existing universe's past.** Installing a pack affects
  what can happen next, not what already happened.

A rule is also not a claim that the event will happen. The engine picks among
eligible rules by weight; a low-weight rule is uncommon, not impossible, and no
weight is a real-world probability.

---

## 6. A working example

[`examples/sabbatical.whatif-pack.json`](../examples/sabbatical.whatif-pack.json)
is a complete three-rule pack: an unpaid trial month, the setback that arrives
when the buffer is thin, and the milestone where the time away changes the
answer. It is ordinary input — install it from Settings exactly as you would
your own file.

The example is covered by the test suite: it must parse, its rules must be
active for the `career` archetype and inactive for unrelated ones, and the
engine must be able to build and expand a universe with it installed.

---

## 7. Writing a good rule

The rules that make the built-in catalogue useful are specific about the
mechanism, not about the moral:

- **Name the variable that moves and why.** "Stress rises because the return
  date is no longer yours" is testable. "Things get hard" is not.
- **Give the cost a number you can defend.** One month of costs at 1,200 is an
  assumption the reader can replace in their head. A round number presented as
  a measurement is not.
- **Prefer a condition to a certainty.** If a rule only makes sense when money
  is thin, say so with `runway < 3`; do not make it fire everywhere.
- **Write the evidence tag honestly.** If you made the number up as a modelling
  convenience, `assumption` is the correct class. `research` needs a source.
- **Do not write a rule that always produces the same happy ending.** A pack is
  a set of possibilities, not a script.

If a rule cannot be made specific, it is usually two rules: one for the
mechanism and one for the outcome.
