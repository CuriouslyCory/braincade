# Braincade

Small learning games for spelling and handwriting practice, built so a new game idea can go from
`pnpm new:game` to a phone in one afternoon, and so existing games get harder as the learner
improves without anyone rewriting them.

One Turborepo holds:

- a **web app** (Vite + React) that runs on the laptop, and is also what gets deployed to Vercel,
- an **iOS/Android app** (Expo) that runs the same games,
- a **game SDK** and **host bridge** that every game uses for words, speech, printing, and saves,
- a **learning engine** that tracks which words the learner has mastered and picks what to practice,
- a **printables** renderer for worksheets (rematch sheets, comic panels, cipher boxes, graph paper).

There are no games yet. The next step is creating the first one (see [Creating a game](#creating-a-game)).

## Quick start

Requirements: Node 26 (see `.nvmrc`; ≥ 24 works) and pnpm 12 (`npm i -g pnpm@12`).

```sh
pnpm install
pnpm dev            # web launcher on http://localhost:5173 (also on your LAN IP)
pnpm dev:mobile     # Expo; scan the QR code with Expo Go on the phone
```

The phone and the computer need to be on the same Wi-Fi network. In development the mobile app loads
games from the web dev server on the computer running Metro, so run `pnpm dev` too.

| Command                     | What it does                                                             |
| --------------------------- | ------------------------------------------------------------------------ |
| `pnpm new:game <id>`        | Create a game from a template (see below)                                |
| `pnpm check`                | Lint, typecheck, unit tests, and builds (what CI's main job runs)        |
| `pnpm e2e`                  | Playwright tests against a production build, desktop and phone viewports |
| `pnpm lint` / `pnpm format` | Biome check / fix                                                        |

## Architecture

```
┌──────────────── web app (React) ───────────────┐   ┌──────── mobile app (Expo) ───────┐
│ launcher · grown-ups page · host bridge        │   │ launcher · settings · host bridge│
│        │ postMessage                           │   │        │ injectJavaScript /       │
│        ▼                                       │   │        ▼ onMessage                │
│  <iframe src="play.html?game=…">               │   │  <WebView src="…/play.html?game=…">
└────────┼───────────────────────────────────────┘   └────────┼─────────────────────────┘
         └──────────────┬──────────────────────────────────────┘
                        ▼
          play.html → bootFrame → games/<id>/src/index.ts  (defineGame → mount(root, ctx))
```

The main design decisions:

1. **Every game is web code, and runs in a frame.** On the web, a game runs in an iframe. On the phone,
   the same `play.html` runs in a WebView loaded from the deployed web app. You write one game and it
   runs on both platforms. Each launch gets a fresh frame, so three.js contexts, timers, and memory are
   released when the game exits. That matters when switching between several WebGL games on a phone.
2. **Games only talk to the host through `ctx`.** Words, speech, printing, saved data, and progress
   all go over a small validated message protocol (`packages/game-sdk/src/protocol.ts`). The host
   implements each capability natively: Web Speech or `expo-speech`, the browser print dialog or
   `expo-print`, localStorage or AsyncStorage. Games behave the same everywhere, and learner data stays
   with the host, not with each game.
3. **Content and difficulty are separate from game code.** A game asks `ctx.words.next()` and the
   learning engine decides which words come back: missed and due words first, mastered words only
   for occasional review. Adding this week's spelling words, or tagged harder words, changes what every
   game practices without touching any game.
4. **Publishing is a web deploy.** The web build emits `catalog.json` (game manifests and word
   lists). The mobile app reads it on launch, so a merged game reaches the phone without an app store
   release. The app store build only changes when the native shell changes.
5. **Capabilities are negotiated.** A game lists what it can't run without (`requires: ["speech"]`).
   Launchers disable games that the device can't support. That leaves room for future capabilities
   like `camera` and `handwriting` without breaking older hosts.

### Repository layout

| Path                  | Package                  | Purpose                                                                                                |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `apps/web`            | `@braincade/web`         | Launcher, grown-ups page, `play.html` frame, Vite plugin that discovers games and emits `catalog.json` |
| `apps/mobile`         | `@braincade/mobile`      | Expo Router app: launcher, WebView player, settings, native capabilities                               |
| `games/*`             | `@braincade/game-<id>`   | One package per game (empty for now)                                                                   |
| `packages/game-sdk`   | `@braincade/game-sdk`    | `defineGame`, `GameContext`, manifest schema, protocol, transports, `bootFrame`, test helpers          |
| `packages/game-host`  | `@braincade/game-host`   | Host side of the protocol, shared by web and mobile; catalog schema; launcher filtering                |
| `packages/learning`   | `@braincade/learning`    | Word lists, Leitner mastery engine, learner repository over any key-value store                        |
| `packages/printables` | `@braincade/printables`  | Worksheet document model and HTML renderer used by both print paths                                    |
| `packages/content`    | `@braincade/content`     | Word lists as JSON, validated in CI                                                                    |
| `tooling/create-game` | `@braincade/create-game` | `pnpm new:game` and the `react` / `three` templates                                                    |
| `tooling/tsconfig`    | `@braincade/tsconfig`    | Shared TypeScript configs                                                                              |

Internal packages export TypeScript source directly (no build step). Vite and Metro compile them.

## Creating a game

```sh
pnpm new:game spell-race --template react --title "Spell Race" --skills spelling,typing
pnpm new:game word-blaster --template three --icon 🚀
```

This creates `games/<id>/` as a **draft**, runs `pnpm install`, and the launcher picks it up
automatically. There's no registry to edit. In `pnpm dev`, drafts show on the launcher.

- `react` template: a DOM/React game with a starter screen that uses words, speech, and progress.
- `three` template: a three.js renderer with resize handling, pause/resume, cleanup, an HTML overlay,
  and `world.ts` holding the scene so it can be unit-tested without WebGL.

A game is a package with two required parts.

**The manifest**, the `braincade` field in `package.json`:

```jsonc
"version": "0.1.0",                  // the game's version, from package.json
"braincade": {
  "id": "spell-race",                // must match the folder name
  "title": "Spell Race",
  "description": "Hear a word, type it, win the race.",
  "icon": "🏁",
  "engine": "dom",                   // "dom" | "three"
  "skills": ["spelling", "typing"],  // spelling, handwriting, typing, reading, vocabulary, listening
  "requires": ["speech"],            // storage, speech, print, camera, handwriting
  "status": "draft"                  // draft | published | retired
}
```

**The entry**, `src/index.ts`:

```ts
import { defineGame } from '@braincade/game-sdk';

export default defineGame({
  async mount(root, ctx) {
    const words = await ctx.words.next({ count: 10, tags: ['homophone'] });
    await ctx.speech.speak(words[0].sentence ?? words[0].word, { rate: 0.8 });
    await ctx.progress.record({
      word: words[0].word,
      correct: false,
      mode: 'typed',
      response: 'thier',
    });
    // …render into root…
    return () => {
      /* stop loops, dispose WebGL, remove listeners */
    };
  },
});
```

### The `ctx` API

| Member                                             | Use                                                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ctx.words.next({ count, tags, includeMastered })` | Words to practice, ordered by need. Each has `word`, `sentence`, `tags`, `status` (`new`/`learning`/`mastered`)  |
| `ctx.progress.record(attempt \| attempts[])`       | Report answers (`word`, `correct`, `mode`, `response`). This drives mastery, rematch sheets, and session history |
| `ctx.speech.speak(text, { rate })` / `stop()`      | Text-to-speech                                                                                                   |
| `ctx.print(document)`                              | Print a worksheet built from `printables` blocks                                                                 |
| `ctx.storage.get/set(key, value)`                  | JSON save data scoped to this game                                                                               |
| `ctx.on('pause' \| 'resume', fn)`                  | App backgrounded or tab hidden                                                                                   |
| `ctx.session`                                      | Learner name and interests (for theming), platform, capabilities                                                 |
| `ctx.has(capability)`                              | Check before using optional features                                                                             |
| `ctx.exit({ score })`                              | End the session and return to the launcher                                                                       |

Keep the top-left 60×60 px of the screen clear: both hosts draw an exit button there.

### Testing a game

`@braincade/game-sdk/testing` provides `createTestContext()`, an in-memory `ctx` that records what the
game said, printed, saved, and scored:

```ts
const t = createTestContext({ words: ['their', 'there'] });
render(<Game ctx={t.ctx} />);
// …interact…
expect(t.attempts).toEqual([...]);
expect(t.spoken).toEqual(['their']);
```

You don't need to write browser tests for a new game. `apps/web/e2e/all-games.spec.ts` opens every
game in the catalog, waits for it to report ready, and exits it. CI also generates a game from each
template on every run, so template regressions get caught.

## Publishing and updating

| Step                           | How                                                                                                                                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Try it                         | `pnpm dev`, then open the launcher on the laptop, or on the phone via Expo Go                                                                                                                                  |
| Test it on the phone from a PR | Open the Vercel preview URL for the PR in the app's Grown-ups → Braincade URL field. Drafts show when "Show draft games" is on                                                                                 |
| Publish                        | Set `"status": "published"`, merge to `main`. Vercel deploys; the app sees it on its next catalog load                                                                                                         |
| Update                         | Change the game, then record a change intent: `pnpm change @braincade/game-<id> --bump minor --summary "Add level 3"`. Before release, `pnpm version -r` applies the pending intents (versions and changelogs) |
| Retire                         | Set `"status": "retired"`. The game stays in the repo but is hidden everywhere                                                                                                                                 |

Session history stores each game's version, so you can see which version a score came from.

## Content: word lists

Word lists live in `packages/content/word-lists/*.json` and get validated in CI (schema, unique
words, each sentence contains its word). There is a starter list of common grade-5 trouble words.
Replace it or add lists made from words he actually missed on assignments:

```json
{ "word": "their", "sentence": "The kids put on their coats.", "tags": ["homophone"] }
```

Tags (`homophone`, `suffix-ed`, `silent-letter`, `science`…) let a game focus on one pattern. Register
new files in `packages/content/src/index.ts` (a test fails if you forget). Lists ship in
`catalog.json`, so a deploy updates every device.

How words are chosen (`packages/learning/src/mastery.ts`): each word sits in a Leitner box. A correct
answer moves it up a box, and a miss drops it to box 1 for immediate practice. Box 5 means mastered,
and the word comes back for review after two weeks. The grown-ups page in the web app shows each
word's status, the last wrong answer, recent sessions, and a **Print rematch sheet** button for this
week's missed words.

## How the brainstormed ideas map onto the platform

| Idea                                              | Supported by                                                                                                               | Status                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Spelling game: hear a word, type it               | `speech`, `words.next`, `progress.record(mode: 'typed')`, mastery engine                                                   | Ready to build                  |
| Rematch sheet: write missed words 3×              | `word-practice` printable block, `missedWords()`, grown-ups print button                                                   | Working now                     |
| Comic strips with power words                     | `panel-grid` block (speech bubbles, captions), `words.next({ tags })` for power words                                      | Ready to build                  |
| Spy ciphers / cryptograms                         | `letter-boxes` block (box per letter, clue under it), on-screen version as a DOM game                                      | Ready to build                  |
| Graph-paper spelling                              | `graph-paper` block                                                                                                        | Ready to build                  |
| Board game with word cards                        | `panel-grid` with `cells` text for printable cards and board tiles                                                         | Ready to build                  |
| Story typer / typing races                        | React template plus `words.next`, `progress.record(mode: 'typed')`                                                         | Ready to build                  |
| Theme games around his interests                  | `ctx.session.learner.interests` (set on the grown-ups page)                                                                | Ready to build                  |
| "Beat the robot" / Google Lens scoring            | Show words and a printable scoresheet, then record results with `mode: 'handwritten'`. Recognition happens in the Lens app | Ready to build (manual scoring) |
| In-app photo of handwriting checked automatically | `camera` and `handwriting` capabilities are reserved in the manifest schema, but no host provides them yet                 | Planned                         |
| Photo word hunt                                   | Needs `camera`                                                                                                             | Planned                         |
| Finger-writing letters on the phone               | A canvas game works today. Automatic letter recognition needs `handwriting`                                                | Partially                       |

## Mobile app

- **Where games come from.** The app resolves the server in this order: the URL saved on its
  Grown-ups screen, then `EXPO_PUBLIC_BRAINCADE_URL`, then (in development only)
  `http://<computer running Metro>:5173`. Set `EXPO_PUBLIC_BRAINCADE_URL` to the Vercel production URL
  for real builds (in `eas.json` or the EAS environment).
- **Security.** The WebView only navigates within the server's origin and only accepts protocol
  messages. Games are first-party code.
- **Offline.** The catalog is cached, so the launcher still lists games offline, but games load from
  the server, so playing needs a connection. Bundling games into the app is on the roadmap.
- **Builds.** It runs in Expo Go during development: every native module it uses (WebView, speech,
  print, AsyncStorage) ships with Expo Go. For installable builds, run `eas init` once (it adds the
  project ID), then `eas build --profile preview --platform android` for an APK. The repo's `build`
  task runs `expo export` for both platforms, and `expo-doctor` passes.
- **Learner data is per device.** The phone and the laptop track mastery separately until the sync
  backend exists (see below). The grown-ups word table currently lives in the web app only.

## Deployment (Vercel)

`apps/web/vercel.json` holds the build setup. When creating the Vercel project:

- **Root Directory:** `apps/web`. Vercel uses the `installCommand`/`buildCommand` from `vercel.json`,
  which installs the pinned pnpm, runs `turbo run build --filter=@braincade/web`, and serves `dist/`.
- The output is static: `index.html` (launcher), `play.html` (game frame), `catalog.json`, and
  hashed assets. Hash routing means no rewrites are needed.
- `catalog.json` and the HTML pages are served with `must-revalidate`, so a deploy shows up on the
  next app launch, and the hashed assets are cached immutably.
- **Preview deployments** are how drafts get tested on the phone. If Vercel Deployment Protection
  is on for previews, the app can't fetch them. Either turn protection off for previews or turn on
  "Protection Bypass for Automation" and add support for it to the app.

## Testing and CI

`.github/workflows/ci.yml` runs on every PR:

1. **check:** Biome, then `turbo run typecheck test build` for every package, including the Expo
   bundle export.
2. **e2e:** Playwright against a production build that includes two fixture games
   (`apps/web/e2e/fixtures/games`). The tests cover the launcher, capability gating, a full session that
   uses every bridge method (words, progress, storage, print, exit), host-initiated exit with cleanup,
   the grown-ups page and rematch printing, and `catalog.json`. They run at desktop and phone viewports.
3. **templates:** generates a game from each template, typechecks and tests them, and boots both in
   the browser.

## Roadmap and known gaps

- **Cross-device sync on Neon.** Learner data already goes through the async `LearnerRepository`
  interface (`packages/learning/src/repository.ts`). The plan is an `apps/api` on Vercel Functions
  backed by Neon Postgres (profiles, attempts, sessions, game saves), and a repository
  implementation that writes locally first and syncs. The Neon–Vercel integration can create a Neon
  branch per preview deployment. The same backend would let the grown-ups page edit word lists
  instead of editing JSON in the repo.
- **Camera and handwriting capabilities** for the photo and finger-writing ideas.
- **Offline games on mobile:** ship a copy of the web build inside the app, and fall back to it when
  the server can't be reached.
- **Per-game difficulty settings** on the grown-ups page, passed to games in the session.
- **Mobile grown-ups word view** (the web version exists).
