# __GAME_TITLE__

A Braincade game (React). See the repo README for the full workflow.

- `src/index.ts` mounts the game and returns a cleanup function.
- `src/Game.tsx` is the starter screen. Replace it with the real game.
- `package.json` → `braincade` is the manifest: title, icon, skills, required capabilities, status.

```sh
pnpm dev                                                  # play it in the launcher
pnpm turbo run test typecheck --filter=@braincade/game-__GAME_ID__
```

Use `ctx` for everything platform-specific (words, speech, printing, storage) so the game works the
same in the browser and in the mobile app.
