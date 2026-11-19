import { z } from 'zod';

export const wordEntrySchema = z.object({
  word: z.string().trim().min(1).max(60),
  /** Example sentence a game can read aloud ("Spell 'their'. It is their dog."). */
  sentence: z.string().max(300).optional(),
  /** Free-form pattern tags, e.g. "homophone", "suffix-ed", "silent-e", "science". */
  tags: z.array(z.string().min(1).max(40)).default([]),
});

export const wordListSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'kebab-case id'),
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  words: z.array(wordEntrySchema).min(1),
});

export type WordEntry = z.infer<typeof wordEntrySchema>;
export type WordList = z.infer<typeof wordListSchema>;
export type WordListInput = z.input<typeof wordListSchema>;

/** Mastery is tracked per word regardless of which list it came from. */
export function wordKey(word: string): string {
  return word.trim().toLowerCase();
}

export interface PooledWord extends WordEntry {
  key: string;
  listId: string;
}

/** Flatten lists into one pool, merging duplicate words (tags are unioned). */
export function poolWords(lists: readonly WordList[]): PooledWord[] {
  const byKey = new Map<string, PooledWord>();
  for (const list of lists) {
    for (const entry of list.words) {
      const key = wordKey(entry.word);
      const existing = byKey.get(key);
      if (existing) {
        existing.tags = [...new Set([...existing.tags, ...entry.tags])];
        existing.sentence ??= entry.sentence;
      } else {
        byKey.set(key, { ...entry, tags: [...entry.tags], key, listId: list.id });
      }
    }
  }
  return [...byKey.values()];
}
