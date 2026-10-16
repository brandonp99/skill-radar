import type { CommandInfo, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  EMPTY_DIGEST,
  addTags,
  decay,
  describeDigest,
  hashOf,
  markUsed,
  signalOfToolCall,
  tagsForPath,
  tagsOf,
  wasUsedRecently,
} from '../hooks/activity'
import { parseConfig } from '../hooks/config'
import { arrange, buildEntries, fillText, visibleEntries } from '../hooks/inventory'
import { buildRankPrompt, parseModelOrder, rankEntries, topScored } from '../hooks/rank'

// ---------------------------------------------------------------- fixtures

const COMMANDS: CommandInfo[] = [
  { name: 'frontend-design', description: 'Distinctive, intentional visual design for new UI: typography, layout, colour', source: 'plugin', plugin: 'design-kit' },
  { name: 'a11y-audit', description: 'Accessibility pass over components and pages', source: 'plugin', plugin: 'design-kit' },
  { name: 'tf-plan', description: 'Run terraform plan for an AWS environment and summarise the changes', source: 'user' },
  { name: 'deploy', description: 'Ship the service to staging or production', source: 'user' },
  { name: 'commit', description: 'Write a commit message for the staged changes', source: 'builtin' },
  { name: 'compact', description: 'Compact the conversation', source: 'builtin' },
  { name: 'radar', description: 'Skill Radar itself', source: 'plugin', plugin: 'skill-radar' },
]

const HINTS = { 'a11y-audit': '<path>', deploy: '[env]' }

const entries = () => buildEntries(COMMANDS, HINTS, [], 'skill-radar')

// ---------------------------------------------------------------- pure: activity

test('paths and commands tag the domains they belong to', () => {
  expect(tagsForPath('src/components/Hero.tsx')).toContain('frontend')
  expect(tagsForPath('src/components/Hero.tsx')).toContain('component')
  expect(tagsForPath('infra/ecs/main.tf')).toContain('infra')
  expect(tagsForPath('infra/ecs/main.tf')).toContain('tf')
  expect(tagsOf('run terraform plan')).toContain('terraform')
  expect(tagsOf('make the landing page hero responsive')).toContain('frontend')
  expect(tagsOf('make the landing page hero responsive')).toContain('design')
  expect(tagsOf('nothing of note here')).toEqual([])
})

test('a tool call carries its signal, or none', () => {
  const edit = signalOfToolCall({ tool: 'Edit', file_path: 'app/pages/index.vue', old_string: '', new_string: '' })
  expect(edit?.file).toBe('index.vue')
  expect(edit?.tags).toContain('frontend')
  const bash = signalOfToolCall({ tool: 'Bash', command: 'terraform plan -out tfplan' })
  expect(bash?.tags).toContain('infra')
  expect(signalOfToolCall({ tool: 'Bash', command: 'ls -la' })).toBe(null)
  expect(signalOfToolCall({ tool: 'WebSearch', query: 'x' })).toBe(null)
})

test('the digest fades each turn and forgets what faded away', () => {
  let d = addTags(EMPTY_DIGEST, ['frontend', 'tsx'], 1)
  expect(d.tags.frontend).toBe(1)
  expect(d.tags.tsx).toBe(1)
  for (let i = 0; i < 8; i++) d = decay(d)
  expect(d.tags.frontend).toBeUndefined()
  expect(describeDigest(EMPTY_DIGEST)).toBe('nothing yet')
  expect(describeDigest(addTags({ ...EMPTY_DIGEST, files: ['Hero.tsx'] }, ['frontend', 'infra'], 1))).toBe('frontend · infra · Hero.tsx')
})

test('a used command counts as used this turn and the next, then not', () => {
  let d = markUsed({ ...EMPTY_DIGEST, turns: 3 }, 'deploy')
  expect(wasUsedRecently(d, 'deploy')).toBe(true)
  d = { ...d, turns: 4 }
  expect(wasUsedRecently(d, 'deploy')).toBe(true)
  d = { ...d, turns: 5 }
  expect(wasUsedRecently(d, 'deploy')).toBe(false)
})

test('the hash moves with the signal and not with noise', () => {
  const a = addTags({ ...EMPTY_DIGEST, lastPrompt: 'style the hero' }, ['frontend'], 2)
  const b = { ...a, lastAnswer: 'a different answer, which does not rank' }
  const c = addTags(a, ['infra'], 4)
  expect(hashOf(a)).toBe(hashOf(b))
  expect(hashOf(a)).not.toBe(hashOf(c))
})

// ---------------------------------------------------------------- pure: inventory

test('the inventory leaves itself out, attaches hints, and tags each entry', () => {
  const list = entries()
  expect(list.map(e => e.name)).toEqual(['a11y-audit', 'commit', 'compact', 'deploy', 'frontend-design', 'tf-plan'])
  expect(list.find(e => e.name === 'deploy')?.hint).toBe('[env]')
  expect(list.find(e => e.name === 'frontend-design')?.tags).toContain('frontend')
  expect(list.find(e => e.name === 'tf-plan')?.tags).toContain('infra')
  expect(fillText({ name: 'deploy', hint: '[env]' })).toBe('/deploy [env]')
  expect(fillText({ name: 'commit' })).toBe('/commit')
})

test('built-ins stay out until asked for, and groups follow their best row', () => {
  const list = entries()
  const shown = visibleEntries(list, { builtins: false, all: false })
  expect(shown.map(e => e.name)).not.toContain('compact')
  expect(visibleEntries(list, { builtins: true, all: false }).map(e => e.name)).toContain('compact')
  const ranking = { order: ['tf-plan', 'frontend-design', 'a11y-audit', 'deploy'], scores: {}, modelOrder: null, rankedBy: 'heuristic' as const, at: 0 }
  const { groups, folded } = arrange(shown, ranking, 'plugin', 3)
  expect(groups.map(g => g.label)).toEqual(['your commands', 'design-kit'])
  expect(groups[0]?.entries.map(e => e.name)).toEqual(['tf-plan'])
  expect(groups[1]?.entries.map(e => e.name)).toEqual(['frontend-design', 'a11y-audit'])
  expect(folded).toBe(1)
  expect(arrange(shown, ranking, 'flat', 10).groups.map(g => g.label)).toEqual([''])
})

// ---------------------------------------------------------------- pure: rank

test('frontend work lifts frontend skills, a used one drops, a model order adds a bonus', () => {
  const list = visibleEntries(entries(), { builtins: false, all: false })
  let d = addTags(EMPTY_DIGEST, tagsForPath('src/components/Hero.tsx'), 1.2)
  d = { ...addTags(d, tagsOf('make the hero section look more distinctive'), 3), lastPrompt: 'make the hero section look more distinctive' }
  const first = rankEntries(list, d, { usedPenalty: 0.3, modelOrder: null })
  expect(first.order[0]).toBe('frontend-design')
  expect(first.order.indexOf('tf-plan')).toBeGreaterThan(first.order.indexOf('a11y-audit'))

  const used = rankEntries(list, markUsed(d, 'frontend-design'), { usedPenalty: 0.3, modelOrder: null })
  expect(used.scores['frontend-design']!).toBeLessThan(first.scores['frontend-design']!)

  const boosted = rankEntries(list, d, { usedPenalty: 0.3, modelOrder: ['tf-plan'] })
  expect(boosted.scores['tf-plan']!).toBe(Math.round((first.scores['tf-plan']! + 3) * 100) / 100)
  expect(topScored(list, first.scores, 2, 1).map(e => e.name)).toEqual(first.order.slice(0, 2))
})

test('a model reply is read for the names it has, in order, and nothing else', () => {
  const names = new Set(['frontend-design', 'tf-plan', 'deploy'])
  expect(parseModelOrder('{"order":["/tf-plan","deploy","made-up","tf-plan"]}', names)).toEqual(['tf-plan', 'deploy'])
  expect(parseModelOrder('Sure! Here you go:\n{"order": ["frontend-design"]}\nHope that helps', names)).toEqual(['frontend-design'])
  expect(parseModelOrder('deploy, tf-plan', names)).toEqual(['deploy', 'tf-plan'])
  expect(parseModelOrder('', names)).toEqual([])
  const prompt = buildRankPrompt(entries(), { ...EMPTY_DIGEST, lastPrompt: 'ship it', files: ['main.tf'] })
  expect(prompt).toContain('latest prompt: ship it')
  expect(prompt).toContain('- deploy [env] —')
})

test('config reads the manifest values and falls back on bad ones', () => {
  const cfg = parseConfig({ groupBy: 'flat', rankMode: 'heuristic', maxRows: 7, usedPenalty: 9, nudge: 'true' })
  expect(cfg.groupBy).toBe('flat')
  expect(cfg.rankMode).toBe('heuristic')
  expect(cfg.maxRows).toBe(7)
  expect(cfg.usedPenalty).toBe(1)
  expect(cfg.nudge).toBe(true)
  expect(parseConfig({ groupBy: 'bogus', maxRows: 'x' }).groupBy).toBe('plugin')
  expect(parseConfig(undefined).maxRows).toBe(30)
})

// ---------------------------------------------------------------- the pane, through the engine

/** The world beneath the plugin: a command list, no skill folders, and a prompt box that records fills. */
function engine(on: On) {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/t' })
  const filled: { text: string; mode: string }[] = []
  const counts = { opened: 0, closed: 0 }
  const submitted: { text: string; context: readonly string[] | undefined }[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.list', () => ({ value: [] }))
  on('command.list', () => ({ value: COMMANDS }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.describe', (_$, e) => ({ description: e.description, argumentHint: e.argumentHint, isHidden: e.isHidden }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => {
    counts.opened += 1
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    counts.closed += 1
    return { value: undefined }
  })
  on('prompt.fill', (_$, e) => {
    filled.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('prompt.suggest', () => ({ isShown: true }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('prompt.submit', (_$, e) => {
    submitted.push({ text: e.text, context: e.context })
    return { text: e.text, context: e.context }
  })
  return { clock, filled, counts, submitted }
}

const pane = (bodyColumns: number) => ({
  plugin: 'skill-radar',
  component: 'Pane' as const,
  requestId: 'skill-radar',
  props: {
    title: 'Skill Radar',
    isFocused: true,
    bodyColumns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
})

test('the pane lists every command in its group, and a press fills the prompt with its hint', async ($, on) => {
  const { filled } = engine(on)
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  // The engine describes each command when it lists them; that is where the hint arrives.
  await $.command.describe({ command: 'deploy', description: 'Ship the service', argumentHint: '[env]', isHidden: false, immediate: false, provider: { plugin: 'engine', tier: 'core' } } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(60), surface })
    expect(await ui.find({ text: /Skill Radar/ })).toBeDefined()
    expect(await ui.find({ text: /DESIGN-KIT/ })).toBeDefined()
    expect(await ui.find({ text: /YOUR COMMANDS/ })).toBeDefined()
    expect(await ui.find({ key: 'cmd-frontend-design' })).toBeDefined()
    expect(await ui.find({ key: 'cmd-deploy' })).toBeDefined()
    expect(await ui.find({ key: 'cmd-compact' })).toBeUndefined() // a built-in, hidden by default
    expect(await ui.find({ key: 'cmd-radar' })).toBeUndefined() // never itself
    await ui.press({ key: 'cmd-deploy' })
    expect(filled[filled.length - 1]).toEqual({ text: '/deploy [env]', mode: 'replace' })
    await ui.press({ key: 'cmd-frontend-design' })
    expect(filled[filled.length - 1]).toEqual({ text: '/frontend-design', mode: 'replace' })
    await ui.unmount()
  }
})

test('the footer toggles built-ins and flat view', async ($, on) => {
  engine(on)
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  await ui.press({ key: 'builtins' })
  expect(await ui.find({ key: 'cmd-compact' })).toBeDefined()
  expect(await ui.find({ text: /BUILT-IN/ })).toBeDefined()
  await ui.press({ key: 'flat' })
  expect(await ui.find({ text: /DESIGN-KIT/ })).toBeUndefined()
  expect(await ui.find({ key: 'cmd-frontend-design' })).toBeDefined()
  await ui.unmount()
})

test('/radar opens the pane and /radar close closes it', async ($, on) => {
  const { counts } = engine(on)
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  expect(await $.command.run({ command: 'radar', args: '' } as never)).toEqual({})
  expect(counts.opened).toBe(1)
  expect((await $.command.run({ command: 'radar', args: 'close' } as never)).text).toBe('Skill Radar closed.')
  expect(counts.closed).toBe(1)
  expect((await $.command.run({ command: 'radar', args: 'bogus' } as never)).text).toContain('Usage')
})

test('editing frontend files moves frontend skills up, and a turn brings the model re-rank', { options: { rankMode: 'hybrid' } }, async ($, on) => {
  const { clock } = engine(on)
  let modelCalls = 0
  on('model.complete', () => {
    modelCalls += 1
    return {
      value: {
        isAnswered: true,
        text: '{"order":["tf-plan","deploy"]}',
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })

  const namesInOrder = async () => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('cmd-'))
  // Before any activity the list is alphabetical within the first group.
  expect(await ui.find({ text: /unranked|heuristic/ })).toBeDefined()

  await $.tool.call({ tool: 'Edit', file_path: 'src/components/Hero.tsx', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: 'src/components/Hero.tsx', old_string: 'b', new_string: 'c' })
  await clock.advance(500) // the debounced re-score
  const afterEdits = await namesInOrder()
  expect(afterEdits.slice(0, 2).sort()).toEqual(['cmd-a11y-audit', 'cmd-frontend-design'])
  expect(afterEdits.indexOf('cmd-a11y-audit')).toBeLessThan(afterEdits.indexOf('cmd-tf-plan'))
  expect(await ui.find({ text: /Hero\.tsx/ })).toBeDefined()

  await $.turn.complete({ reason: 'answer', answer: 'Restyled the hero component.', durationMs: 1, turnId: 't1', isAborted: false } as never)
  await clock.advance(1) // the model re-rank scheduled for "now"
  expect(modelCalls).toBe(1)
  expect(await ui.find({ text: /haiku re-ranked/ })).toBeDefined()
  const afterRank = await namesInOrder()
  expect(afterRank.indexOf('cmd-tf-plan')).toBeLessThan(afterRank.indexOf('cmd-deploy'))

  // The same digest is not sent to the model twice.
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, turnId: 't2', isAborted: false } as never)
  await clock.advance(1)
  expect(modelCalls).toBe(2) // the turn count changed the hash, so one more call; and no more:
  await clock.advance(1000)
  expect(modelCalls).toBe(2)
  await ui.unmount()
})

test('heuristic mode never calls a model', { options: { rankMode: 'heuristic' } }, async ($, on) => {
  const { clock } = engine(on)
  let modelCalls = 0
  on('model.complete', () => {
    modelCalls += 1
    return { value: { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }
  })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  await $.tool.call({ tool: 'Edit', file_path: 'infra/main.tf', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ reason: 'answer', answer: 'Planned the change.', durationMs: 1, turnId: 't1', isAborted: false } as never)
  await clock.advance(1000)
  expect(modelCalls).toBe(0)
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  const first = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').find(k => k.startsWith('cmd-'))
  expect(first).toBe('cmd-tf-plan')
  await ui.unmount()
})

test('with nudge on, a prompt carries the relevant skills as context only Claude reads', { options: { nudge: true, rankMode: 'heuristic' } }, async ($, on) => {
  const { submitted } = engine(on)
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  await $.prompt.submit({ text: 'make the landing page hero look more distinctive and polished', origin: { kind: 'composer' }, wait: false } as never)
  const first = submitted[0]?.context
  expect(first?.length).toBe(1)
  expect(first?.[0]).toContain('/frontend-design')
  expect(first?.[0]).not.toContain('/tf-plan')

  // A prompt that says nothing about the work gets no nudge, however frontend the digest still is.
  await $.prompt.submit({ text: 'hello', origin: { kind: 'composer' }, wait: false } as never)
  expect(submitted[1]?.context).toBeUndefined()
  await $.prompt.submit({ text: 'yes, continue', origin: { kind: 'composer' }, wait: false } as never)
  expect(submitted[2]?.context).toBeUndefined()
})
