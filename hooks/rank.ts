// Ranking: how relevant each command is to the digest, and how a model's
// re-rank blends in. Pure functions only.

import type { SkillRadarDigest, SkillRadarEntry } from '../types'
import { contentWords, isDomain, topTags, wasUsedRecently } from './activity'

export type RankOptions = {
  /** 0 to 1: how far a command drops after it was used this turn or last. */
  usedPenalty: number
  /** The last model re-rank, most relevant first; null or empty for none. */
  modelOrder: readonly string[] | null
}

const MODEL_BOOST = 3
/** A keyword both sides name counts this much of its digest weight; a domain counts whole. */
const KEYWORD_FACTOR = 0.75
/** Each word the latest prompt and a command's text share, up to the cap. */
const PROMPT_WORD_BONUS = 1.5
const PROMPT_WORD_CAP = 3

/**
 * The heuristic score of one entry: the digest weight of every domain it
 * shares, three quarters of every keyword, and a bonus for each word the
 * latest prompt and the command's own text have in common.
 */
export function heuristicScore(entry: SkillRadarEntry, d: SkillRadarDigest, promptWords: ReadonlySet<string>, usedPenalty: number): number {
  let score = 0
  for (const t of entry.tags) {
    const w = d.tags[t]
    if (!w) continue
    score += isDomain(t) ? w : w * KEYWORD_FACTOR
  }
  if (promptWords.size) {
    let hits = 0
    for (const w of contentWords(`${entry.name} ${entry.description}`)) if (promptWords.has(w)) hits += 1
    score += Math.min(PROMPT_WORD_CAP, hits) * PROMPT_WORD_BONUS
  }
  if (score > 0 && wasUsedRecently(d, entry.name)) score *= 1 - Math.min(1, Math.max(0, usedPenalty))
  return Math.round(score * 100) / 100
}

/** Every visible entry scored and ordered: heuristic plus a bonus for the model's order. */
export function rankEntries(
  entries: readonly SkillRadarEntry[],
  d: SkillRadarDigest,
  opts: RankOptions,
): { order: string[]; scores: Record<string, number> } {
  const words = contentWords(d.lastPrompt)
  const scores: Record<string, number> = {}
  const modelRank = new Map((opts.modelOrder ?? []).map((n, i) => [n, i]))
  const n = Math.max(1, modelRank.size)
  for (const e of entries) {
    let s = heuristicScore(e, d, words, opts.usedPenalty)
    const i = modelRank.get(e.name)
    if (i !== undefined) s += MODEL_BOOST * (1 - i / n)
    scores[e.name] = Math.round(s * 100) / 100
  }
  const order = [...entries]
    .sort((a, b) => scores[b.name]! - scores[a.name]! || a.name.localeCompare(b.name))
    .map(e => e.name)
  return { order, scores }
}

/** The top entries with a score above `min`, for a nudge or a suggestion. */
export function topScored(entries: readonly SkillRadarEntry[], scores: Readonly<Record<string, number>>, n: number, min: number): SkillRadarEntry[] {
  return [...entries]
    .filter(e => (scores[e.name] ?? 0) >= min)
    .sort((a, b) => (scores[b.name] ?? 0) - (scores[a.name] ?? 0) || a.name.localeCompare(b.name))
    .slice(0, n)
}

// ------------------------------------------------------------------ model re-rank

export const RANK_SYSTEM =
  'You rank a developer\'s slash commands and skills by how useful each would be for what they are doing right now. ' +
  'Reply with JSON only, no prose: {"order":["name","name",...]} listing the 12 most relevant command names from the list, most relevant first. ' +
  'Use only names from the list, exactly as written, without the slash. Prefer commands whose purpose matches the current files, prompt and domain; ' +
  'leave out ones that clearly do not apply.'

const MAX_COMMANDS_IN_PROMPT = 80
const MAX_DESCRIPTION = 110

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** The user message for one re-rank: the digest, then the commands. */
export function buildRankPrompt(entries: readonly SkillRadarEntry[], d: SkillRadarDigest): string {
  const lines: string[] = ['Current activity:']
  const domains = topTags(d, 5, true).map(([t, w]) => `${t} ${w.toFixed(1)}`)
  if (domains.length) lines.push(`- domains (weighted): ${domains.join(', ')}`)
  const keywords = topTags(d, 12)
    .filter(([t]) => !isDomain(t))
    .map(([t]) => t)
  if (keywords.length) lines.push(`- keywords: ${keywords.join(', ')}`)
  if (d.files.length) lines.push(`- recent files: ${d.files.slice(-6).join(', ')}`)
  if (d.lastPrompt) lines.push(`- latest prompt: ${clip(d.lastPrompt.replace(/\s+/g, ' '), 400)}`)
  if (d.lastAnswer) lines.push(`- latest answer (excerpt): ${clip(d.lastAnswer.replace(/\s+/g, ' '), 400)}`)
  const used = d.used.filter(u => d.turns - u.turn < 2).map(u => u.name)
  if (used.length) lines.push(`- already used this turn or last: ${used.join(', ')}`)
  lines.push('', 'Commands:')
  for (const e of entries.slice(0, MAX_COMMANDS_IN_PROMPT)) {
    const hint = e.hint ? ` ${e.hint}` : ''
    lines.push(`- ${e.name}${hint} — ${clip(e.description || '(no description)', MAX_DESCRIPTION)}`)
  }
  return lines.join('\n')
}

/** The names the model listed, in order, kept to the ones that exist. */
export function parseModelOrder(text: string, names: ReadonlySet<string>): string[] {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  let list: unknown = null
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as { order?: unknown }
      list = parsed?.order
    } catch {
      list = null
    }
  }
  if (!Array.isArray(list)) {
    // A model that ignored the JSON instruction and wrote names anyway.
    list = text.split(/[\s,"'\[\]{}]+/).map(s => s.replace(/^\//, ''))
  }
  const out: string[] = []
  for (const item of list as unknown[]) {
    if (typeof item !== 'string') continue
    const name = item.trim().replace(/^\//, '')
    if (names.has(name) && !out.includes(name)) out.push(name)
  }
  return out
}
