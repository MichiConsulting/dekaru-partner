// Lernfortschritt je Vertriebler: erledigte Kapitel und Quizantworten.

import type { Db } from './db.ts';
import type { Antwort, Bewertung, Frage } from './quiz.ts';

export interface GespeicherteAntwort {
  frageId: string;
  kapitel: string;
  richtig: boolean;
  jeRichtig: boolean;
  antwort: Antwort | null;
  versuche: number;
  zuletzt: Date;
}

interface AntwortZeile {
  frage_id: string;
  kapitel: string;
  richtig: boolean;
  je_richtig: boolean;
  antwort: Antwort | string | null;
  versuche: number;
  zuletzt: Date | string;
}

function zuAntwort(z: AntwortZeile): GespeicherteAntwort {
  return {
    frageId: z.frage_id,
    kapitel: z.kapitel,
    richtig: z.richtig,
    jeRichtig: z.je_richtig,
    antwort: typeof z.antwort === 'string' ? (JSON.parse(z.antwort) as Antwort) : z.antwort,
    versuche: Number(z.versuche),
    zuletzt: new Date(z.zuletzt),
  };
}

/** Speichert die Bewertung eines Durchlaufs, je Frage die letzte Antwort. */
export async function speichereAntworten(
  db: Db,
  benutzerId: string,
  ergebnisse: { frage: Frage; antwort: Antwort; bewertung: Bewertung }[],
): Promise<void> {
  for (const e of ergebnisse) {
    await db.query(
      `INSERT INTO quiz_antworten (benutzer_id, frage_id, kapitel, richtig, je_richtig, antwort, versuche, zuletzt)
       VALUES ($1, $2, $3, $4, $4, $5::jsonb, 1, now())
       ON CONFLICT (benutzer_id, frage_id) DO UPDATE
         SET richtig = EXCLUDED.richtig,
             je_richtig = quiz_antworten.je_richtig OR EXCLUDED.richtig,
             antwort = EXCLUDED.antwort,
             kapitel = EXCLUDED.kapitel,
             versuche = quiz_antworten.versuche + 1,
             zuletzt = now()`,
      [benutzerId, e.frage.id, e.frage.kapitel, e.bewertung.richtig, JSON.stringify(e.antwort)],
    );
  }
}

export async function ladeAntworten(db: Db, benutzerId: string, kapitel?: string): Promise<Map<string, GespeicherteAntwort>> {
  const zeilen = kapitel
    ? await db.query<AntwortZeile>('SELECT * FROM quiz_antworten WHERE benutzer_id = $1 AND kapitel = $2', [benutzerId, kapitel])
    : await db.query<AntwortZeile>('SELECT * FROM quiz_antworten WHERE benutzer_id = $1', [benutzerId]);
  return new Map(zeilen.map((z) => [z.frage_id, zuAntwort(z)]));
}

/** IDs der Fragen, die beim letzten Versuch falsch waren. */
export async function falscheFragen(db: Db, benutzerId: string): Promise<string[]> {
  const zeilen = await db.query<{ frage_id: string }>(
    'SELECT frage_id FROM quiz_antworten WHERE benutzer_id = $1 AND richtig = false ORDER BY zuletzt',
    [benutzerId],
  );
  return zeilen.map((z) => z.frage_id);
}

export async function markiereErledigt(db: Db, benutzerId: string, kapitel: string): Promise<void> {
  await db.query(
    'INSERT INTO kapitel_fortschritt (benutzer_id, kapitel) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [benutzerId, kapitel],
  );
}

export async function erledigteKapitel(db: Db, benutzerId: string): Promise<Set<string>> {
  const zeilen = await db.query<{ kapitel: string }>('SELECT kapitel FROM kapitel_fortschritt WHERE benutzer_id = $1', [
    benutzerId,
  ]);
  return new Set(zeilen.map((z) => z.kapitel));
}

export interface KapitelStand {
  kapitel: string;
  erledigt: boolean;
  fragen: number;
  richtig: number;
  beantwortet: number;
}

/**
 * Stand je Kapitel. Ein Kapitel gilt als erledigt, wenn es ausdruecklich
 * markiert wurde oder alle seine Fragen schon einmal richtig beantwortet sind.
 */
export async function fortschritt(db: Db, benutzerId: string, kapitelFragen: Map<string, Frage[]>): Promise<KapitelStand[]> {
  const antworten = await ladeAntworten(db, benutzerId);
  const erledigt = await erledigteKapitel(db, benutzerId);
  const stand: KapitelStand[] = [];
  for (const [kapitel, fragen] of kapitelFragen) {
    const eigene = fragen.map((f) => antworten.get(f.id)).filter((a): a is GespeicherteAntwort => Boolean(a));
    const alleRichtig = fragen.length > 0 && fragen.every((f) => antworten.get(f.id)?.jeRichtig);
    if (alleRichtig && !erledigt.has(kapitel)) {
      await markiereErledigt(db, benutzerId, kapitel);
      erledigt.add(kapitel);
    }
    stand.push({
      kapitel,
      erledigt: erledigt.has(kapitel),
      fragen: fragen.length,
      richtig: eigene.filter((a) => a.richtig).length,
      beantwortet: eigene.length,
    });
  }
  return stand;
}

export interface FortschrittUebersicht {
  benutzerId: string;
  name: string;
  email: string;
  aktiv: boolean;
  erledigt: number;
  richtig: number;
  beantwortet: number;
  zuletzt: Date | null;
}

/** Nur fuer den Admin: Lernstand aller Vertriebler in einer Tabelle. */
export async function fortschrittAller(db: Db): Promise<FortschrittUebersicht[]> {
  const zeilen = await db.query<{
    id: string;
    name: string;
    email: string;
    aktiv: boolean;
    erledigt: string;
    richtig: string;
    beantwortet: string;
    zuletzt: Date | string | null;
  }>(
    `SELECT b.id, b.name, b.email, b.aktiv,
            (SELECT COUNT(*) FROM kapitel_fortschritt k WHERE k.benutzer_id = b.id) AS erledigt,
            (SELECT COUNT(*) FROM quiz_antworten q WHERE q.benutzer_id = b.id AND q.richtig) AS richtig,
            (SELECT COUNT(*) FROM quiz_antworten q WHERE q.benutzer_id = b.id) AS beantwortet,
            (SELECT MAX(q.zuletzt) FROM quiz_antworten q WHERE q.benutzer_id = b.id) AS zuletzt
     FROM benutzer b WHERE b.rolle = 'vertriebler' ORDER BY b.name`,
  );
  return zeilen.map((z) => ({
    benutzerId: z.id,
    name: z.name,
    email: z.email,
    aktiv: z.aktiv,
    erledigt: Number(z.erledigt),
    richtig: Number(z.richtig),
    beantwortet: Number(z.beantwortet),
    zuletzt: z.zuletzt ? new Date(z.zuletzt) : null,
  }));
}
