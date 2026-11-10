import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GAME_ID_PATTERN, manifestFromPackageJson, SKILLS } from '@braincade/game-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as generator from './generate.ts';

let gamesDir: string;

beforeEach(() => {
  gamesDir = mkdtempSync(path.join(tmpdir(), 'braincade-new-game-'));
});

afterEach(() => {
  rmSync(gamesDir, { recursive: true, force: true });
});

describe('generateGame', () => {
  it.each(generator.TEMPLATES)('creates a valid draft game from the %s template', (template) => {
    const { dir, files } = generator.generateGame({
      id: 'spell-race',
      template,
      gamesDir,
      description: 'Hear it, type it, win.',
      skills: ['spelling', 'typing'],
    });

    expect(files).toContain('package.json');
    expect(files).toContain(path.join('src', 'index.ts'));
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('@braincade/game-spell-race');
    expect(manifestFromPackageJson(pkg)).toMatchObject({
      id: 'spell-race',
      title: 'Spell Race',
      description: 'Hear it, type it, win.',
      engine: template === 'three' ? 'three' : 'dom',
      skills: ['spelling', 'typing'],
      status: 'draft',
      version: '0.1.0',
    });

    for (const file of files) {
      const text = readFileSync(path.join(dir, file), 'utf8');
      expect(text, file).not.toMatch(/GAME_(ID|TITLE)/);
    }
    expect(readFileSync(path.join(dir, 'README.md'), 'utf8')).toContain('# Spell Race');
  });

  it('refuses invalid ids, unknown skills, and existing folders', () => {
    const base = { template: 'react' as const, gamesDir };
    expect(() => generator.generateGame({ ...base, id: 'Spell Race' })).toThrow(/kebab-case/);
    expect(() => generator.generateGame({ ...base, id: 'x', skills: ['juggling'] })).toThrow(
      /Unknown skills/,
    );
    generator.generateGame({ ...base, id: 'taken' });
    expect(() => generator.generateGame({ ...base, id: 'taken' })).toThrow(/already exists/);
    expect(existsSync(path.join(gamesDir, 'x'))).toBe(false);
  });

  it('stays in sync with the SDK manifest rules', () => {
    expect(generator.SKILLS).toEqual([...SKILLS]);
    expect(generator.GAME_ID_PATTERN.source).toBe(GAME_ID_PATTERN.source);
  });

  it('derives titles from ids', () => {
    expect(generator.titleFromId('beat-the-robot')).toBe('Beat The Robot');
  });
});
