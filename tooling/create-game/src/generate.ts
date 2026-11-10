import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATES = ['react', 'three'] as const;
export type Template = (typeof TEMPLATES)[number];

// Mirrors SKILLS and GAME_ID_PATTERN in @braincade/game-sdk (a test keeps them in sync).
// Duplicated because this CLI runs on plain Node without a TS bundler.
export const SKILLS = ['spelling', 'handwriting', 'typing', 'reading', 'vocabulary', 'listening'];
export const GAME_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const templatesDir = fileURLToPath(new URL('../templates', import.meta.url));

export interface GenerateOptions {
  id: string;
  template: Template;
  gamesDir: string;
  title?: string;
  description?: string;
  icon?: string;
  skills?: string[];
}

export function titleFromId(id: string): string {
  return id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
  });
}

/** Copy a template into games/<id>, filling in names and the braincade manifest. */
export function generateGame(options: GenerateOptions): { dir: string; files: string[] } {
  const { id, template, gamesDir } = options;
  if (!GAME_ID_PATTERN.test(id)) {
    throw new Error(`Game id "${id}" must be kebab-case, e.g. "spell-race".`);
  }
  if (!TEMPLATES.includes(template)) {
    throw new Error(`Unknown template "${template}". Use one of: ${TEMPLATES.join(', ')}.`);
  }
  const skills = options.skills ?? ['spelling'];
  const unknown = skills.filter((s) => !SKILLS.includes(s));
  if (unknown.length || skills.length === 0) {
    throw new Error(
      `Unknown skills: ${unknown.join(', ') || '(none)'}. Use: ${SKILLS.join(', ')}.`,
    );
  }
  const dir = path.join(gamesDir, id);
  if (existsSync(dir)) throw new Error(`${dir} already exists.`);

  const title = options.title ?? titleFromId(id);
  const description = options.description ?? `TODO: describe ${title}.`;
  const replacements: Record<string, string> = {
    __GAME_ID__: id,
    __GAME_TITLE__: title,
  };

  const source = path.join(templatesDir, template);
  cpSync(source, dir, { recursive: true });
  const files = listFiles(dir);
  for (const file of files) {
    const full = path.join(dir, file);
    let text = readFileSync(full, 'utf8');
    for (const [token, value] of Object.entries(replacements)) text = text.replaceAll(token, value);
    if (file === 'package.json') {
      const pkg = JSON.parse(text) as Record<string, unknown> & {
        braincade: Record<string, unknown>;
      };
      pkg.name = `@braincade/game-${id}`;
      pkg.braincade = {
        ...pkg.braincade,
        id,
        title,
        description,
        icon: options.icon ?? (template === 'three' ? '🚀' : '🎮'),
        skills,
        status: 'draft',
      };
      text = `${JSON.stringify(pkg, null, 2)}\n`;
    }
    writeFileSync(full, text);
  }
  return { dir, files: files.sort() };
}
