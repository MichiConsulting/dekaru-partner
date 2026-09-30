// Ein Quiz-Durchlauf: Antworten aus dem Formular lesen, bewerten, speichern.
// Und der Weg zurueck: gespeicherte Antworten wieder zu Bewertungen machen,
// damit die Seite nach dem Absenden das Ergebnis zeigt.

import type { Db } from './db.ts';
import { antwortAusFormular, bewerte, type Antwort, type Bewertung, type Frage } from './quiz.ts';
import { speichereAntworten, type GespeicherteAntwort } from './lernen.ts';

export interface Ergebnis {
  frage: Frage;
  antwort: Antwort;
  bewertung: Bewertung;
}

export async function verarbeiteQuiz(
  db: Db,
  benutzerId: string,
  fragen: Frage[],
  form: { get(name: string): unknown },
): Promise<Ergebnis[]> {
  const ergebnisse = fragen.map((frage) => {
    const antwort = antwortAusFormular(frage, form);
    return { frage, antwort, bewertung: bewerte(frage, antwort) };
  });
  await speichereAntworten(db, benutzerId, ergebnisse);
  return ergebnisse;
}

/** Bewertungen aus dem, was zuletzt gespeichert wurde. Fragen ohne Antwort fehlen. */
export function ergebnisseAusAntworten(fragen: Frage[], antworten: Map<string, GespeicherteAntwort>): Map<string, Ergebnis> {
  const karte = new Map<string, Ergebnis>();
  for (const frage of fragen) {
    const a = antworten.get(frage.id);
    if (!a?.antwort) continue;
    karte.set(frage.id, { frage, antwort: a.antwort, bewertung: bewerte(frage, a.antwort) });
  }
  return karte;
}
