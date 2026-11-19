# __GAME_TITLE__

A Braincade game (three.js). See the repo README for the full workflow.

- `src/index.ts` sets up the renderer, overlay, resize and pause handling, and cleanup.
- `src/world.ts` holds the scene graph and per-frame logic (unit-testable without WebGL).
- `package.json` → `braincade` is the manifest: title, icon, skills, required capabilities, status.

```sh
pnpm dev                                                  # play it in the launcher
pnpm turbo run test typecheck --filter=@braincade/game-__GAME_ID__
```

Use `ctx` for everything platform-specific (words, speech, printing, storage) so the game works the
same in the browser and in the mobile app.
