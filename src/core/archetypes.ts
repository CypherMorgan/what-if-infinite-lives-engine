/**
 * Archetype detection and branch generation.
 *
 * The offline generator is not a Mad Libs template. It works in two stages:
 *
 *  1. Detect which "archetypes" the user's situation resembles (education, relocation,
 *     starting a business, ...) by scoring keywords in their own words.
 *  2. Each archetype contributes (a) a set of genuinely distinct branch options, and
 *     (b) a rule pack of things that plausibly happen on that kind of path.
 *
 * The result is that different situations produce structurally different universes, and that
 * the choices offered are the real choices that situation implies — not generic filler.
 */
import type { Effect } from './rulePack';

export interface Archetype {
  id: string;
  name: string;
  /** Keywords that indicate this archetype. Weighted by specificity. */
  keywords: string[];
}

export const ARCHETYPES: Archetype[] = [
  {
    id: 'education',
    name: 'Formal education',
    keywords: [
      'university',
      'degree',
      'college',
      'bachelor',
      'master',
      'phd',
      'study',
      'studies',
      'student',
      'school',
      'course',
      'tuition',
      'scholarship',
      'exam',
      'academic',
      'major',
      'campus',
      'diploma',
      'qualification',
    ],
  },
  {
    id: 'learning',
    name: 'Self-directed learning',
    keywords: [
      'learn',
      'learning',
      'self-taught',
      'self taught',
      'tutorial',
      'practice',
      'skills',
      'portfolio',
      'bootcamp',
      'certification',
      'online course',
      'practise',
      'practicing',
      'roadmap',
    ],
  },
  {
    id: 'career',
    name: 'Employment and career',
    keywords: [
      'job',
      'career',
      'employ',
      'salary',
      'hire',
      'hired',
      'promotion',
      'manager',
      'company',
      'internship',
      'interview',
      'freelance',
      'contract',
      'resign',
      'quit',
      'work',
      '9-5',
      'position',
      'recruiter',
    ],
  },
  {
    id: 'business',
    name: 'Venture and business',
    keywords: [
      'business',
      'startup',
      'start-up',
      'founder',
      'found',
      'entrepreneur',
      'venture',
      'company',
      'revenue',
      'customers',
      'clients',
      'profit',
      'saas',
      'agency',
      'product',
      'investors',
      'market',
      'sell',
      'launch',
    ],
  },
  {
    id: 'relocation',
    name: 'Relocation and migration',
    keywords: [
      'move',
      'moving',
      'abroad',
      'emigrate',
      'immigrate',
      'relocate',
      'relocation',
      'visa',
      'overseas',
      'country',
      'city',
      'apartment',
      'rent',
      'flights',
      'expat',
      'different country',
      'away from',
    ],
  },
  {
    id: 'creative',
    name: 'Creative and independent work',
    keywords: [
      'artist',
      'art',
      'music',
      'write',
      'writing',
      'novel',
      'youtube',
      'content',
      'creator',
      'audience',
      'stream',
      'design',
      'film',
      'game',
      'portfolio',
      'publish',
      'photography',
    ],
  },
  {
    id: 'finance',
    name: 'Money and risk',
    keywords: [
      'money',
      'savings',
      'save',
      'debt',
      'loan',
      'invest',
      'investment',
      'budget',
      'afford',
      'expenses',
      'income',
      'cost',
      'financial',
      'savings',
      'rent',
      'bills',
      'salary',
    ],
  },
  {
    id: 'health',
    name: 'Health and energy',
    keywords: [
      'health',
      'sleep',
      'tired',
      'burnout',
      'burned out',
      'burned-out',
      'gym',
      'exercise',
      'therapy',
      'illness',
      'anxiety',
      'stress',
      'energy',
      'injury',
      'recovery',
      'disabled',
    ],
  },
  {
    id: 'relationships',
    name: 'Relationships and family',
    keywords: [
      'partner',
      'spouse',
      'wife',
      'husband',
      'girlfriend',
      'boyfriend',
      'family',
      'children',
      'kids',
      'marriage',
      'parents',
      'relationship',
      'friend',
      'friends',
      'care',
      'caregiving',
      'divorce',
    ],
  },
  {
    id: 'time',
    name: 'Time and capacity',
    keywords: [
      'hours',
      'time',
      'part-time',
      'part time',
      'full-time',
      'full time',
      'commitment',
      'busy',
      'juggle',
      'balance',
      'weekend',
      'evenings',
      'schedule',
      'capacity',
    ],
  },
  {
    id: 'uncertainty',
    name: 'Exploration and uncertainty',
    keywords: [
      'unsure',
      'uncertain',
      'not sure',
      'explore',
      'experiment',
      'try',
      'figure out',
      'options',
      'unsure',
      'confused',
      'lost',
      'decide',
      'deciding',
    ],
  },
];

/** Scores each archetype against the prompt text; returns ids ordered by confidence. */
export function detectArchetypes(text: string): string[] {
  const hay = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ')} `;
  const scored: { id: string; score: number }[] = [];
  for (const a of ARCHETYPES) {
    let score = 0;
    for (const kw of a.keywords) {
      // Multi-word keywords are more specific, so they count for more.
      const weight = kw.includes(' ') ? 2.5 : 1;
      if (hay.includes(` ${kw} `) || hay.includes(`${kw} `)) score += weight;
    }
    if (score > 0) scored.push({ id: a.id, score });
  }
  scored.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
  const ids = scored.map((s) => s.id);
  // Always include a couple of broadly useful archetypes so there is a real pool of events.
  if (!ids.includes('time')) ids.push('time');
  if (!ids.includes('finance')) ids.push('finance');
  return ids.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Branch options — the top-level choices the user actually faces.
// ---------------------------------------------------------------------------

export interface BranchOption {
  id: string;
  /** Short label shown on the branch. */
  label: string;
  /** The full name of the branch/path. */
  name: string;
  /** What choosing this means, in one sentence. */
  intent: string;
  /** Seeded state changes for taking this route. */
  effects: Effect[];
  /** Baseline hue for the branch colour. */
  hue: number;
  /** Extra archetypes this route activates. */
  archetypes: string[];
  /** Relative likelihood the engine assigns to favourable vs unfavourable events. */
  riskBias: number;
}

const MONTH = (n: number): number => n;

const money = (v: number, reason: string): Effect => ({
  key: 'money',
  op: 'add',
  value: v,
  reason,
});

const income = (v: number, reason: string): Effect => ({
  key: 'income',
  op: 'add',
  value: v,
  reason,
});

const expenses = (v: number, reason: string): Effect => ({
  key: 'expenses',
  op: 'add',
  value: v,
  reason,
});

const skill = (name: string, v: number, reason: string): Effect => ({
  key: `skill:${name}`,
  op: 'add',
  value: v,
  reason,
});

const level = (key: string, v: number, reason: string): Effect => ({
  key,
  op: 'add',
  value: v,
  reason,
});

/** Looks up a branch option by its stable id, for counterfactual decision switches. */
export function optionById(id: string): BranchOption | undefined {
  for (const list of Object.values(ARCHETYPE_OPTIONS)) {
    const found = list.find((o) => o.id === id);
    if (found) return found;
  }
  return FALLBACK_OPTIONS.find((o) => o.id === id);
}

/**
 * Options contributed by each archetype. The engine picks a spread across the active
 * archetypes so the offered choices reflect the actual decision in front of the user.
 */
export const ARCHETYPE_OPTIONS: Record<string, BranchOption[]> = {
  education: [
    {
      id: 'opt-degree-full',
      label: 'Full-time degree',
      name: 'The Campus Path',
      intent: 'Enrol full-time and treat study as the primary occupation for the next stretch.',
      effects: [
        expenses(900, 'tuition and materials each month'),
        income(-1200, 'income given up to study full-time'),
        skill('structured-theory', 14, 'formal coursework'),
        level('credential', 28, 'qualification in progress'),
        level('optionality', 6, 'a recognised credential opens doors'),
        level('stress', 8, 'exam pressure'),
      ],
      hue: 205,
      archetypes: ['education'],
      riskBias: 0,
    },
    {
      id: 'opt-degree-part',
      label: 'Part-time study',
      name: 'The Slow Burn Degree',
      intent: 'Keep earning while studying part-time and stretch the timeline.',
      effects: [
        expenses(350, 'part-time tuition'),
        skill('structured-theory', 8, 'part-time coursework'),
        level('credential', 16, 'qualification in progress'),
        level('stress', 12, 'juggling work and study'),
        level('optionality', 4, 'a slower but cheaper credential'),
      ],
      hue: 215,
      archetypes: ['education', 'time'],
      riskBias: 0,
    },
  ],
  learning: [
    {
      id: 'opt-selfbuild',
      label: 'Build a portfolio',
      name: 'The Proof-of-Work Path',
      intent: 'Learn by shipping public work instead of collecting credentials.',
      effects: [
        skill('craft', 18, 'deliberate daily practice'),
        level('portfolio', 22, 'visible shipped work'),
        money(-150, 'tools and hosting'),
        level('optionality', 8, 'a portfolio is legible to employers and clients'),
        level('stress', 4, 'self-directed pace'),
      ],
      hue: 168,
      archetypes: ['learning', 'creative'],
      riskBias: 0.15,
    },
    {
      id: 'opt-bootcamp',
      label: 'Intensive bootcamp',
      name: 'The Compressed Sprint',
      intent: 'Trade a concentrated block of money and time for a fast skill jump.',
      effects: [
        expenses(1400, 'bootcamp fees amortised'),
        skill('craft', 22, 'immersive instruction'),
        level('stress', 16, 'intense schedule'),
        level('credential', 10, 'industry-recognised certificate'),
        money(-2000, 'upfront deposit'),
      ],
      hue: 186,
      archetypes: ['learning', 'education'],
      riskBias: -0.05,
    },
  ],
  career: [
    {
      id: 'opt-employ',
      label: 'Take a steady job',
      name: 'The Paycheck Path',
      intent: 'Take the reliable role and build from a stable base.',
      effects: [
        income(2100, 'steady salary'),
        expenses(150, 'commute and work costs'),
        skill('professional-practice', 12, 'real-world experience'),
        level('stability', 24, 'predictable income'),
        level('optionality', -4, 'time is committed to an employer'),
        level('stress', 4, 'normal work pressure'),
      ],
      hue: 96,
      archetypes: ['career'],
      riskBias: -0.2,
    },
    {
      id: 'opt-freelance',
      label: 'Freelance / contract',
      name: 'The Independent Contractor Path',
      intent: 'Sell your time directly to several clients rather than one employer.',
      effects: [
        income(1700, 'client work (variable)'),
        level('variance', 22, 'income varies month to month'),
        skill('client-work', 14, 'selling and delivering directly'),
        level('optionality', 12, 'control over what you take on'),
        level('stress', 10, 'no safety net'),
        money(-200, 'business admin and tools'),
      ],
      hue: 142,
      archetypes: ['career', 'business'],
      riskBias: 0.05,
    },
  ],
  business: [
    {
      id: 'opt-venture',
      label: 'Start the company',
      name: 'The Founder Path',
      intent: 'Commit fully to building something of your own.',
      effects: [
        money(-3000, 'initial build and runway'),
        income(-600, 'income not yet replaced'),
        expenses(250, 'hosting, tools, legal'),
        skill('business-building', 16, 'founder reps'),
        level('projectHealth', 26, 'something real exists'),
        level('risk', 34, 'no revenue yet'),
        level('optionality', -6, 'concentrated bet'),
      ],
      hue: 32,
      archetypes: ['business'],
      riskBias: 0.3,
    },
    {
      id: 'opt-sideventure',
      label: 'Build on the side',
      name: 'The Nights-and-Weekends Path',
      intent: 'Keep the income and grow the venture in the hours left over.',
      effects: [
        money(-600, 'side-project costs'),
        income(300, 'early side revenue'),
        skill('business-building', 9, 'part-time founder reps'),
        level('projectHealth', 14, 'slower but funded progress'),
        level('wellbeing', -8, 'reduced rest and free time'),
        level('risk', 12, 'reversible bet'),
      ],
      hue: 45,
      archetypes: ['business', 'time'],
      riskBias: 0.05,
    },
  ],
  relocation: [
    {
      id: 'opt-move',
      label: 'Move abroad',
      name: 'The Departure Path',
      intent: 'Leave the current environment entirely and rebuild elsewhere.',
      effects: [
        money(-4500, 'visa, flights, deposit'),
        expenses(200, 'higher cost of living'),
        level('network', -18, 'existing network left behind'),
        skill('independence', 16, 'navigating a new country alone'),
        level('optionality', 12, 'access to a different labour market'),
        level('wellbeing', -6, 'uprooting is destabilising at first'),
        level('stress', 14, 'immigration logistics'),
      ],
      hue: 268,
      archetypes: ['relocation'],
      riskBias: 0.2,
    },
    {
      id: 'opt-stay-remote',
      label: 'Stay, work remotely',
      name: 'The Remote Compromise',
      intent: 'Keep your base and location-independence by earning remotely instead.',
      effects: [
        income(400, 'remote-seniority premium'),
        skill('remote-collaboration', 12, 'distributed working'),
        level('optionality', 8, 'keep the support network'),
        level('stress', -4, 'no relocation shock'),
      ],
      hue: 258,
      archetypes: ['relocation', 'career'],
      riskBias: 0,
    },
  ],
  creative: [
    {
      id: 'opt-create',
      label: 'Go all-in on the work',
      name: 'The Audience Path',
      intent: 'Make the creative work the priority and find out if it can carry you.',
      effects: [
        income(-900, 'income traded for making'),
        skill('craft', 20, 'volume of finished work'),
        level('audience', 18, 'distribution starting to compound'),
        level('variance', 34, 'outcomes are very uneven'),
        level('wellbeing', 6, 'doing the work you care about'),
        level('risk', 24, 'no guaranteed floor'),
      ],
      hue: 320,
      archetypes: ['creative'],
      riskBias: 0.35,
    },
    {
      id: 'opt-create-part',
      label: 'Practise seriously, keep earning',
      name: 'The Two-Body Path',
      intent: 'Treat craft as a second discipline with real hours, funded by the day job.',
      effects: [
        income(900, 'reduced but present day-job income'),
        skill('craft', 11, 'evenings and weekends'),
        level('audience', 7, 'slower audience growth'),
        level('wellbeing', -3, 'two jobs, less rest'),
        level('optionality', 6, 'a floor under the risk'),
      ],
      hue: 335,
      archetypes: ['creative', 'career'],
      riskBias: 0.05,
    },
  ],
  health: [
    {
      id: 'opt-rebuild',
      label: 'Rebuild capacity first',
      name: 'The Foundation Path',
      intent: 'Fix sleep, health and energy before making any bigger bet.',
      effects: [
        level('wellbeing', 22, 'rest and health restored'),
        level('energy', 20, 'capacity rebuilt'),
        income(-300, 'some paid hours released'),
        level('stress', -16, 'recovery'),
        skill('craft', 4, 'reduced practice while recovering'),
      ],
      hue: 12,
      archetypes: ['health'],
      riskBias: -0.15,
    },
  ],
  time: [
    {
      id: 'opt-reduce-hours',
      label: 'Reduce hours, protect focus',
      name: 'The Deliberate Capacity Path',
      intent: 'Cut paid hours to create protected time for the thing that matters.',
      effects: [
        income(-500, 'fewer paid hours'),
        level('focus', 24, 'protected deep-work blocks'),
        skill('craft', 13, 'concentrated practice time'),
        level('expenses', -60, 'fewer work-related costs'),
      ],
      hue: 44,
      archetypes: ['time'],
      riskBias: -0.05,
    },
  ],
  finance: [
    {
      id: 'opt-lean',
      label: 'Cut costs and extend runway',
      name: 'The Lean Runway Path',
      intent: 'Buy time by reducing the monthly burn before making a bigger move.',
      effects: [
        expenses(-420, 'deliberately reduced recurring costs'),
        level('runway', 26, 'more months of freedom'),
        level('wellbeing', -4, 'a leaner life in the short term'),
        level('optionality', 10, 'the ability to wait for a better option'),
      ],
      hue: 60,
      archetypes: ['finance'],
      riskBias: -0.1,
    },
  ],
  relationships: [
    {
      id: 'opt-commit',
      label: 'Prioritise the people',
      name: 'The Relational Path',
      intent: 'Optimise for the relationships that matter rather than for speed.',
      effects: [
        level('relationships', 24, 'time deliberately given to people'),
        level('wellbeing', 12, 'support and stability'),
        income(-250, 'some opportunities declined for the sake of people'),
        level('network', 10, 'a stronger local support network'),
      ],
      hue: 292,
      archetypes: ['relationships'],
      riskBias: -0.1,
    },
  ],
  uncertainty: [
    {
      id: 'opt-experiment',
      label: 'Run cheap experiments',
      name: 'The Reconnaissance Path',
      intent: 'Spend a short, cheap period gathering real information before committing.',
      effects: [
        money(-400, 'deliberate experiments'),
        level('information', 26, 'first-hand knowledge about what fits'),
        level('optionality', 14, 'all bigger doors stay open'),
        level('decisionConfidence', 18, 'less uncertainty about direction'),
      ],
      hue: 190,
      archetypes: ['uncertainty'],
      riskBias: -0.05,
    },
  ],
};

/** Default options when the prompt is thin — the classic fork for a young life decision. */
export const FALLBACK_OPTIONS: BranchOption[] = [
  ARCHETYPE_OPTIONS.education?.[0] as BranchOption,
  ARCHETYPE_OPTIONS.career?.[0] as BranchOption,
  ARCHETYPE_OPTIONS.business?.[1] as BranchOption,
  ARCHETYPE_OPTIONS.learning?.[0] as BranchOption,
  ARCHETYPE_OPTIONS.time?.[0] as BranchOption,
  ARCHETYPE_OPTIONS.uncertainty?.[0] as BranchOption,
].filter(Boolean);

/**
 * Chooses the option set for a scenario: the options belonging to the strongest archetypes,
 * de-duplicated and trimmed to `count`, topped up from sensible fallbacks.
 */
export function selectOptions(archetypes: readonly string[], count: number): BranchOption[] {
  const picked: BranchOption[] = [];
  const seen = new Set<string>();
  const push = (o: BranchOption | undefined): void => {
    if (!o || seen.has(o.id)) return;
    seen.add(o.id);
    picked.push(o);
  };

  // Round-robin across archetypes so one loud archetype does not monopolise the options.
  const lists = archetypes.map((a) => ARCHETYPE_OPTIONS[a] ?? []).filter((l) => l.length > 0);
  const maxLen = lists.reduce((m, l) => Math.max(m, l.length), 0);
  for (let i = 0; i < maxLen; i += 1) {
    for (const list of lists) push(list[i]);
  }
  for (const o of FALLBACK_OPTIONS) push(o);

  const wanted = Math.max(2, Math.min(count, 6));
  return picked.slice(0, wanted);
}

export const MONTH_UNIT = MONTH;
