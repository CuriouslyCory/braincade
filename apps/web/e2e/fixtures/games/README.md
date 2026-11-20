Test-only games, included when `BRAINCADE_E2E_FIXTURES=1` (the `build:e2e` script).
They exercise the host bridge end to end and are never part of a real build.

- `bridge-check` calls every host capability that needs no hardware or server.
- `needs-handwriting` requires `handwriting`. The e2e preview server has no
  `/api/handwriting`, so the launcher must show it as disabled.
