// Kuenftige Software-Module fuer das Schema im Erstgespraech (/erstgespraech).
// Quelle: brain/projekte/software-baukasten/00-BAUPLAN.md, Stand 05.10.2026.
//
// Das Schema zeigt nur, was heute verkauft wird. Ein Modul erscheint dort erst,
// wenn es fertig UND bepreist ist. Solange kein Modul den Status "verfuegbar"
// hat, zeigt das Schema auch keinen leeren Platz und keinen Hinweis auf
// "kommt bald". Kein Vertriebler soll etwas versprechen, das es nicht gibt.
//
// Ein Modul freischalten (nur Michi):
//   1. Modul ist fertig, beim Betrieb getestet und hat einen Preis, der in
//      dekaru-rechnungen/preise.json bzw. auf dekaru.de steht.
//   2. Hier unten beim Modul `status: 'verfuegbar'` setzen und `kurz` pruefen
//      (ein Satz in Sie-Form, was es dem Betrieb abnimmt, ohne Preis).
//   3. Informationsblatt, Lernkarten, Gespraechshilfe und Vertrag nachziehen
//      (siehe "Folge" im Bauplan), dann committen und deployen.
// Zurueckziehen geht genauso: Status wieder auf 'in-arbeit' oder 'geplant'.

import type { BrancheId } from './schema.ts';

/** geplant: steht im Bauplan. in-arbeit: wird gebaut oder getestet. verfuegbar: fertig, bepreist, darf gezeigt und verkauft werden. */
export type ModulStatus = 'geplant' | 'in-arbeit' | 'verfuegbar';

export interface SchemaModul {
  id: string;
  name: string;
  /** Ein Satz fuer den Betrieb, Sie-Form, ohne Preis. */
  kurz: string;
  /** Fuer welche Branchen des Schemas das Modul passt. */
  branchen: BrancheId[];
  status: ModulStatus;
}

const ALLE: BrancheId[] = ['handwerk', 'gastro', 'friseur', 'praxis'];

export const SCHEMA_MODULE: SchemaModul[] = [
  { id: 'terminbuchung', name: 'Terminbuchung mit Erinnerung', kurz: 'Kunden buchen einen freien Termin direkt in Ihren Kalender.', branchen: ['friseur', 'praxis', 'handwerk'], status: 'geplant' },
  { id: 'tischreservierung', name: 'Tischreservierung', kurz: 'Gäste reservieren einen Tisch, die Reservierung landet in Ihrem Kalender.', branchen: ['gastro'], status: 'geplant' },
  { id: 'kostenrechner', name: 'Kostenrechner für Kunden', kurz: 'Besucher rechnen sich vorab einen groben Preis aus und schicken ihn mit der Anfrage.', branchen: ['handwerk', 'praxis'], status: 'geplant' },
  { id: 'anfrage-fotos', name: 'Anfrage mit Fotos', kurz: 'Kunden schicken Fotos mit, Sie sehen vor dem Rückruf, worum es geht.', branchen: ['handwerk'], status: 'geplant' },
  { id: 'reel-werkstatt', name: 'Reel-Werkstatt', kurz: 'Aus Ihren Handyvideos werden kurze Clips mit Untertiteln.', branchen: ALLE, status: 'in-arbeit' },
  { id: 'bewertungs-assistent', name: 'Bewertungs-Assistent', kurz: 'Hilft Ihnen, auf Bewertungen passend zu antworten.', branchen: ALLE, status: 'geplant' },
  { id: 'beitrags-schreiber', name: 'Beitrags-Schreiber', kurz: 'Entwirft Beiträge für Ihre Website und Ihre Kanäle.', branchen: ALLE, status: 'geplant' },
  { id: 'speisekarten-generator', name: 'Speisekarten- und Preislisten-Generator', kurz: 'Macht aus Ihrer Liste eine fertige Karte zum Drucken und für die Website.', branchen: ['gastro', 'friseur'], status: 'geplant' },
  { id: 'angebots-assistent', name: 'Angebots-Assistent', kurz: 'Hilft beim Schreiben von Angeboten aus Ihren Stichpunkten.', branchen: ['handwerk'], status: 'geplant' },
  { id: 'schichtplan', name: 'Schicht- und Urlaubsplan', kurz: 'Plant Schichten und Urlaub Ihres Teams an einer Stelle.', branchen: ['gastro', 'friseur', 'praxis'], status: 'geplant' },
  { id: 'lagerliste', name: 'Material- und Lagerliste', kurz: 'Hält fest, was im Lager ist und was nachbestellt werden muss.', branchen: ['handwerk'], status: 'geplant' },
];

/** Nur Module mit Status "verfuegbar", die zur Branche passen. Heute: keines. */
export function verfuegbareModule(branche: BrancheId, module: SchemaModul[] = SCHEMA_MODULE): SchemaModul[] {
  return module.filter((m) => m.status === 'verfuegbar' && m.branchen.includes(branche));
}
