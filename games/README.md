# games/

Each folder here is one game: a workspace package with a `braincade` manifest in its
`package.json` and a `src/index.ts` that default-exports `defineGame({...})`. The web app
discovers games automatically; nothing else needs registering.

Create one with:

```sh
pnpm new:game <id> [--template react|three] [--title "..."] [--skills spelling,typing]
```

See the root README for the full create → play → publish → update workflow.
