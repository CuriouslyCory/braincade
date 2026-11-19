/** Port of the web app's Vite dev server (apps/web). */
export const WEB_DEV_PORT = 5173;

const ORIGIN = /^(https?:\/\/[^/?#]+)/i;

export function originOf(url: string): string | null {
  return ORIGIN.exec(url.trim())?.[1]?.toLowerCase() ?? null;
}

export function isSameOrigin(url: string, baseUrl: string): boolean {
  const a = originOf(url);
  return a !== null && a === originOf(baseUrl);
}

/**
 * Where to load games from, in priority order: the URL saved in Grown-ups
 * settings, EXPO_PUBLIC_BRAINCADE_URL, then (in development) the web dev
 * server on the computer running Metro.
 */
export function resolveBaseUrl({
  override,
  envUrl,
  devHostUri,
}: {
  override?: string | null;
  envUrl?: string | null;
  devHostUri?: string | null;
}): string | null {
  for (const candidate of [override, envUrl]) {
    const value = candidate?.trim();
    if (value && originOf(value)) return value.replace(/\/+$/, '');
  }
  const host = devHostUri?.split(':')[0];
  return host ? `http://${host}:${WEB_DEV_PORT}` : null;
}
