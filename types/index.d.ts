// Skill Radar's state contract: every value the mod keeps in $.state, declared
// under the plugin's name so `claude plugin validate` can check each read and write.

export type SkillRadarSource = 'builtin' | 'plugin' | 'user' | 'mcp'

/** One slash command or skill, as the pane lists it. */
export type SkillRadarEntry = {
  /** The name typed after the slash. */
  name: string
  description: string
  source: SkillRadarSource
  /** The providing plugin, when source is `plugin` and the engine knows it. */
  plugin?: string
  /** The argument hint drawn dim after the name, e.g. `[days]` or `<file>`. */
  hint?: string
  /** Hidden from the typeahead; listed only under "all". */
  isHidden: boolean
  /** Domain and keyword tags derived from the name and description. */
  tags: string[]
}

/** When a command or skill was last used, by turn number. */
export type SkillRadarUse = { name: string; turn: number }

/** What the session is doing right now, as decaying tag weights. */
export type SkillRadarDigest = {
  tags: Record<string, number>
  /** Recent file basenames, newest last. */
  files: string[]
  lastPrompt: string
  lastAnswer: string
  used: SkillRadarUse[]
  /** Main-loop turns completed so far. */
  turns: number
}

export type SkillRadarRankedBy = 'none' | 'heuristic' | 'model'

export type SkillRadarRanking = {
  /** Visible command names, most relevant first. */
  order: string[]
  scores: Record<string, number>
  /** The last model re-rank, most relevant first; null before the first. */
  modelOrder: string[] | null
  rankedBy: SkillRadarRankedBy
  at: number
}

/** Toggles the person has pressed; null means "follow the config". */
export type SkillRadarView = {
  flat: boolean | null
  builtins: boolean | null
  all: boolean
}

export type SkillRadarStatus = {
  isRanking: boolean
  modelCalls: number
  /** The digest hash the last model call ranked, so an unchanged digest is not re-ranked. */
  modelHash: string
  lastError: string | null
  /** Whether the first-pick hint has been shown this session. */
  hasPicked: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'skill-radar': {
      inventory: SkillRadarEntry[]
      hints: Record<string, string>
      hidden: string[]
      digest: SkillRadarDigest
      ranking: SkillRadarRanking
      view: SkillRadarView
      status: SkillRadarStatus
    }
  }
}
