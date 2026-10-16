// The pane: state in, element tree out. Pure, so a test can draw it at any width
// and a handler never reaches `$` from here (register.tsx wires those).

import type { BoxProps, ButtonProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

import type { SkillRadarEntry, SkillRadarRankedBy } from '../types'
import type { Group, GroupBy } from './inventory'
import type { EffectiveView } from './state'

export type PaneElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

export type PaneModel = {
  /** Body columns the pane may use. */
  width: number
  groups: Group[]
  /** Rows left out by the row limit. */
  folded: number
  shown: number
  total: number
  rankedFor: string
  rankedBy: SkillRadarRankedBy
  isRanking: boolean
  lastError: string | null
  view: EffectiveView
  groupBy: GroupBy
  modelLabel: string
}

export type PaneHandlers = {
  onPick: (entry: SkillRadarEntry) => void
  onRefresh: () => void
  onToggleFlat: () => void
  onToggleBuiltins: () => void
  onToggleAll: () => void
  onClose: () => void
}

export const MAX_HOTKEY_ROWS = 9

function clip(s: string, n: number): string {
  if (n <= 0) return ''
  return s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s
}

/** One command as a pressable row: `1: /name [hint]  description`, fitted to `width`. */
export function row(ui: PaneElements, entry: SkillRadarEntry, index: number, width: number, onPick: (e: SkillRadarEntry) => void): RenderElement {
  const { Text, Button } = ui
  const hotkey = index < MAX_HOTKEY_ROWS ? String(index + 1) : undefined
  const name = `/${entry.name}`
  const hint = entry.hint ? ` ${entry.hint}` : ''
  let used = (hotkey ? 3 : 0) + name.length + hint.length
  const room = width - 1 - used
  const children: (string | RenderElement)[] = [name]
  if (hint) children.push(Text({ dimColor: true, italic: true, children: [hint] }))
  if (entry.description && room >= 10) {
    const desc = clip(entry.description, room - 2)
    children.push(Text({ dimColor: true, children: [`  ${desc}`] }))
    used += 2 + desc.length
  }
  const props: ButtonProps = {
    key: `cmd-${entry.name}`,
    plain: true,
    onPress: () => onPick(entry),
  }
  if (hotkey) props.hotkey = hotkey
  return Button({ ...props, children })
}

function header(ui: PaneElements, m: PaneModel): RenderElement[] {
  const { Box, Text } = ui
  const title = 'Skill Radar'
  const forText = ` · ${m.rankedFor}`
  const first = Box({
    flexDirection: 'row',
    children: [
      Text({ bold: true, children: [clip(title, m.width - 2)] }),
      Text({ dimColor: true, children: [clip(forText, Math.max(0, m.width - 2 - title.length))] }),
    ],
  })
  const parts: string[] = []
  if (m.isRanking) parts.push(`${m.modelLabel} ranking…`)
  else if (m.rankedBy === 'model') parts.push(`${m.modelLabel} re-ranked`)
  else if (m.rankedBy === 'heuristic') parts.push('heuristic')
  else parts.push('unranked')
  parts.push(`${m.shown} of ${m.total}`)
  if (m.folded > 0) parts.push(`+${m.folded} folded (a)`)
  if (m.lastError) parts.push(`last rank failed: ${m.lastError}`)
  const second = Text({ dimColor: true, children: [clip(parts.join(' · '), m.width - 1)] })
  return [first, second]
}

function footer(ui: PaneElements, m: PaneModel, h: PaneHandlers): RenderElement {
  const { Box, Text, Button } = ui
  const flat = m.groupBy === 'flat' || m.view.flat
  return Box({
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 2,
    children: [
      Button({ key: 'refresh', plain: true, hotkey: 'r', label: 'refresh', onPress: () => h.onRefresh() }),
      Button({ key: 'flat', plain: true, hotkey: 'f', label: flat ? 'grouped' : 'flat', onPress: () => h.onToggleFlat() }),
      Button({ key: 'builtins', plain: true, hotkey: 'b', label: m.view.builtins ? 'hide built-in' : 'built-in', onPress: () => h.onToggleBuiltins() }),
      Button({ key: 'all', plain: true, hotkey: 'a', label: m.view.all ? 'fewer' : 'all', onPress: () => h.onToggleAll() }),
      Button({ key: 'close', plain: true, hotkey: 'x', label: 'close', onPress: () => h.onClose() }),
      Text({ dimColor: true, children: ['Esc → prompt'] }),
    ],
  })
}

/** The whole pane. */
export function drawPane(ui: PaneElements, m: PaneModel, h: PaneHandlers): RenderElement {
  const { Box, Text } = ui
  const width = Math.max(28, m.width)
  const body: RenderElement[] = []
  let index = 0
  if (m.groups.length === 0) {
    body.push(Text({ dimColor: true, children: [m.total === 0 ? 'No commands found yet. Press r to refresh.' : 'Nothing to show under this view. Press b or a.'] }))
  }
  for (const g of m.groups) {
    if (g.label) {
      body.push(Text({ bold: true, dimColor: true, children: [clip(g.label.toUpperCase(), width - 1)] }))
    }
    for (const e of g.entries) {
      body.push(row(ui, e, index, width, h.onPick))
      index += 1
    }
  }
  return Box({
    flexDirection: 'column',
    children: [...header(ui, { ...m, width }), Text({ children: [' '] }), ...body, Text({ children: [' '] }), footer(ui, m, h)],
  })
}

/** The band above the prompt: the top few as digit buttons, when the option is on. */
export function drawBand(ui: PaneElements, top: readonly SkillRadarEntry[], onPick: (e: SkillRadarEntry) => void, after: RenderElement | null): RenderElement {
  const { Box, Text, Button } = ui
  const children: RenderElement[] = [Text({ dimColor: true, children: ['radar '] })]
  top.slice(0, 3).forEach((e, i) => {
    children.push(Button({ key: `band-${e.name}`, plain: true, hotkey: String(i + 1), label: `/${e.name}`, onPress: () => onPick(e) }))
  })
  if (after) children.push(after)
  return Box({ flexDirection: 'row', columnGap: 2, children })
}
