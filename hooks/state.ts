// Defaults and normalizers for every value the mod keeps in $.state, so a
// value an older version stored, or one missing a field, never breaks a draw.

import type { SkillRadarRanking, SkillRadarStatus, SkillRadarView } from '../types'
import type { Config } from './config'

export const DEFAULT_RANKING: SkillRadarRanking = { order: [], scores: {}, modelOrder: null, rankedBy: 'none', at: 0 }

export const DEFAULT_VIEW: SkillRadarView = { flat: null, builtins: null, all: false }

export const DEFAULT_STATUS: SkillRadarStatus = { isRanking: false, modelCalls: 0, modelHash: '', lastError: null, hasPicked: false }

export function normalizeRanking(k: Partial<SkillRadarRanking> | null | undefined): SkillRadarRanking {
  return {
    order: Array.isArray(k?.order) ? k.order.filter((x): x is string => typeof x === 'string') : [],
    scores: k?.scores && typeof k.scores === 'object' ? k.scores : {},
    modelOrder: Array.isArray(k?.modelOrder) ? k.modelOrder.filter((x): x is string => typeof x === 'string') : null,
    rankedBy: k?.rankedBy === 'model' || k?.rankedBy === 'heuristic' ? k.rankedBy : 'none',
    at: typeof k?.at === 'number' ? k.at : 0,
  }
}

export function normalizeView(v: Partial<SkillRadarView> | null | undefined): SkillRadarView {
  return {
    flat: typeof v?.flat === 'boolean' ? v.flat : null,
    builtins: typeof v?.builtins === 'boolean' ? v.builtins : null,
    all: v?.all === true,
  }
}

export function normalizeStatus(s: Partial<SkillRadarStatus> | null | undefined): SkillRadarStatus {
  return {
    isRanking: s?.isRanking === true,
    modelCalls: typeof s?.modelCalls === 'number' ? s.modelCalls : 0,
    modelHash: typeof s?.modelHash === 'string' ? s.modelHash : '',
    lastError: typeof s?.lastError === 'string' ? s.lastError : null,
    hasPicked: s?.hasPicked === true,
  }
}

/** The view as drawn: a toggle the person has not touched follows the config. */
export type EffectiveView = { flat: boolean; builtins: boolean; all: boolean }

export function effectiveView(v: SkillRadarView, cfg: Config): EffectiveView {
  return {
    flat: v.flat ?? cfg.groupBy === 'flat',
    builtins: v.builtins ?? cfg.includeBuiltins,
    all: v.all,
  }
}
