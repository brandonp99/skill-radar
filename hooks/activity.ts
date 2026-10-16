// Activity: what the session is doing right now, as decaying tag weights.
//
// Pure functions only. Nothing here touches `$`, so it is unit-tested directly
// and `register.tsx` is the one file that reaches outside the module.

import type { SkillRadarDigest } from '../types'

/**
 * Domain vocabulary. A token that appears in a domain's list tags the text with
 * both the token itself and the domain, so a command described as "terraform
 * plan" and an activity editing `main.tf` meet on `infra` (and `terraform` when
 * both say it). Keep the lists lowercase; tokens are lowercased before lookup.
 */
export const DOMAINS: Readonly<Record<string, readonly string[]>> = {
  frontend: [
    'tsx', 'jsx', 'css', 'scss', 'sass', 'less', 'html', 'vue', 'svelte', 'astro',
    'tailwind', 'component', 'components', 'page', 'pages', 'layout', 'layouts', 'ui',
    'frontend', 'react', 'next', 'nextjs', 'nuxt', 'vite', 'storybook', 'responsive',
    'accessibility', 'a11y', 'animation', 'web', 'website', 'dom', 'hook', 'hooks',
    'form', 'forms', 'button', 'modal', 'navbar', 'header', 'footer', 'hero',
  ],
  design: [
    'design', 'figma', 'brand', 'branding', 'typography', 'font', 'fonts', 'palette',
    'theme', 'themes', 'styling', 'style', 'styles', 'visual', 'logo', 'icon', 'icons',
    'mockup', 'landing', 'aesthetic', 'spacing', 'color', 'colors', 'colour', 'colours',
  ],
  backend: [
    'api', 'apis', 'route', 'routes', 'router', 'handler', 'handlers', 'controller',
    'controllers', 'server', 'service', 'services', 'middleware', 'endpoint', 'endpoints',
    'graphql', 'rest', 'express', 'fastapi', 'django', 'flask', 'prisma', 'orm',
    'py', 'go', 'rs', 'java', 'kt', 'rb', 'php', 'backend', 'webhook', 'webhooks',
    'queue', 'worker', 'cron', 'job', 'jobs',
  ],
  infra: [
    'tf', 'hcl', 'tfvars', 'terraform', 'terragrunt', 'aws', 'ecs', 'fargate', 'rds',
    'ec2', 's3', 'iam', 'lambda', 'cloudformation', 'cdk', 'docker', 'dockerfile',
    'compose', 'k8s', 'kubernetes', 'helm', 'yaml', 'yml', 'nginx', 'cloudflare', 'vpc',
    'infra', 'infrastructure', 'deploy', 'deployment', 'deployments', 'pipeline',
    'pipelines', 'ci', 'cd', 'workflow', 'workflows', 'ansible', 'pulumi', 'devops',
    'provision', 'cluster', 'container', 'containers', 'kubectl', 'staging', 'production',
    'monitoring', 'alerting', 'incident', 'incidents', 'runbook',
  ],
  data: [
    'sql', 'postgres', 'postgresql', 'mysql', 'sqlite', 'migration', 'migrations',
    'schema', 'schemas', 'query', 'queries', 'database', 'databases', 'db', 'redis',
    'csv', 'parquet', 'etl', 'analytics', 'dashboard', 'dashboards', 'report', 'reports',
    'xlsx', 'spreadsheet',
  ],
  tests: [
    'test', 'tests', 'testing', 'spec', 'specs', 'vitest', 'jest', 'playwright',
    'cypress', 'pytest', 'e2e', 'coverage', 'mock', 'mocks', 'fixture', 'fixtures',
    'assert', 'tdd',
  ],
  docs: [
    'md', 'mdx', 'readme', 'docs', 'documentation', 'document', 'changelog', 'adr',
    'rfc', 'guide', 'guides', 'notes', 'wiki', 'comment', 'comments', 'explain',
  ],
  git: [
    'git', 'commit', 'commits', 'pr', 'prs', 'pull', 'branch', 'branches', 'merge',
    'rebase', 'release', 'releases', 'tag', 'tags', 'changeset', 'review', 'reviews',
    'diff', 'push', 'github', 'gitlab',
  ],
  security: [
    'security', 'secure', 'auth', 'authentication', 'authorization', 'oauth', 'jwt',
    'secret', 'secrets', 'vulnerability', 'vulnerabilities', 'cve', 'audit', 'permission',
    'permissions', 'policy', 'policies', 'encryption', 'tls', 'ssl', 'cors', 'csrf',
    'xss', 'owasp',
  ],
  mobile: [
    'ios', 'android', 'swift', 'kotlin', 'flutter', 'dart', 'react-native', 'expo',
    'mobile', 'app-store', 'xcode',
  ],
  ai: [
    'prompt', 'prompts', 'llm', 'agent', 'agents', 'embedding', 'embeddings', 'rag',
    'mcp', 'claude', 'openai', 'skill', 'skills', 'subagent', 'subagents',
  ],
  social: [
    'instagram', 'tiktok', 'facebook', 'linkedin', 'caption', 'captions', 'reel',
    'reels', 'social', 'marketing', 'campaign', 'campaigns', 'newsletter', 'seo',
    'metricool', 'content',
  ],
  perf: [
    'performance', 'perf', 'profile', 'profiling', 'benchmark', 'benchmarks', 'optimize',
    'optimise', 'optimization', 'cache', 'caching', 'latency', 'memory', 'leak',
  ],
}

const DOMAIN_NAMES = new Set(Object.keys(DOMAINS))

/** keyword -> the domains it belongs to */
const KEYWORD_DOMAINS: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, string[]>()
  for (const [domain, words] of Object.entries(DOMAINS)) {
    for (const w of words) m.set(w, [...(m.get(w) ?? []), domain])
  }
  return m
})()

export function isDomain(tag: string): boolean {
  return DOMAIN_NAMES.has(tag)
}

/** Lowercase word-ish tokens of a text. Hyphenated tokens are kept whole and split. */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const raw of text.toLowerCase().split(/[^a-z0-9+#_.\-/]+/)) {
    for (const piece of raw.split(/[./]/)) {
      const t = piece.replace(/^[-_]+|[-_]+$/g, '')
      if (t.length < 2 || t.length > 40) continue
      out.push(t)
      if (t.includes('-')) for (const part of t.split('-')) if (part.length >= 2) out.push(part)
      if (t.includes('_')) for (const part of t.split('_')) if (part.length >= 2) out.push(part)
    }
  }
  return out
}

function domainsOf(token: string): readonly string[] | undefined {
  const direct = KEYWORD_DOMAINS.get(token)
  if (direct) return direct
  // a plural whose singular is a keyword (components -> component is listed; others are not)
  if (token.endsWith('s') && token.length > 3) return KEYWORD_DOMAINS.get(token.slice(0, -1))
  return undefined
}

/** A keyword's canonical spelling: the singular, when both forms are listed. */
function canonical(token: string): string {
  if (KEYWORD_DOMAINS.has(token)) {
    return token.endsWith('s') && KEYWORD_DOMAINS.has(token.slice(0, -1)) ? token.slice(0, -1) : token
  }
  return token.slice(0, -1)
}

/** The domain and keyword tags of a free text. */
export function tagsOf(text: string): string[] {
  const out = new Set<string>()
  for (const t of tokenize(text)) {
    const domains = domainsOf(t)
    if (!domains) continue
    out.add(canonical(t))
    for (const d of domains) out.add(d)
  }
  return [...out]
}

const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'always', 'another', 'anything', 'because', 'been', 'before', 'being', 'between',
  'both', 'change', 'changes', 'check', 'could', 'create', 'does', 'doing', 'done', 'each', 'else', 'every', 'file',
  'files', 'find', 'first', 'fix', 'from', 'give', 'going', 'good', 'have', 'help', 'here', 'into', 'just', 'know',
  'like', 'look', 'make', 'more', 'most', 'much', 'need', 'needs', 'only', 'other', 'over', 'please', 'same', 'show',
  'should', 'some', 'something', 'still', 'such', 'than', 'that', 'them', 'then', 'there', 'these', 'they', 'thing',
  'things', 'this', 'those', 'through', 'under', 'update', 'using', 'want', 'what', 'when', 'where', 'which', 'while',
  'will', 'with', 'work', 'would', 'your', 'yours', 'write', 'using', 'without', 'into', 'onto',
])

/** The words of a text worth matching between a prompt and a description: four letters or more, no stopwords. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>()
  for (const t of tokenize(text)) if (t.length >= 4 && !STOPWORDS.has(t) && !/^\d+$/.test(t)) out.add(t)
  return out
}

/** Tags of a file path: its last few segments and its extension. */
export function tagsForPath(path: string): string[] {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return tagsOf(segments.slice(-4).join(' '))
}

export function basenameOf(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return segments[segments.length - 1] ?? path
}

/** Tags of a shell command: its first few words, so `terraform plan -out x` reads as infra. */
export function tagsForCommand(command: string): string[] {
  const head = command.trim().split(/\s+/).slice(0, 8).join(' ')
  return tagsOf(head)
}

/** A tool call reduced to the signal it carries, or null when it carries none. */
export type ToolSignal = { tags: string[]; file?: string; weight: number }

export function signalOfToolCall(call: { tool: string; [k: string]: unknown }): ToolSignal | null {
  const filePath = typeof call.file_path === 'string' ? call.file_path : undefined
  const notebook = typeof call.notebook_path === 'string' ? call.notebook_path : undefined
  const path = filePath ?? notebook
  switch (call.tool) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return path ? { tags: tagsForPath(path), file: basenameOf(path), weight: 1.2 } : null
    case 'Read':
      return path ? { tags: tagsForPath(path), file: basenameOf(path), weight: 0.6 } : null
    case 'Glob':
    case 'Grep': {
      const pattern = typeof call.pattern === 'string' ? call.pattern : ''
      const dir = typeof call.path === 'string' ? call.path : ''
      const tags = [...new Set([...tagsForPath(pattern), ...tagsForPath(dir)])]
      return tags.length ? { tags, weight: 0.4 } : null
    }
    case 'Bash': {
      const command = typeof call.command === 'string' ? call.command : ''
      const tags = tagsForCommand(command)
      return tags.length ? { tags, weight: 0.8 } : null
    }
    default:
      return null
  }
}

// ------------------------------------------------------------------ digest

export const EMPTY_DIGEST: SkillRadarDigest = {
  tags: {},
  files: [],
  lastPrompt: '',
  lastAnswer: '',
  used: [],
  turns: 0,
}

const MAX_TAG_WEIGHT = 12
const PRUNE_BELOW = 0.05
const MAX_FILES = 8
const USED_TURNS = 2

/** The digest with every field present, whatever an older version stored. */
export function normalizeDigest(d: Partial<SkillRadarDigest> | null | undefined): SkillRadarDigest {
  return {
    tags: d?.tags && typeof d.tags === 'object' ? d.tags : {},
    files: Array.isArray(d?.files) ? d.files : [],
    lastPrompt: typeof d?.lastPrompt === 'string' ? d.lastPrompt : '',
    lastAnswer: typeof d?.lastAnswer === 'string' ? d.lastAnswer : '',
    used: Array.isArray(d?.used) ? d.used : [],
    turns: typeof d?.turns === 'number' ? d.turns : 0,
  }
}

/** Adds `weight` to each tag, domain and keyword alike. */
export function addTags(d: SkillRadarDigest, tags: readonly string[], weight: number): SkillRadarDigest {
  if (tags.length === 0 || weight <= 0) return d
  const next = { ...d.tags }
  for (const t of tags) next[t] = Math.min(MAX_TAG_WEIGHT, (next[t] ?? 0) + weight)
  return { ...d, tags: next }
}

export function noteFile(d: SkillRadarDigest, file: string): SkillRadarDigest {
  const files = d.files.filter(f => f !== file)
  files.push(file)
  return { ...d, files: files.slice(-MAX_FILES) }
}

/** Fades every tag by `factor` and drops the ones that faded away. Call once per turn. */
export function decay(d: SkillRadarDigest, factor = 0.6): SkillRadarDigest {
  const tags: Record<string, number> = {}
  for (const [t, w] of Object.entries(d.tags)) {
    const faded = w * factor
    if (faded >= PRUNE_BELOW) tags[t] = Math.round(faded * 1000) / 1000
  }
  return { ...d, tags }
}

export function markUsed(d: SkillRadarDigest, name: string): SkillRadarDigest {
  const used = d.used.filter(u => u.name !== name)
  used.push({ name, turn: d.turns })
  return { ...d, used: used.slice(-40) }
}

/** Whether `name` was used this turn or the one before. */
export function wasUsedRecently(d: SkillRadarDigest, name: string): boolean {
  return d.used.some(u => u.name === name && d.turns - u.turn < USED_TURNS)
}

export function topTags(d: SkillRadarDigest, n: number, onlyDomains = false): [string, number][] {
  return Object.entries(d.tags)
    .filter(([t]) => !onlyDomains || isDomain(t))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
}

/** A short line for the pane header: "frontend · design · Hero.tsx". */
export function describeDigest(d: SkillRadarDigest): string {
  const parts = topTags(d, 2, true).map(([t]) => t)
  const file = d.files[d.files.length - 1]
  if (file) parts.push(file)
  return parts.length ? parts.join(' · ') : 'nothing yet'
}

/** A cheap fingerprint of what matters for ranking, so an unchanged digest is not re-ranked. */
export function hashOf(d: SkillRadarDigest): string {
  const top = topTags(d, 10).map(([t, w]) => `${t}:${Math.round(w)}`).join(',')
  const s = `${top}|${d.lastPrompt.slice(0, 200)}|${d.files.slice(-3).join(',')}|${d.turns}`
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
