// Bindeglied zur Gespraechshilfe: inhalt/gespraechshilfe.json wird zur
// Build-Zeit eingelesen. Nur dieses Modul kennt import.meta.glob.

import { pflichtsaetze, pruefeGespraechsDaten, type Eintrag } from './gespraech.ts';

const roh = import.meta.glob('../../../inhalt/gespraechshilfe.json', { eager: true, import: 'default' });
const geprueft = pruefeGespraechsDaten(Object.values(roh)[0] ?? { eintraege: [] });

export const gespraechsEinleitung: string = geprueft.daten.einleitung;
/** Alle gueltigen Eintraege. Fehler im Format stehen in gespraechsFehler. */
export const gespraechsEintraege: Eintrag[] = geprueft.daten.eintraege;
export const gespraechsFehler: string[] = geprueft.fehler;
/** Die Pflichtsaetze in der Reihenfolge der Datei, Schritt 1 bis n im Uebungsmodus. */
export const pflichtsatzListe: Eintrag[] = pflichtsaetze(gespraechsEintraege);

export function eintragNachId(id: string): Eintrag | undefined {
  return gespraechsEintraege.find((e) => e.id === id);
}
