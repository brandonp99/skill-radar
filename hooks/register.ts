// Skill Radar: every hook, and every call that reaches outside the module.
//
// This is the one file that touches `$`. `claude plugin validate` reads each
// `$.<noun>.<method>` call off this source, so they are written in full here,
// and `$` is only ever passed to the top-level functions below.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { SkillRadarDigest, SkillRadarEntry, SkillRadarRanking, SkillRadarStatus, SkillRadarView } from '../types'
import {
  EMPTY_DIGEST,
  addTags,
  contentWords,
  decay,
  describeDigest,
  hashOf,
  markUsed,
  normalizeDigest,
  noteFile,
  signalOfToolCall,
  tagsOf,
} from './activity'
import { parseConfig } from './config'
import type { Config } from './config'
import { arrange, buildEntries, fillText, normalizeEntries, visibleEntries } from './inventory'
import type { GroupBy } from './inventory'
import { drawBand, drawPane } from './pane'
import { RANK_SYSTEM, buildRankPrompt, parseModelOrder, rankEntries, topScored } from './rank'
import { DEFAULT_RANKING, DEFAULT_STATUS, DEFAULT_VIEW, effectiveView, normalizeRanking, normalizeStatus, normalizeView } from './state'

const PANE = 'skill-radar'
const TITLE = 'Skill Radar'

/** A heuristic score at or above this is worth nudging Claude about. */
const NUDGE_MIN = 1.0
/** Tool calls within this window re-score once, not once each. */
const RESCORE_DEBOUNCE_MS = 400

// ---------------------------------------------------------------- state

const inventory = atom({ plugin: 'skill-radar', key: 'inventory' } as const, [] as SkillRadarEntry[])
const hints = atom({ plugin: 'skill-radar', key: 'hints' } as const, {} as Record<string, string>)
const hidden = atom({ plugin: 'skill-radar', key: 'hidden' } as const, [] as string[])
const digest = atom({ plugin: 'skill-radar', key: 'digest' } as const, EMPTY_DIGEST as SkillRadarDigest)
const ranking = atom({ plugin: 'skill-radar', key: 'ranking' } as const, DEFAULT_RANKING as SkillRadarRanking)
const view = atom({ plugin: 'skill-radar', key: 'view' } as const, DEFAULT_VIEW as SkillRadarView)
const status = atom({ plugin: 'skill-radar', key: 'status' } as const, DEFAULT_STATUS as SkillRadarStatus)

// ---------------------------------------------------------------- inventory

/** `argument-hint: <text>` from a skill's or a command's frontmatter, or undefined. */
function hintFromFrontmatter(text: string): string | undefined {
  if (!text.startsWith('---')) return undefined
  const end = text.indexOf('\n---', 3)
  if (end === -1) return undefined
  const front = text.slice(3, end)
  const m = /^\s*(?:argument-hint|argumentHint)\s*:\s*(.+?)\s*$/m.exec(front)
  if (!m) return undefined
  return m[1]!.replace(/^["']|["']$/g, '').trim() || undefined
}

/**
 * Argument hints read from the standard skill and command folders, for the
 * commands `command.describe` has not described yet. Best effort: any folder
 * that is missing or unreadable is skipped.
 */
async function scanHints($: EngineInterface): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const roots: string[] = []
  try {
    const home = await $.env.get('HOME')
    if (home) roots.push(`${home}/.claude`)
  } catch {
    // no home: skip the user folders
  }
  try {
    roots.push(`${await $.session.cwd()}/.claude`)
  } catch {
    // no cwd yet: skip the project folders
  }
  let reads = 0
  for (const root of roots) {
    // skills/<name>/SKILL.md
    try {
      for (const entry of await $.fs.list(`${root}/skills`)) {
        if (entry.kind !== 'dir' || reads >= 200) continue
        reads += 1
        try {
          const hint = hintFromFrontmatter(await $.fs.read(`${root}/skills/${entry.name}/SKILL.md`))
          if (hint) out[entry.name] = hint
        } catch {
          // a skill folder without SKILL.md
        }
      }
    } catch {
      // no skills folder here
    }
    // commands/<name>.md and commands/<dir>/<name>.md as <dir>:<name>
    try {
      for (const entry of await $.fs.list(`${root}/commands`)) {
        if (reads >= 200) break
        if (entry.kind === 'file' && entry.name.endsWith('.md')) {
          reads += 1
          try {
            const hint = hintFromFrontmatter(await $.fs.read(`${root}/commands/${entry.name}`))
            if (hint) out[entry.name.slice(0, -3)] = hint
          } catch {
            // unreadable
          }
        } else if (entry.kind === 'dir') {
          try {
            for (const sub of await $.fs.list(`${root}/commands/${entry.name}`)) {
              if (sub.kind !== 'file' || !sub.name.endsWith('.md') || reads >= 200) continue
              reads += 1
              try {
                const hint = hintFromFrontmatter(await $.fs.read(`${root}/commands/${entry.name}/${sub.name}`))
                if (hint) out[`${entry.name}:${sub.name.slice(0, -3)}`] = hint
              } catch {
                // unreadable
              }
            }
          } catch {
            // unreadable folder
          }
        }
      }
    } catch {
      // no commands folder here
    }
  }
  return out
}

/** Reads the session's command list again and rebuilds the inventory. */
async function refreshInventory($: EngineInterface): Promise<void> {
  const infos = await $.command.list()
  const [known, hiddenNames] = await Promise.all([read($, hints), read($, hidden)])
  const scanned = await scanHints($)
  const merged = { ...scanned, ...known }
  if (Object.keys(scanned).length) await update($, hints, h => ({ ...scanned, ...h }))
  await update($, inventory, () => buildEntries(infos, merged, hiddenNames, $.plugin.name))
}

/** What `command.describe` said about one command: its hint and whether the menu hides it. */
async function noteDescribe($: EngineInterface, name: string, hint: string | undefined, isHidden: boolean): Promise<void> {
  const trimmed = hint?.trim() || undefined
  const [known, hiddenNames] = await Promise.all([read($, hints), read($, hidden)])
  const hintChanged = trimmed !== undefined && known[name] !== trimmed
  const wasHidden = hiddenNames.includes(name)
  if (!hintChanged && wasHidden === isHidden) return
  if (hintChanged) await update($, hints, h => ({ ...h, [name]: trimmed! }))
  if (wasHidden !== isHidden) await update($, hidden, list => (isHidden ? [...list, name] : list.filter(n => n !== name)))
  await update($, inventory, list =>
    normalizeEntries(list).map(e => {
      if (e.name !== name) return e
      const next: SkillRadarEntry = { ...e, isHidden }
      if (hintChanged) next.hint = trimmed
      if (hintChanged) next.tags = tagsOf(`${e.name} ${e.description} ${trimmed ?? ''}`)
      return next
    }),
  )
}

// ---------------------------------------------------------------- ranking

type Rescored = { visible: SkillRadarEntry[]; scores: Record<string, number>; order: string[] }

/** Scores every visible entry against the digest now and writes the order. Free and instant. */
async function rescore($: EngineInterface, cfg: Config): Promise<Rescored> {
  const [entries, d, k, v] = await Promise.all([read($, inventory), read($, digest), read($, ranking), read($, view)])
  const visible = visibleEntries(normalizeEntries(entries), effectiveView(normalizeView(v), cfg))
  const current = normalizeRanking(k)
  const { order, scores } = rankEntries(visible, normalizeDigest(d), { usedPenalty: cfg.usedPenalty, modelOrder: current.modelOrder })
  const at = await $.clock.now()
  await update($, ranking, prev => {
    const p = normalizeRanking(prev)
    const rankedBy: SkillRadarRanking['rankedBy'] = p.modelOrder?.length ? 'model' : 'heuristic'
    return { ...p, order, scores, rankedBy, at }
  })
  return { visible, scores, order }
}

let rescoreQueued = false

/** Re-scores once the burst of events that asked for it has passed. */
function scheduleRescore($: EngineInterface, cfg: Config): void {
  if (rescoreQueued) return
  rescoreQueued = true
  $.clock.after(RESCORE_DEBOUNCE_MS, () => {
    rescoreQueued = false
    void rescore($, cfg).catch(() => undefined)
  })
}

/** One small model call that re-ranks the top of the list, after a turn. */
async function modelRank($: EngineInterface, cfg: Config): Promise<void> {
  const [entries, d, v, st] = await Promise.all([read($, inventory), read($, digest), read($, view), read($, status)])
  const visible = visibleEntries(normalizeEntries(entries), effectiveView(normalizeView(v), cfg))
  const dig = normalizeDigest(d)
  const current = normalizeStatus(st)
  if (visible.length < 2 || current.isRanking) return
  if (!dig.lastPrompt && Object.keys(dig.tags).length === 0) return
  const h = hashOf(dig)
  if (current.modelHash === h) return
  await update($, status, s => ({ ...normalizeStatus(s), isRanking: true }))
  let error: string | null = null
  try {
    const r = await $.model.complete({
      model: cfg.rankModel,
      system: RANK_SYSTEM,
      prompt: buildRankPrompt(visible, dig),
      maxTokens: 300,
      effort: 'low',
      timeoutMs: 20_000,
    })
    if (r.isAnswered) {
      const order = parseModelOrder(r.text, new Set(visible.map(e => e.name)))
      if (order.length) await update($, ranking, k => ({ ...normalizeRanking(k), modelOrder: order }))
      else error = 'the reply named no known command'
    } else {
      error = r.reason === 'api-error' ? `${r.error}${r.status ? ` (${r.status})` : ''}` : r.reason
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }
  await update($, status, s => ({ ...normalizeStatus(s), isRanking: false, modelCalls: s.modelCalls + 1, modelHash: h, lastError: error }))
  await rescore($, cfg)
}

/** After a turn: the top command as the prompt box's dim Tab-to-accept suggestion. */
async function suggestTop($: EngineInterface, cfg: Config): Promise<void> {
  const [entries, k, v] = await Promise.all([read($, inventory), read($, ranking), read($, view)])
  const visible = visibleEntries(normalizeEntries(entries), effectiveView(normalizeView(v), cfg))
  const { order, scores } = normalizeRanking(k)
  const top = order.map(n => visible.find(e => e.name === n)).find(e => e && (scores[e.name] ?? 0) > 0)
  if (top) void $.prompt.suggest({ text: fillText(top) })
}

/** The line only Claude reads, naming the skills that look relevant to this prompt. */
function nudgeText(top: readonly SkillRadarEntry[]): string {
  const items = top.map(e => `/${e.name}${e.hint ? ` ${e.hint}` : ''} — ${e.description || 'no description'}`)
  return `Skill Radar: these installed skills or commands look relevant to this request. If one fits, use it (via the Skill tool) before answering: ${items.join('; ')}`
}

// ---------------------------------------------------------------- the pane and its presses

async function openPane($: EngineInterface, byPerson: boolean) {
  return byPerson
    ? $.ui.open({ id: PANE, title: TITLE, focus: true, columns: 56, rows: 18 })
    : $.ui.open({ id: PANE, title: TITLE, columns: 56, rows: 18 })
}

/** Puts `/name hint` in the prompt box, the hint painted as a placeholder. */
async function pick($: EngineInterface, entry: SkillRadarEntry): Promise<void> {
  const text = fillText(entry)
  const r = entry.hint
    ? await $.prompt.fill({
        text,
        mode: 'replace',
        decorations: [{ start: text.length - entry.hint.length, end: text.length, dimColor: true, italic: true }],
      })
    : await $.prompt.fill({ text, mode: 'replace' })
  if (!r.isFilled) {
    $.ui.toast(r.refusal === 'dialog' ? 'Close the open dialog, then press the command again.' : 'There is no prompt box to fill here.')
    return
  }
  const st = normalizeStatus(await read($, status))
  if (!st.hasPicked) {
    await update($, status, s => ({ ...normalizeStatus(s), hasPicked: true }))
    $.ui.toast(entry.hint ? 'In the prompt. Esc moves the cursor there; replace the placeholder, then Enter.' : 'In the prompt. Esc moves the cursor there, then Enter.')
  }
}

async function refresh($: EngineInterface, cfg: Config): Promise<void> {
  await refreshInventory($)
  $.ui.invalidate('command.describe')
  await update($, status, s => ({ ...normalizeStatus(s), modelHash: '' }))
  await rescore($, cfg)
  if (cfg.rankMode === 'hybrid') $.clock.after(0, () => void modelRank($, cfg).catch(() => undefined))
}

async function noteUsed($: EngineInterface, name: string): Promise<void> {
  await update($, digest, d => markUsed(normalizeDigest(d), name))
}

// ---------------------------------------------------------------- hooks

export const register: Register = (on, options) => {
  const cfg = parseConfig(options)

  on('session.start', async ($, e, next) => {
    await refreshInventory($)
    await rescore($, cfg)
    // Ask the engine to describe each command again, so the hook below sees every hint.
    $.ui.invalidate('command.describe')
    if (cfg.openOnStart && e.isInteractive) void openPane($, false).catch(() => undefined)
    // Last, and guarded: a taken name throws, and a throw skips the rest of the hook.
    try {
      await $.command.register({
        name: 'radar',
        description: 'Skill Radar: your commands and skills, ranked by what you are doing',
        argumentHint: '[open|close|refresh|flat|builtins|all]',
        immediate: true,
      })
    } catch {
      // The pane still opens on start; only the command is missing.
    }
    return next(e)
  })

  // /clear, /resume and /branch reset $.state without a session.start: rebuild from scratch.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await refreshInventory($)
    await rescore($, cfg)
    $.ui.invalidate('command.describe')
    return next(e)
  })

  // The engine describes each command for the typeahead: that is where argument hints live.
  on('command.describe', async ($, e, next) => {
    const r = await next(e)
    await noteDescribe($, e.command, r.argumentHint ?? e.argumentHint, r.isHidden ?? e.isHidden)
    return r
  })

  on('command.run', { command: 'radar' }, async ($, e) => {
    const verb = (e.args.trim().split(/\s+/)[0] ?? '').toLowerCase()
    if (verb === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Skill Radar closed.' }
    }
    if (verb === 'refresh') await refresh($, cfg)
    else if (verb === 'flat') await update($, view, v => ({ ...normalizeView(v), flat: !effectiveView(normalizeView(v), cfg).flat }))
    else if (verb === 'builtins') await update($, view, v => ({ ...normalizeView(v), builtins: !effectiveView(normalizeView(v), cfg).builtins }))
    else if (verb === 'all') await update($, view, v => ({ ...normalizeView(v), all: !normalizeView(v).all }))
    else if (verb !== '' && verb !== 'open') return { text: 'Usage: /radar [open|close|refresh|flat|builtins|all]' }
    const opened = await openPane($, true)
    if (!opened.isPlaced) return { text: `Skill Radar is not shown yet: ${opened.reason}` }
    return {}
  })

  // What Claude reads and touches, on the main loop only.
  on('tool.call', async ($, e, next) => {
    if (!e.agentId) {
      const call = e as unknown as { tool: string; [k: string]: unknown }
      if (call.tool === 'Skill' && typeof call.skill === 'string') await noteUsed($, call.skill)
      const sig = signalOfToolCall(call)
      if (sig) {
        await update($, digest, d => {
          let x = addTags(normalizeDigest(d), sig.tags, sig.weight)
          if (sig.file) x = noteFile(x, sig.file)
          return x
        })
        scheduleRescore($, cfg)
      }
    }
    return next(e)
  })

  // A skill's text is expanded: it was used, by you or by Claude.
  on('skill.prompt', async ($, e, next) => {
    await noteUsed($, e.skill)
    scheduleRescore($, cfg)
    return next(e)
  })

  // Your prompt is the strongest signal, so re-score before the turn starts.
  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta || e.origin.kind !== 'composer') return next(e)
    if (e.command) {
      await noteUsed($, e.command.name)
      await rescore($, cfg)
      return next(e)
    }
    const text = e.text.trim()
    if (!text) return next(e)
    const promptTags = tagsOf(text)
    await update($, digest, d => ({ ...addTags(normalizeDigest(d), promptTags, 3), lastPrompt: text.slice(0, 600) }))
    const ranked = await rescore($, cfg)
    // A nudge rides only on a prompt that says something about the work: "hello" or "continue" gets none.
    if (cfg.nudge && (promptTags.length > 0 || contentWords(text).size >= 2)) {
      const top = topScored(ranked.visible, ranked.scores, 3, NUDGE_MIN)
      if (top.length) return next({ ...e, context: [...(e.context ?? []), nudgeText(top)] })
    }
    return next(e)
  })

  // A turn ended: fade the old signal, read the answer, and re-rank.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) {
      const answer = (e.answer ?? '').slice(0, 2000)
      await update($, digest, d => {
        const x = addTags(decay(normalizeDigest(d)), tagsOf(answer), 1.5)
        return { ...x, lastAnswer: answer.slice(0, 600), turns: x.turns + 1 }
      })
      await rescore($, cfg)
      if (cfg.rankMode === 'hybrid') $.clock.after(0, () => void modelRank($, cfg).catch(() => undefined))
      if (cfg.suggest) void suggestTop($, cfg).catch(() => undefined)
    }
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [entries, k, v, st, d] = await Promise.all([read($, inventory), read($, ranking), read($, view), read($, status), read($, digest)])
    const eff = effectiveView(normalizeView(v), cfg)
    const visible = visibleEntries(normalizeEntries(entries), eff)
    const groupBy: GroupBy = eff.flat ? 'flat' : cfg.groupBy
    const limit = eff.all ? Number.MAX_SAFE_INTEGER : cfg.maxRows
    const current = normalizeRanking(k)
    const { groups, folded } = arrange(visible, current, groupBy, limit)
    const s = normalizeStatus(st)
    return drawPane(
      { Box, Text, Button },
      {
        width: e.props.bodyColumns,
        groups,
        folded,
        shown: visible.length - folded,
        total: visible.length,
        rankedFor: describeDigest(normalizeDigest(d)),
        rankedBy: current.rankedBy,
        isRanking: s.isRanking,
        lastError: s.lastError,
        view: eff,
        groupBy,
        modelLabel: cfg.rankModel,
      },
      {
        onPick: entry => void pick($, entry).catch(() => undefined),
        onRefresh: () => void refresh($, cfg).catch(() => undefined),
        onToggleFlat: () => void update($, view, x => ({ ...normalizeView(x), flat: !effectiveView(normalizeView(x), cfg).flat })),
        onToggleBuiltins: () => {
          void update($, view, x => ({ ...normalizeView(x), builtins: !effectiveView(normalizeView(x), cfg).builtins })).then(() => rescore($, cfg))
        },
        onToggleAll: () => void update($, view, x => ({ ...normalizeView(x), all: !normalizeView(x).all })),
        onClose: () => void $.ui.close({ id: PANE }),
      },
    )
  })

  // Optional: the top three as 1/2/3 above the prompt, in front of whatever else is drawn there.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!cfg.band || e.props.hasSurvey) return next(e)
    const [entries, k, v] = await Promise.all([read($, inventory), read($, ranking), read($, view)])
    const visible = visibleEntries(normalizeEntries(entries), effectiveView(normalizeView(v), cfg))
    const { order, scores } = normalizeRanking(k)
    const top = order
      .map(n => visible.find(x => x.name === n))
      .filter((x): x is SkillRadarEntry => !!x && (scores[x.name] ?? 0) > 0)
      .slice(0, 3)
    if (top.length === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const rest = (await next(e)) as RenderElement | null | undefined
    return drawBand({ Box, Text, Button }, top, entry => void pick($, entry).catch(() => undefined), rest ?? null)
  })
}
