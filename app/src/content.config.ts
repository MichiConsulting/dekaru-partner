import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';
import { inhaltOrdner } from './lib/inhalt-pfade.ts';

// Kapitel liegen als NN-name.md direkt im Inhaltsordner. README und andere
// Dateien ohne fuehrende Nummer werden nicht eingelesen.
const kapitel = defineCollection({
  loader: glob({ pattern: '[0-9]*.md', base: inhaltOrdner() }),
  schema: z.object({
    nummer: z.number(),
    titel: z.string(),
    kurz: z.string().optional(),
  }),
});

export const collections = { kapitel };
