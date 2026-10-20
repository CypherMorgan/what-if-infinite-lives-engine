/**
 * Central variable registry.
 *
 * Every state key used anywhere in the engine is declared here with its unit, domain and
 * "which direction is good" semantics. The simulation engine uses this to clamp values and
 * the UI uses it to format and colour them, so a key must be declared to display properly.
 *
 * Archetype packs may still introduce keys of their own (they are merged in), but the shared
 * registry is what keeps cross-pack semantics consistent.
 */
import type { VarDef } from '../types';
import { BASE_VARS } from './base';

function level(
  key: string,
  label: string,
  domain: VarDef['domain'],
  kind: VarDef['kind'] = 'capacity',
  direction: VarDef['direction'] = 'up',
  hint?: string
): VarDef {
  return { key, label, unit: 'level', domain, kind, direction, ...(hint ? { hint } : {}) };
}

export const ARCHETYPE_VARS: VarDef[] = [
  // --- Education / learning -------------------------------------------------
  level(
    'credential',
    'Credential',
    'career',
    'progress',
    'up',
    'Formal qualifications accumulated. Legible to gatekeepers, slow to build.'
  ),
  level(
    'portfolio',
    'Public portfolio',
    'career',
    'progress',
    'up',
    'Shipped work that can be inspected by anyone.'
  ),
  level(
    'skill:structured-theory',
    'Structured theory',
    'learning',
    'skill',
    'up',
    'Formal, second-hand knowledge of a field.'
  ),
  level(
    'skill:craft',
    'Craft',
    'learning',
    'skill',
    'up',
    'Ability to actually produce good work, built by repetition.'
  ),
  level(
    'skill:professional-practice',
    'Professional practice',
    'career',
    'skill',
    'up',
    'Working inside an organisation’s norms and constraints.'
  ),
  level(
    'skill:client-work',
    'Client work',
    'career',
    'skill',
    'up',
    'Winning, scoping and delivering for clients directly.'
  ),
  level(
    'skill:business-building',
    'Business building',
    'career',
    'skill',
    'up',
    'Finding demand, building, and selling something of your own.'
  ),
  level(
    'skill:independence',
    'Independence',
    'personal',
    'skill',
    'up',
    'Operating without a familiar support structure.'
  ),
  level(
    'skill:remote-collaboration',
    'Remote collaboration',
    'career',
    'skill',
    'up',
    'Working effectively across distance and time zones.'
  ),
  level(
    'skill:research',
    'Research',
    'learning',
    'skill',
    'up',
    'Finding and weighing evidence rather than reacting to it.'
  ),
  level(
    'skill:communication',
    'Communication',
    'personal',
    'skill',
    'up',
    'Making your work and thinking legible to others.'
  ),

  // --- Career / business ---------------------------------------------------
  level(
    'stability',
    'Income stability',
    'financial',
    'capacity',
    'up',
    'How predictable next month’s income is.'
  ),
  level(
    'variance',
    'Outcome variance',
    'financial',
    'risk',
    'down',
    'How uneven the possible results are. Higher means wider swings.'
  ),
  level(
    'projectHealth',
    'Project health',
    'project',
    'progress',
    'up',
    'Whether the thing you are building is working.'
  ),
  level(
    'audience',
    'Audience',
    'career',
    'progress',
    'up',
    'People who want to see what you make next.'
  ),
  level(
    'marketFit',
    'Market fit',
    'project',
    'progress',
    'up',
    'Evidence that what you offer is actually wanted.'
  ),
  level(
    'leverage',
    'Leverage',
    'career',
    'capacity',
    'up',
    'How much your effort can achieve per hour invested.'
  ),

  // --- Relocation ----------------------------------------------------------
  level('belonging', 'Belonging', 'social', 'relationship', 'up', 'Feeling rooted where you are.'),
  level(
    'visaSecurity',
    'Status security',
    'personal',
    'capacity',
    'up',
    'How stable your right to stay and work is.'
  ),

  // --- Personal capacity / health -----------------------------------------
  level(
    'sleep',
    'Sleep quality',
    'health',
    'capacity',
    'up',
    'Recovery quality, which everything else depends on.'
  ),
  level(
    'healthBuffer',
    'Health buffer',
    'health',
    'capacity',
    'up',
    'How much illness or injury you could absorb.'
  ),
  level(
    'runwayMonths',
    'Personal runway',
    'financial',
    'resource',
    'up',
    'Months of independence purchased in advance.'
  ),

  // --- Relationships -------------------------------------------------------
  level(
    'relationships',
    'Relationships',
    'social',
    'relationship',
    'up',
    'Depth of the relationships you actually maintain.'
  ),

  // --- Decision quality ----------------------------------------------------
  level(
    'information',
    'Information',
    'personal',
    'progress',
    'up',
    'How much you know about what fits you, from evidence.'
  ),
  level(
    'decisionConfidence',
    'Decision confidence',
    'personal',
    'progress',
    'up',
    'How well-founded your current choice feels — earned, not felt.'
  ),
];

/** Every variable the engine knows about. */
export const ALL_VARS: VarDef[] = [...BASE_VARS, ...ARCHETYPE_VARS];

export const VAR_BY_KEY: ReadonlyMap<string, VarDef> = new Map(ALL_VARS.map((v) => [v.key, v]));

export function varDef(key: string): VarDef | undefined {
  return VAR_BY_KEY.get(key);
}
