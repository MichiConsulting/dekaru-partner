// Software-Module fuer das Schema im Erstgespraech (/erstgespraech und die
// oeffentliche Fassung /schema).
//
// Das Schema zeigt nur, was heute verkauft wird. Ein Modul erscheint dort
// genau dann, wenn es in src/data/module.json steht (abgeleitet aus
// dekaru-rechnungen/preise.json, verkaufbar: true, npm run module-sync) und
// in inhalt/module.json einen Text mit den passenden Schema-Branchen hat.
// Solange keines passt, zeigt das Schema auch keinen leeren Platz und keinen
// Hinweis auf "kommt bald". Kein Vertriebler soll etwas versprechen, das es
// nicht gibt.
//
// Ein Modul freischalten (nur Michi):
//   1. Modul ist fertig und getestet. In dekaru-rechnungen/preise.json unter
//      leistungen.module verkaufbar auf true setzen.
//   2. Texte in inhalt/module.json (fuer den Betrieb, ohne Preis) und
//      inhalt/verkaufshilfen.json (fuer Vertriebler) anlegen.
//   3. Hier im Portal: npm run module-sync, npm test, Kapitel 12, Lernkarten,
//      Gespraechshilfe und Vertrag nachziehen, committen, deployen.
// Zurueckziehen: verkaufbar auf false, module-sync, deployen.
//
// Im Schema stehen nur Name und Nutzen, nie ein Preis.

import type { BrancheId } from './schema.ts';
import { moduleFuerSchema } from './module.ts';

export interface SchemaModul {
  schluessel: string;
  name: string;
  /** Ein Satz fuer den Betrieb, Sie-Form, ohne Preis. */
  kurz: string;
}

/** Verkaufbare Module, die zur Branche passen. */
export function verfuegbareModule(branche: BrancheId): SchemaModul[] {
  return moduleFuerSchema(branche);
}
