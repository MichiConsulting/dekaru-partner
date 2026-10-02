// Die sichtbaren Passwortregeln. Eigene Datei ohne node:crypto, damit die
// Live-Anzeige auf der Passwortseite sie im Browser nutzen kann. Die
// verbindliche Pruefung macht pruefeNeuesPasswort in passwort.ts.

// Im Portal liegen Kontaktdaten von Betrieben, deshalb strenger als ueblich:
// Laenge plus alle vier Zeichenarten plus Sperren gegen die haeufigsten Muster.
export const MINDESTLAENGE = 12;

/** In derselben Reihenfolge wie auf der Seite. */
export const PASSWORT_REGELN = [
  { schluessel: 'laenge', text: `mindestens ${MINDESTLAENGE} Zeichen` },
  { schluessel: 'klein', text: 'ein Kleinbuchstabe' },
  { schluessel: 'gross', text: 'ein Großbuchstabe' },
  { schluessel: 'zahl', text: 'eine Zahl' },
  { schluessel: 'sonder', text: 'ein Sonderzeichen, zum Beispiel ! ? # % & *' },
] as const;

export type RegelSchluessel = (typeof PASSWORT_REGELN)[number]['schluessel'];

/** Welche der sichtbaren Regeln erfuellt sind. */
export function erfuellteRegeln(passwort: string): Record<RegelSchluessel, boolean> {
  const p = typeof passwort === 'string' ? passwort : '';
  return {
    laenge: p.length >= MINDESTLAENGE,
    klein: /\p{Ll}/u.test(p),
    gross: /\p{Lu}/u.test(p),
    zahl: /\p{Nd}/u.test(p),
    sonder: /[^\p{L}\p{Nd}\s]/u.test(p),
  };
}
