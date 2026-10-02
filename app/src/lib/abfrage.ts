// Die Abfrage eines Kapitels: eine Frage je Seite, Aufloesung erst nach der
// Antwort, am Ende ein Ergebnis. Der Stand liegt in abfrage_durchlaeufe, je
// Person und Schluessel genau ein Durchlauf (der letzte). Die Bewertung
// passiert hier auf dem Server, die Frage-Seite bekommt nie eine Loesung.

import type { Db } from './db.ts';
import { antwortAusFormular, bewerte, type Antwort, type Frage, type FormularQuelle } from './quiz.ts';
import { speichereAntworten } from './lernen.ts';
import type { Ergebnis } from './quiz-durchlauf.ts';

/** Schluessel der kapitelfreien Wiederholung aller falschen Fragen. */
export const WIEDERHOLEN = 'wiederholen';

export interface DurchlaufErgebnis {
  frageId: string;
  richtig: boolean;
  antwort: Antwort;
}

export interface Durchlauf {
  schluessel: string;
  fragen: string[];
  position: number;
  ergebnisse: DurchlaufErgebnis[];
  gestartetAm: Date;
  beendetAm: Date | null;
}

export type Zustand =
  | { art: 'leer' }
  | { art: 'frage'; index: number }
  | { art: 'aufloesung'; index: number }
  | { art: 'fertig' };

interface Zeile {
  schluessel: string;
  fragen: string[] | string;
  position: number;
  ergebnisse: DurchlaufErgebnis[] | string;
  gestartet_am: Date | string;
  beendet_am: Date | string | null;
}

function json<T>(wert: T | string): T {
  return typeof wert === 'string' ? (JSON.parse(wert) as T) : wert;
}

function zuDurchlauf(z: Zeile): Durchlauf {
  return {
    schluessel: z.schluessel,
    fragen: json<string[]>(z.fragen),
    position: Number(z.position),
    ergebnisse: json<DurchlaufErgebnis[]>(z.ergebnisse),
    gestartetAm: new Date(z.gestartet_am),
    beendetAm: z.beendet_am ? new Date(z.beendet_am) : null,
  };
}

/** Wo der Durchlauf steht. Reine Funktion. */
export function zustand(d: Durchlauf | null): Zustand {
  if (!d || d.fragen.length === 0) return { art: 'leer' };
  if (d.position >= d.fragen.length) return { art: 'fertig' };
  if (d.ergebnisse.length > d.position) return { art: 'aufloesung', index: d.position };
  return { art: 'frage', index: d.position };
}

/** Beginnt einen neuen Durchlauf und ersetzt einen alten zum selben Schluessel. */
export async function starteDurchlauf(db: Db, benutzerId: string, schluessel: string, frageIds: string[]): Promise<Durchlauf> {
  const zeilen = await db.query<Zeile>(
    `INSERT INTO abfrage_durchlaeufe (benutzer_id, schluessel, fragen, position, ergebnisse, gestartet_am, beendet_am)
     VALUES ($1, $2, $3::jsonb, 0, '[]'::jsonb, now(), NULL)
     ON CONFLICT (benutzer_id, schluessel) DO UPDATE
       SET fragen = EXCLUDED.fragen, position = 0, ergebnisse = '[]'::jsonb, gestartet_am = now(), beendet_am = NULL
     RETURNING *`,
    [benutzerId, schluessel, JSON.stringify(frageIds)],
  );
  return zuDurchlauf(zeilen[0]);
}

export async function ladeDurchlauf(db: Db, benutzerId: string, schluessel: string): Promise<Durchlauf | null> {
  const zeilen = await db.query<Zeile>('SELECT * FROM abfrage_durchlaeufe WHERE benutzer_id = $1 AND schluessel = $2', [
    benutzerId,
    schluessel,
  ]);
  return zeilen[0] ? zuDurchlauf(zeilen[0]) : null;
}

/**
 * Bewertet die Antwort auf die Frage, die gerade dran ist, speichert sie in
 * quiz_antworten (fuer Fortschritt und Wiederholung) und im Durchlauf.
 * Liefert null, wenn gerade keine Frage offen ist oder die Frage nicht passt.
 */
export async function beantworteFrage(
  db: Db,
  benutzerId: string,
  durchlauf: Durchlauf,
  frage: Frage,
  form: FormularQuelle,
): Promise<Ergebnis | null> {
  const z = zustand(durchlauf);
  if (z.art !== 'frage' || durchlauf.fragen[z.index] !== frage.id) return null;
  const antwort = antwortAusFormular(frage, form);
  const bewertung = bewerte(frage, antwort);
  const ergebnis: Ergebnis = { frage, antwort, bewertung };
  await speichereAntworten(db, benutzerId, [ergebnis]);
  const ergebnisse = [...durchlauf.ergebnisse, { frageId: frage.id, richtig: bewertung.richtig, antwort }];
  await db.query('UPDATE abfrage_durchlaeufe SET ergebnisse = $3::jsonb WHERE benutzer_id = $1 AND schluessel = $2', [
    benutzerId,
    durchlauf.schluessel,
    JSON.stringify(ergebnisse),
  ]);
  durchlauf.ergebnisse = ergebnisse;
  return ergebnis;
}

/** Nach der Aufloesung zur naechsten Frage. Nach der letzten ist der Durchlauf beendet. */
export async function weiter(db: Db, benutzerId: string, durchlauf: Durchlauf): Promise<Durchlauf> {
  if (zustand(durchlauf).art !== 'aufloesung') return durchlauf;
  const position = durchlauf.position + 1;
  const fertig = position >= durchlauf.fragen.length;
  await db.query(
    `UPDATE abfrage_durchlaeufe SET position = $3, beendet_am = CASE WHEN $4 THEN now() ELSE beendet_am END
     WHERE benutzer_id = $1 AND schluessel = $2`,
    [benutzerId, durchlauf.schluessel, position, fertig],
  );
  return { ...durchlauf, position, beendetAm: fertig ? new Date() : durchlauf.beendetAm };
}

export interface Auswertung {
  punkte: number;
  max: number;
  falsche: string[];
}

export function auswertung(d: Durchlauf): Auswertung {
  const richtig = d.ergebnisse.filter((e) => e.richtig).length;
  return { punkte: richtig, max: d.fragen.length, falsche: d.ergebnisse.filter((e) => !e.richtig).map((e) => e.frageId) };
}

/** Wie viele Fragen eines Durchlaufs schon beantwortet sind, fuer die Anzeige. */
export function fortschrittProzent(d: Durchlauf): number {
  if (d.fragen.length === 0) return 0;
  return Math.round((Math.min(d.ergebnisse.length, d.fragen.length) / d.fragen.length) * 100);
}
