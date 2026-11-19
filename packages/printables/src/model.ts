import { z } from 'zod';

/**
 * A printable document is plain data so a game running in a sandboxed frame can
 * describe a worksheet and let the host (browser print dialog, expo-print on
 * mobile) render it. Every block maps to one of the paper-based activities:
 * handwriting lines, rematch sheets, comic panels, cipher boxes, graph paper.
 */

const text = z.string().max(2000);

export const headingBlockSchema = z.object({
  type: z.literal('heading'),
  text: text,
  level: z.union([z.literal(1), z.literal(2)]).default(1),
});

export const textBlockSchema = z.object({
  type: z.literal('text'),
  text: text,
});

/** Handwriting lines with a dashed midline (or plain lines for `narrow`). */
export const writingLinesBlockSchema = z.object({
  type: z.literal('writing-lines'),
  count: z.number().int().min(1).max(40),
  ruling: z.enum(['primary', 'wide', 'narrow']).default('wide'),
  label: text.optional(),
});

/** A model word followed by blank lines to copy it onto ("rematch sheet"). */
export const wordPracticeBlockSchema = z.object({
  type: z.literal('word-practice'),
  words: z.array(z.string().min(1).max(60)).min(1).max(40),
  repeats: z.number().int().min(1).max(6).default(3),
});

/** Comic panels or game cards: a grid of boxes with optional speech bubble, caption, or text. */
export const panelGridBlockSchema = z.object({
  type: z.literal('panel-grid'),
  rows: z.number().int().min(1).max(8),
  cols: z.number().int().min(1).max(6),
  bubble: z.boolean().default(false),
  caption: z.boolean().default(false),
  cells: z.array(text).max(48).optional(),
});

const letterBoxSchema = z.object({
  letter: z.string().max(1).optional(),
  clue: z.string().max(4).optional(),
});

/** One box per letter, grouped into words. Used for cryptograms and spelling puzzles. */
export const letterBoxesBlockSchema = z.object({
  type: z.literal('letter-boxes'),
  words: z.array(z.array(letterBoxSchema).min(1).max(24)).min(1).max(60),
});

export const graphPaperBlockSchema = z.object({
  type: z.literal('graph-paper'),
  cellMm: z.number().min(4).max(20).default(12.7),
  heightMm: z.number().min(10).max(260).default(180),
});

export const imageBlockSchema = z.object({
  type: z.literal('image'),
  src: z.string().max(5_000_000),
  alt: text,
  widthPercent: z.number().min(5).max(100).default(100),
});

export const printableBlockSchema = z.discriminatedUnion('type', [
  headingBlockSchema,
  textBlockSchema,
  writingLinesBlockSchema,
  wordPracticeBlockSchema,
  panelGridBlockSchema,
  letterBoxesBlockSchema,
  graphPaperBlockSchema,
  imageBlockSchema,
]);

export const printablePageSchema = z.object({
  blocks: z.array(printableBlockSchema).max(50),
});

export const printableDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  paper: z.enum(['letter', 'a4']).default('letter'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  pages: z.array(printablePageSchema).min(1).max(30),
});

export type PrintableBlock = z.infer<typeof printableBlockSchema>;
export type PrintablePage = z.infer<typeof printablePageSchema>;
export type PrintableDocument = z.infer<typeof printableDocumentSchema>;
/** What authors write: defaults may be omitted. */
export type PrintableDocumentInput = z.input<typeof printableDocumentSchema>;
