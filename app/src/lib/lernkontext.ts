// Was die Seiten des Lernbereichs ueber ein Kapitel wissen muessen. Der
// Schluessel "wiederholen" ist kein Kapitel, sondern die Sammlung aller
// Fragen, die beim letzten Versuch falsch waren.

import { getCollection, type CollectionEntry } from 'astro:content';
import type { Db } from './db.ts';
import { fragenJeKapitel, frageNachId } from './inhalt.ts';
import { falscheFragen } from './lernen.ts';
import { WIEDERHOLEN } from './abfrage.ts';
import type { Frage } from './quiz.ts';

export interface Lernkontext {
  slug: string;
  titel: string;
  nummer: number | null;
  kurz: string;
  istWiederholen: boolean;
  /** Die Fragen fuer einen neuen Durchlauf, in Reihenfolge. */
  fragen: Frage[];
  eintrag: CollectionEntry<'kapitel'> | null;
  vorher: CollectionEntry<'kapitel'> | null;
  nachher: CollectionEntry<'kapitel'> | null;
  /** Wohin "zurueck zum Kapitel" fuehrt. */
  zurueck: string;
}

export async function alleKapitel(): Promise<CollectionEntry<'kapitel'>[]> {
  return (await getCollection('kapitel')).sort((a, b) => a.data.nummer - b.data.nummer);
}

export async function ladeKontext(db: Db, benutzerId: string, slug: string): Promise<Lernkontext | null> {
  if (slug === WIEDERHOLEN) {
    const ids = await falscheFragen(db, benutzerId);
    return {
      slug,
      titel: 'Falsche Fragen wiederholen',
      nummer: null,
      kurz: 'Alle Fragen, die beim letzten Versuch nicht gestimmt haben, aus allen Kapiteln.',
      istWiederholen: true,
      fragen: ids.map(frageNachId).filter((f): f is Frage => Boolean(f)),
      eintrag: null,
      vorher: null,
      nachher: null,
      zurueck: '/lernen/wiederholen',
    };
  }
  const alle = await alleKapitel();
  const index = alle.findIndex((k) => k.id === slug);
  if (index < 0) return null;
  const eintrag = alle[index];
  return {
    slug,
    titel: eintrag.data.titel,
    nummer: eintrag.data.nummer,
    kurz: eintrag.data.kurz ?? '',
    istWiederholen: false,
    fragen: fragenJeKapitel([slug]).get(slug) ?? [],
    eintrag,
    vorher: alle[index - 1] ?? null,
    nachher: alle[index + 1] ?? null,
    zurueck: `/lernen/${slug}`,
  };
}
