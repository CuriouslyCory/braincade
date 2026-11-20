# Robot Reader

A handwriting game: the learner copies a silly sentence onto paper, snaps a photo, and a robot reads
it back. Words it can't read come out as wobbly gibberish ("snorfoodle"), which the robot also says
out loud. Three sentences per session.

- Needs the `camera` and `handwriting` capabilities. Speech is optional (Hear it, robot read-back).
- Sentences come from `ctx.words.next({ tags: ['silly-sentence'] })`, i.e.
  `packages/content/word-lists/grade-5-silly-sentences.json`. Each entry's `word` is the spelling
  target highlighted in the sentence.
- At most one attempt is recorded per sentence, for the target word, when the learner moves on, and
  only if the robot could read that word: `correct` when it was spelled right, otherwise `response`
  is the misspelling. An unreadable or missing target word records nothing (that's handwriting or
  copying, not spelling), and gibberish is never saved. Retakes replace the earlier reading. If the
  host can't save an attempt, the game keeps it and sends it again with the next one and on Finish.
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
