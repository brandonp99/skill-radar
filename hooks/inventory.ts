// Inventory: the commands and skills a session has, as the pane lists them.
//
// Pure functions only; `register.tsx` reads `$.command.list()` and hands the
// result here.

import type { CommandInfo } from 'claude-code'

import type { SkillRadarEntry, SkillRadarRanking } from '../types'
import { tagsOf } from './activity'

/** The view as drawn (see state.ts): every toggle resolved. */
export type ViewFilter = { builtins: boolean; all: boolean }

export type GroupBy = 'plugin' | 'source' | 'flat'

export type Group = { label: string; entries: SkillRadarEntry[] }

/** `$.command.list()` rows plus the hints and hidden flags gathered from `command.describe`. */
export function buildEntries(
  infos: readonly CommandInfo[],
  hints: Readonly<Record<string, string>>,
  hidden: readonly string[],
  self: string,
): SkillRadarEntry[] {
  const hiddenSet = new Set(hidden)
  const seen = new Set<string>()
  const out: SkillRadarEntry[] = []
  for (const info of infos) {
    if (!info.name || seen.has(info.name)) continue
    seen.add(info.name)
    if (info.plugin === self || info.name === 'radar') continue
    const description = (info.description ?? '').replace(/\s+/g, ' ').trim()
    const hint = hints[info.name]?.trim() || undefined
    const entry: SkillRadarEntry = {
      name: info.name,
      description,
      source: info.source,
      isHidden: hiddenSet.has(info.name),
      tags: tagsOf(`${info.name} ${description} ${hint ?? ''}`),
    }
    if (info.plugin) entry.plugin = info.plugin
    if (hint) entry.hint = hint
    out.push(entry)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** The entries with every field present, whatever an older version stored. */
export function normalizeEntries(list: unknown): SkillRadarEntry[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((x): x is SkillRadarEntry => !!x && typeof x === 'object' && typeof (x as SkillRadarEntry).name === 'string')
    .map(x => ({
      ...x,
      description: typeof x.description === 'string' ? x.description : '',
      source: x.source ?? 'user',
      isHidden: x.isHidden === true,
      tags: Array.isArray(x.tags) ? x.tags : [],
    }))
}

/** The plugin name without its marketplace suffix: `frontend-design@acme` -> `frontend-design`. */
export function pluginLabel(plugin: string | undefined): string {
  if (!plugin) return 'plugins'
  return plugin.split('@')[0] || plugin
}

export function groupLabel(entry: SkillRadarEntry, groupBy: GroupBy): string {
  switch (entry.source) {
    case 'builtin':
      return 'built-in'
    case 'mcp':
      return 'mcp'
    case 'user':
      return 'your commands'
    case 'plugin':
      return groupBy === 'plugin' ? pluginLabel(entry.plugin) : 'plugins'
    default:
      return 'other'
  }
}

/** The entries the pane may show under the current view. */
export function visibleEntries(entries: readonly SkillRadarEntry[], view: ViewFilter): SkillRadarEntry[] {
  return entries.filter(e => {
    if (e.source === 'builtin' && !view.builtins) return false
    if (e.isHidden && !view.all) return false
    return true
  })
}

/** The text a press puts in the prompt box: `/name` and its hint as a placeholder. */
export function fillText(entry: Pick<SkillRadarEntry, 'name' | 'hint'>): string {
  return entry.hint ? `/${entry.name} ${entry.hint}` : `/${entry.name}`
}

/**
 * The visible entries in rank order, grouped. Groups are ordered by their best
 * row, rows within a group by rank. `limit` caps the rows in all; the rest is
 * reported as `folded` so the pane can say how many it left out.
 */
export function arrange(
  entries: readonly SkillRadarEntry[],
  ranking: SkillRadarRanking,
  groupBy: GroupBy,
  limit: number,
): { groups: Group[]; folded: number } {
  const rank = new Map(ranking.order.map((name, i) => [name, i]))
  const byRank = (a: SkillRadarEntry, b: SkillRadarEntry) =>
    (rank.get(a.name) ?? Infinity) - (rank.get(b.name) ?? Infinity) || a.name.localeCompare(b.name)
  const ordered = [...entries].sort(byRank)
  const shown = ordered.slice(0, Math.max(0, limit))
  const folded = ordered.length - shown.length

  if (groupBy === 'flat') return { groups: shown.length ? [{ label: '', entries: shown }] : [], folded }

  const groups = new Map<string, SkillRadarEntry[]>()
  for (const e of shown) {
    const label = groupLabel(e, groupBy)
    groups.set(label, [...(groups.get(label) ?? []), e])
  }
  // Groups keep the order their best row has, which `shown` already follows.
  return { groups: [...groups].map(([label, list]) => ({ label, entries: list })), folded }
}
