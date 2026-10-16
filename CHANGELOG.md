# Changelog

## 0.1.0

First release. Tested with Claude Code 2.1.299.

- A `/radar` pane listing every installed slash command and skill, grouped by plugin (or source, or flat).
- Rows are pressable: a press fills the prompt box with `/command` and its argument hint painted as a placeholder.
- Live re-ranking from the files Claude touches, your prompts, Claude's answers and which skills were already used, with a decay per turn.
- Optional hybrid ranking: one small model call after each turn re-ranks the top of the list; skipped while nothing has changed.
- Argument hints from `command.describe` and from the frontmatter of your own skills and commands.
- Optional nudge mode: on each prompt, Claude is told which installed skills look relevant.
- Optional dim Tab-to-accept suggestion after each turn, and an optional 1/2/3 band above the prompt.
