import { z } from 'zod';

/**
 * Host features a game can use. A game lists the ones it cannot run without in
 * `requires`; launchers hide or disable games whose requirements the current
 * platform does not provide. `camera` and `handwriting` are reserved for the
 * photo/handwriting ideas and are not implemented by any host yet.
 */
export const CAPABILITIES = ['storage', 'speech', 'print', 'camera', 'handwriting'] as const;
export const capabilitySchema = z.enum(CAPABILITIES);
export type Capability = z.infer<typeof capabilitySchema>;

export const SKILLS = [
  'spelling',
  'handwriting',
  'typing',
  'reading',
  'vocabulary',
  'listening',
] as const;
export const skillSchema = z.enum(SKILLS);
export type Skill = z.infer<typeof skillSchema>;

export const GAME_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** The `braincade` field of a game's package.json. */
export const gameManifestSchema = z.object({
  id: z.string().regex(GAME_ID_PATTERN, 'id must be kebab-case'),
  title: z.string().min(1).max(60),
  description: z.string().min(1).max(300),
  /** A single emoji shown on the launcher card. */
  icon: z.string().min(1).max(16).default('🎮'),
  engine: z.enum(['dom', 'three']),
  skills: z.array(skillSchema).min(1),
  requires: z.array(capabilitySchema).default([]),
  /** draft: only shown when "show drafts" is on. retired: kept in the repo, hidden everywhere. */
  status: z.enum(['draft', 'published', 'retired']).default('draft'),
});

export const catalogGameSchema = gameManifestSchema.extend({
  version: z.string().regex(SEMVER_PATTERN, 'version must be semver'),
});

export type GameManifestInput = z.input<typeof gameManifestSchema>;
/** A validated manifest plus the version from package.json. */
export type GameManifest = z.infer<typeof catalogGameSchema>;

/** Build a manifest from a game's package.json contents. Throws with a readable message. */
export function manifestFromPackageJson(pkg: unknown): GameManifest {
  const shape = z.object({ version: z.unknown(), braincade: z.record(z.string(), z.unknown()) });
  const parsed = shape.safeParse(pkg);
  if (!parsed.success) throw new Error('package.json is missing a "braincade" manifest field');
  const result = catalogGameSchema.safeParse({
    ...parsed.data.braincade,
    version: parsed.data.version,
  });
  if (!result.success) throw new Error(z.prettifyError(result.error));
  return result.data;
}

export function missingCapabilities(
  manifest: Pick<GameManifest, 'requires'>,
  available: readonly Capability[],
): Capability[] {
  return manifest.requires.filter((c) => !available.includes(c));
}

/** Whether a launcher should list this game. */
export function isListed(manifest: Pick<GameManifest, 'status'>, showDrafts: boolean): boolean {
  if (manifest.status === 'retired') return false;
  return manifest.status === 'published' || showDrafts;
}
