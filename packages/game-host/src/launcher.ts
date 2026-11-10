import {
  type Capability,
  type GameManifest,
  isListed,
  missingCapabilities,
} from '@braincade/game-sdk';

export interface LauncherEntry {
  manifest: GameManifest;
  /** Capabilities this device lacks; the game cannot be launched when non-empty. */
  missing: Capability[];
}

/** Games to show on the launcher: playable first, then alphabetical. */
export function launcherEntries(
  games: readonly { manifest: GameManifest }[],
  { showDrafts, capabilities }: { showDrafts: boolean; capabilities: readonly Capability[] },
): LauncherEntry[] {
  return games
    .filter((g) => isListed(g.manifest, showDrafts))
    .map((g) => ({ manifest: g.manifest, missing: missingCapabilities(g.manifest, capabilities) }))
    .sort(
      (a, b) =>
        Number(a.missing.length > 0) - Number(b.missing.length > 0) ||
        a.manifest.title.localeCompare(b.manifest.title),
    );
}
