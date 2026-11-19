# Braincade: notes for agents

Read README.md first; it explains the architecture and the game workflow.

## Commands

- `pnpm check`: lint, typecheck, unit tests, and builds. Run this before calling work done.
- `pnpm e2e`: Playwright (builds with fixture games into `apps/web/dist-e2e`).
- `pnpm new:game <id> --template react|three`: start a new game. Don't hand-copy another game.
- `pnpm turbo run test typecheck --filter=@braincade/game-<id>`: check one game.

## Rules for games (`games/<id>`)

- Use only `ctx` for platform features: words, speech, print, storage, progress, exit. Never call
  `localStorage`, `speechSynthesis`, `window.print`, or `fetch` for learner data directly. On mobile
  the game runs in a WebView, and the host owns these features.
- Report every answer with `ctx.progress.record`. Mastery, rematch sheets, and the grown-ups page
  depend on it.
- Get words from `ctx.words.next()` and never hard-code word lists in a game. Content belongs in
  `packages/content/word-lists`.
- `mount` must return a cleanup function that stops animation loops, removes listeners, and disposes
  three.js geometries, materials, and renderers.
- Keep the top-left 60×60 px clear; the host's exit button sits there.
- Unit-test with `createTestContext()` from `@braincade/game-sdk/testing`. Keep three.js scene logic in
  a renderer-free module so it can be tested in Node.
- New games start as `"status": "draft"`. Only set `published` when asked.
- Changing a game that is already published: record a change intent with
  `pnpm change @braincade/game-<id> --bump <patch|minor|major> --summary "..."`.

## Conventions

- Internal packages export TS source; there is no package build step.
- Shared dependency versions come from the pnpm `catalog:` in `pnpm-workspace.yaml`. `apps/mobile`
  pins its own versions; add native modules there with `npx expo install`.
- Protocol changes go in `packages/game-sdk/src/protocol.ts` (schemas and types) and
  `packages/game-host/src/bridge.ts` (handlers), with a test in `bridge.test.ts`.
- Biome formats Markdown too; template Markdown is excluded so `__GAME_TITLE__` tokens survive.
