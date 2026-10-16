# Skill Radar

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE) [![Claude Code 2.1.287+](https://img.shields.io/badge/Claude%20Code-2.1.287%2B%20mod-d97757.svg)](https://claude.com/blog/claude-code-mods)

**A Claude Code mod that keeps every slash command and skill you have installed in a pane, re-ranked live by what you are working on.** Press a row and it lands in the prompt box with its arguments as placeholders. You stop forgetting the skills you installed.

```
╭ Skill Radar · frontend · design · Hero.tsx ────────────────╮
│ haiku re-ranked · 14 of 31 · +17 folded (a)                  │
│                                                              │
│ DESIGN-KIT                                                   │
│  1: /frontend-design        Distinctive, intentional visual… │
│  2: /a11y-audit <path>      Accessibility pass over compone… │
│ YOUR COMMANDS                                                │
│  3: /deploy [env]           Ship the service to staging or … │
│  4: /tf-plan                Run terraform plan for an AWS e… │
│ CONTENT-KIT                                                  │
│  5: /weekly-posts [week]    Draft the week's posts and capt… │
│                                                              │
│ r: refresh  f: flat  b: built-in  a: all  x: close  Esc → prompt │
╰──────────────────────────────────────────────────────────────╯
```

Every number in the ranking comes from events in your own session. The one model call per turn (optional) runs on your plan or API key. Nothing leaves your machine otherwise.

[Install](#install) · [Use](#use) · [How the ranking works](#how-the-ranking-works) · [Make Claude use skills on its own](#make-claude-use-skills-on-its-own) · [Configure](#configure) · [What it can reach](#what-it-can-reach) · [Develop](#develop) · [Troubleshooting](#troubleshooting)

## Install

Inside Claude Code (2.1.287 or later), at the prompt of a terminal session:

```
/plugin install skill-radar --marketplace brandonp99/skill-radar
```

Answer `y` to add the marketplace, pick the user scope, accept the defaults on the options screen (or change them; [`/config`](#configure) changes them later). Then:

```
/radar
```

From a shell instead:

```
claude plugin install skill-radar --marketplace brandonp99/skill-radar
```

In the Claude desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `brandonp99/skill-radar`, then **Add plugin**. A mod installed from a terminal at the user scope loads in the desktop app's Code tab too.

Or load it straight from a clone, for one session:

```
git clone https://github.com/brandonp99/skill-radar
claude --plugin-dir ./skill-radar
```

## Use

| Command | Does |
| --- | --- |
| `/radar` | open the pane (it also opens by itself at session start in a terminal 144 columns or wider) |
| `/radar close` | close it |
| `/radar refresh` | re-read the command list and re-rank now |
| `/radar flat` | toggle between grouped and one flat list |
| `/radar builtins` | toggle Claude Code's own commands (`/compact`, `/clear`, …) |
| `/radar all` | toggle the row limit and hidden commands |

**Pressing a row.** Click it, or focus the pane with `ctrl+x tab` and press its digit (`1`–`9`) or Tab to it and press Enter. The prompt box then holds `/command`, with the argument hint after it painted dim and italic as a placeholder, like `/deploy [env]`. Press **Esc** to move the cursor back to the prompt, replace the placeholder, and press Enter. On the desktop app, click the prompt box instead of Esc.

The footer buttons work the same way: `r` refresh, `f` flat or grouped, `b` built-ins, `a` all, `x` close.

**Where the pane sits.** In a fullscreen terminal 110 columns or wider it docks beside the transcript. Narrower, or on the main screen, it sits above the prompt. In the desktop app it is a pane in the Code tab.

## How the ranking works

Two layers, both from your own session:

1. **Heuristic, always on, free.** Each command gets domain and keyword tags from its name, description and hint (`frontend`, `infra`, `tests`, `git`, …, plus the words themselves). The session's activity builds the same kind of tags, weighted and decaying:

   | Signal | Weight |
   | --- | --- |
   | your prompt | 3 per tag, plus a bonus for each word your prompt and a command's description share |
   | a file Claude edits or writes | 1.2 |
   | a file Claude reads | 0.6 |
   | a shell command's first words | 0.8 |
   | Claude's answer | 1.5 |
   | every turn | all weights × 0.6 |

   A command's score is the weight of every tag it shares. A command or skill used this turn or last drops by `usedPenalty` (default 30%), since you have already applied it. Groups are ordered by their best row.

2. **Hybrid, on by default, one small model call per turn.** After each main-loop turn, the digest and the visible commands go to `rankModel` (default `haiku`) with `effort: low`, asking for the twelve most relevant names as JSON. Those get a bonus on top of the heuristic, so the list stays responsive mid-turn while the model's judgement holds the top. The call is skipped while the digest has not changed, and the header says `haiku ranking…`, `haiku re-ranked`, or `last rank failed: …`. Set `rankMode` to `heuristic` for zero model calls.

The header's `ranked for` line names the two strongest domains and the latest file.

## Make Claude use skills on its own

The pane fixes *you* forgetting. Two options fix *Claude* forgetting:

- **`nudge`** (off by default): on each prompt that says something about the work, Skill Radar appends a line only Claude reads, naming up to three installed skills that look relevant and asking it to use one via the Skill tool if it fits. A prompt like `hello` or `continue` gets none. This is the setting that makes Claude reach for `/frontend-design` while it builds your front end instead of after you remember to ask.
- **`suggest`** (off by default): after each turn, the top command is proposed as the dim Tab-to-accept suggestion in the prompt box.

Both cost a few tokens per prompt or turn. Turn them on in `/config`.

## Configure

In `/config`, or under `pluginConfigs["skill-radar"].options` in `settings.json`:

| Option | Default | Meaning |
| --- | --- | --- |
| `openOnStart` | `true` | open the pane when a session starts (unasked panes only seat from 144 columns; `/radar` opens at any width) |
| `includeBuiltins` | `false` | list Claude Code's own commands too; `b` toggles it per session |
| `groupBy` | `plugin` | `plugin`, `source` (plugins / your commands / MCP / built-in), or `flat` |
| `rankMode` | `hybrid` | `hybrid` or `heuristic` |
| `rankModel` | `haiku` | model alias or id for the re-rank |
| `maxRows` | `30` | rows before the rest folds; `a` toggles it |
| `usedPenalty` | `0.3` | how far a used command drops, 0 to 1 |
| `nudge` | `false` | tell Claude which skills look relevant, on each prompt |
| `suggest` | `false` | propose the top command after each turn |
| `band` | `false` | also draw the top three as `1`/`2`/`3` buttons above the prompt; a digit typed alone into an empty prompt presses one |

## What it can reach

A mod runs inside Claude Code with your permissions, so here is exactly what this one does. `claude plugin validate .` prints the same list from the source:

| It calls | For |
| --- | --- |
| `$.command.list` | the commands and skills to show |
| `$.state` | the inventory, the activity digest, the ranking and the view, for the session |
| `$.prompt.fill`, `$.prompt.suggest` | putting a command in the prompt box |
| `$.model.complete` | the hybrid re-rank (off under `rankMode: heuristic`) |
| `$.fs.list`, `$.fs.read` | reading `argument-hint:` from the frontmatter of your own skills and commands under `~/.claude` and `./.claude`; nothing else is read |
| `$.env.get("HOME")` | finding `~/.claude` |
| `$.session.cwd` | finding `./.claude` |
| `$.ui.open`, `$.ui.close`, `$.ui.toast`, `$.ui.invalidate`, `$.ui.resolve` | the pane |
| `$.clock.after`, `$.clock.now` | debouncing re-scores and scheduling the re-rank |

| It sees | Through |
| --- | --- |
| each tool call's name and file path or command, main loop only | `tool.call` |
| your prompts, first 600 characters | `prompt.submit` |
| Claude's answers, first 2,000 characters, main loop only | `turn.complete` |
| which skill was expanded | `skill.prompt` |
| each command's hint and hidden flag | `command.describe` |

It never denies, rewrites or delays a tool call. The only thing it ever changes is the prompt box when you press a row, and, with `nudge` on, one line of context appended for Claude. It makes no network requests of its own, starts no processes, writes no files and keeps nothing across sessions.

## Develop

```
claude --plugin-dir .            # load it; edits hot-reload at the end of each turn
claude plugin validate .         # what it hooks and calls, and anything the engine would refuse
claude plugin test .             # 16 tests against the real runtime, no sign-in needed
npx -p typescript tsc -p .       # after the first load, which writes .claude-plugin/types/
```

The code is split so that one file owns every call outside the module:

| File | Holds |
| --- | --- |
| `hooks/register.ts` | every hook, and every `$` call |
| `hooks/activity.ts` | the domain vocabulary, tags from paths, commands and text, the digest and its decay |
| `hooks/inventory.ts` | the command list as entries, grouping, the fill text |
| `hooks/rank.ts` | the heuristic score, the model prompt and reply parsing, the blend |
| `hooks/pane.ts` | state in, element tree out |
| `hooks/state.ts`, `hooks/config.ts` | defaults, normalizers, the manifest options |
| `types/index.d.ts` | the state contract `claude plugin validate` checks |
| `tests/` | pure tests of each piece, and the pane driven through the engine on terminal and desktop |

Mods are an early-access Claude Code feature and their API can change between releases. This version was built and tested against Claude Code 2.1.299. The declarations Claude Code writes into `.claude-plugin/types/` on load are the authority for your build.

## Troubleshooting

**The pane does not appear.** Check `claude --version` is 2.1.287 or later, run `/reload-plugins`, then `/radar`. Below 144 columns Claude Code will not seat a pane nobody asked for; `/radar` opens it at any width. If a row refuses to draw, the transcript (under `--plugin-dir`) or `claude --debug` carries a dim line starting `skill-radar:` with the reason.

**A press does nothing in my terminal.** Clicks need mouse reporting, which most terminals have on. Focus the pane with `ctrl+x tab` and use the digits instead.

**A command has no placeholder.** Hints come from the engine describing each command for the typeahead, and from `argument-hint:` in the frontmatter of your own skills and commands. A plugin's command that declares no hint shows none. Typing `/` once makes the engine describe every command, after which `/radar refresh` picks up any it missed.

**The order looks wrong.** The heuristic only knows the words in a command's description. A skill described as "Guidance for building things" matches nothing; give it a description that names its domain. Hybrid mode fixes most of this after the first turn.

**`last rank failed: rate_limit`** in the header: the re-rank waits for the next turn. Set `rankMode` to `heuristic` to stop the calls altogether.

**Inside an organization that manages Claude Code**, the `skill.prompt` and `classic.SessionStart` hooks of a user-installed mod are skipped, so "used" tracking and the rebuild after `/clear` depend on the other hooks. Everything else runs.

## License

[MIT](./LICENSE)
