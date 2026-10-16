// The manifest's userConfig values, read into one typed object with defaults.

import type { PluginOptions } from 'claude-code'

import type { GroupBy } from './inventory'

export type RankMode = 'heuristic' | 'hybrid'

export type Config = {
  openOnStart: boolean
  includeBuiltins: boolean
  groupBy: GroupBy
  rankMode: RankMode
  rankModel: string
  maxRows: number
  usedPenalty: number
  nudge: boolean
  suggest: boolean
  band: boolean
}

export const DEFAULT_CONFIG: Config = {
  openOnStart: true,
  includeBuiltins: false,
  groupBy: 'plugin',
  rankMode: 'hybrid',
  rankModel: 'haiku',
  maxRows: 30,
  usedPenalty: 0.3,
  nudge: false,
  suggest: false,
  band: false,
}

function bool(v: unknown, d: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return d
}

function num(v: unknown, d: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d
}

function oneOf<T extends string>(v: unknown, options: readonly T[], d: T): T {
  return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : d
}

export function parseConfig(o: PluginOptions | undefined): Config {
  const x = o ?? {}
  return {
    openOnStart: bool(x.openOnStart, DEFAULT_CONFIG.openOnStart),
    includeBuiltins: bool(x.includeBuiltins, DEFAULT_CONFIG.includeBuiltins),
    groupBy: oneOf(x.groupBy, ['plugin', 'source', 'flat'] as const, DEFAULT_CONFIG.groupBy),
    rankMode: oneOf(x.rankMode, ['heuristic', 'hybrid'] as const, DEFAULT_CONFIG.rankMode),
    rankModel: typeof x.rankModel === 'string' && x.rankModel.trim() ? x.rankModel.trim() : DEFAULT_CONFIG.rankModel,
    maxRows: Math.round(num(x.maxRows, DEFAULT_CONFIG.maxRows, 3, 500)),
    usedPenalty: num(x.usedPenalty, DEFAULT_CONFIG.usedPenalty, 0, 1),
    nudge: bool(x.nudge, DEFAULT_CONFIG.nudge),
    suggest: bool(x.suggest, DEFAULT_CONFIG.suggest),
    band: bool(x.band, DEFAULT_CONFIG.band),
  }
}
