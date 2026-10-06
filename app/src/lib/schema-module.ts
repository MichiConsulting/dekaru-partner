// Software-Module fuer das Schema im Erstgespraech (/erstgespraech und die
// oeffentliche Fassung /schema).
//
// Das Schema zeigt nur, was heute verkauft wird. Ein Modul erscheint dort
// genau dann, wenn es in src/data/module.json steht (abgeleitet aus
// dekaru-rechnungen/preise.json, verkaufbar: true, npm run module-sync) und
// in inhalt/module.json einen Text hat. Seit 06.10.2026 in jeder Branche:
// Die Branchen in schemaBranchen sind nur eine Empfehlung ("Passt oft zu
// Ihrer Branche", zuerst), die uebrigen Module stehen darunter. Gibt es kein
// verkaufbares Modul, zeigt das Schema auch keinen leeren Platz und keinen
// Hinweis auf "kommt bald".
//
// Der Betrieb kann Module vormerken. Die Merkliste steht nur in der Adresse
// (?module=kostenrechner), nichts wird gespeichert, kein Cookie.
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
import { ART_TITEL, MODULE_GRUPPIEREN_AB, VERKAUFBARE_MODULE, moduleFuerSchema, type Modul, type ModulArt, type SchemaModulEintrag } from './module.ts';

export type SchemaModul = SchemaModulEintrag;

export interface ModulGruppe {
  /** Ueberschrift der Gruppe, leer wenn nicht gruppiert. */
  titel: string;
  module: SchemaModul[];
}

export interface SchemaModulAbschnitt {
  /** "Passt oft zu Ihrer Branche" oder "Weitere Module"/"Wählbar". */
  titel: string;
  empfohlen: boolean;
  gruppen: ModulGruppe[];
}

/** Alle verkaufbaren Module fuer die Branche, empfohlene zuerst. */
export function verfuegbareModule(branche: BrancheId, module: Modul[] = VERKAUFBARE_MODULE): SchemaModul[] {
  const { empfohlen, weitere } = moduleFuerSchema(branche, module);
  return [...empfohlen, ...weitere];
}

function gruppiere(liste: SchemaModul[], nachArt: boolean): ModulGruppe[] {
  if (!nachArt) return [{ titel: '', module: liste }];
  return (Object.keys(ART_TITEL) as ModulArt[])
    .map((art) => ({ titel: ART_TITEL[art], module: liste.filter((m) => m.art === art) }))
    .filter((g) => g.module.length > 0);
}

/**
 * Abschnitte fuer Schritt 4: erst die Empfehlung der Branche, dann die
 * uebrigen. Ab MODULE_GRUPPIEREN_AB Modulen je Abschnitt nach Art gruppiert.
 * Leere Abschnitte fallen weg, es gibt also nie eine leere Ueberschrift.
 */
export function modulAbschnitte(branche: BrancheId, module: Modul[] = VERKAUFBARE_MODULE): SchemaModulAbschnitt[] {
  const { empfohlen, weitere } = moduleFuerSchema(branche, module);
  const nachArt = empfohlen.length + weitere.length >= MODULE_GRUPPIEREN_AB;
  const abschnitte: SchemaModulAbschnitt[] = [];
  if (empfohlen.length) abschnitte.push({ titel: 'Passt oft zu Ihrer Branche', empfohlen: true, gruppen: gruppiere(empfohlen, nachArt) });
  if (weitere.length) abschnitte.push({ titel: empfohlen.length ? 'Weitere Module, in jeder Branche wählbar' : 'In jeder Branche wählbar', empfohlen: false, gruppen: gruppiere(weitere, nachArt) });
  return abschnitte;
}
