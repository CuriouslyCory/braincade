# Robot Reader

A handwriting game: the learner copies a silly sentence onto paper, snaps a photo, and a robot reads
it back. Words it can't read come out as wobbly gibberish ("snorfoodle"), which the robot also says
out loud. Three sentences per session.

- Needs the `camera` and `handwriting` capabilities. Speech is optional (Hear it, robot read-back).
- Sentences come from `ctx.words.next({ tags: ['silly-sentence'] })`, i.e.
  `packages/content/word-lists/grade-5-silly-sentences.json`. Each entry's `word` is the spelling
  target highlighted in the sentence.
- One attempt is recorded per sentence, for the target word, when the learner moves on:
  `correct` only if the robot read that word clearly and it was spelled right; `response` is what it
  read there (the gibberish if unreadable, empty if missing). Retakes replace the earlier reading.
- Score = words read correctly across the session (latest photo per sentence).

## Code

| File               | What it does                                                                          |
| ------------------ | ------------------------------------------------------------------------------------- |
| `src/Game.tsx`     | Screens: intro → prompt → reading → result (× 3) → score                              |
| `src/compare.ts`   | Word normalization and edit-distance alignment of sentence vs. reading (pure, tested) |
| `src/gibberish.ts` | Deterministic made-up words with a blocklist (pure, tested)                           |
| `src/robot.ts`     | Read-back text, the robot's verdict, and the attempt to record (pure, tested)         |
| `src/game.css`     | Styles; the top-left 60×60 px stays clear for the host's exit button                  |

## Test ids (for e2e)

`intro`, `prompt-sentence` (target word in `<mark>`), `sentence-progress`, `robot-thinking`,
`read-error`, `robot-reading` (unreadable words have class `gibberish`), `verdict`, `comparison`
(each `li` has `data-status`), `score-summary`, `no-sentences`. Buttons: Start, Hear it,
Snap my writing, Try again, Retake, Hear the robot, Next sentence, See my score, Finish.

```sh
pnpm dev                                                  # play it in the launcher
pnpm turbo run test typecheck --filter=@braincade/game-robot-reader
```
