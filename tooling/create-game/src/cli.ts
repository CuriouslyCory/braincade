#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { generateGame, SKILLS, TEMPLATES, type Template } from './generate.ts';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

const usage = `Usage: pnpm new:game <id> [options]

Creates games/<id> from a template as a draft game.

Options:
  --template <name>     ${TEMPLATES.join(' | ')} (default: react)
  --title <text>        Launcher title (default: from id)
  --description <text>  One-line description
  --icon <emoji>        Launcher icon
  --skills <list>       Comma-separated: ${SKILLS.join(', ')} (default: spelling)
  --no-install          Skip pnpm install
  -h, --help            Show this help`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    template: { type: 'string', default: 'react' },
    title: { type: 'string' },
    description: { type: 'string' },
    icon: { type: 'string' },
    skills: { type: 'string' },
    'no-install': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const id = positionals[0];
if (values.help || !id) {
  console.log(usage);
  process.exit(values.help ? 0 : 1);
}

try {
  const { dir, files } = generateGame({
    id,
    template: values.template as Template,
    gamesDir: path.join(repoRoot, 'games'),
    ...(values.title ? { title: values.title } : {}),
    ...(values.description ? { description: values.description } : {}),
    ...(values.icon ? { icon: values.icon } : {}),
    ...(values.skills ? { skills: values.skills.split(',').map((s) => s.trim()) } : {}),
  });
  console.log(`Created ${path.relative(repoRoot, dir)}/`);
  for (const file of files) console.log(`  ${file}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

if (!values['no-install']) {
  const result = spawnSync('pnpm', ['install'], { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`
Next:
  pnpm dev                       # launcher at http://localhost:5173 (drafts show in dev)
  pnpm turbo run test --filter=@braincade/game-${id}
  Set "status": "published" in games/${id}/package.json when it is ready.`);
