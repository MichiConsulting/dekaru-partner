// Software-Module im Portal: Schema, Verkaufshilfen, Briefing.
//
// Drei Quellen, je mit eigener Aufgabe:
//   src/data/module.json        abgeleitet aus dekaru-rechnungen/preise.json
//                               (npm run module-sync). Enthaelt NUR verkaufbare
//                               Module mit Preis und Stufe. Ein Modul ist im
//                               Portal genau dann verkaufbar, wenn es dort steht.
//   inhalt/module.json          Texte, die ein Betrieb sehen darf (Schema,
//                               Steckbrief zum Zeigen). Ohne Preise.
//   inhalt/verkaufshilfen.json  Hinweise nur fuer Vertriebler (Einstieg, Fragen,
//                               Interna, Zweittermin).
//
// Angezeigt wird nur, was in allen drei steht. Fehlt ein Text zu einem
// verkaufbaren Modul, bleibt es draussen und MODUL_FEHLER nennt es;
// tests/module.test.ts schlaegt dann an. Umgekehrt zeigt ein Text ohne Eintrag
// in module.json nichts an: So kann Michi einen Steckbrief vorbereiten, bevor
// das Modul verkaufbar ist, ohne dass ihn ein Vertriebler sieht.
//
// Nur auf dem Server benutzt. Der Preisrechner im Browser nimmt MODULE aus
// preise.ts, damit die internen Hinweise nicht im Bundle unter /_astro/ landen.

import texteRoh from '../../../inhalt/module.json' with { type: 'json' };
import hilfenRoh from '../../../inhalt/verkaufshilfen.json' with { type: 'json' };
import { MODULE, findeModul, provisionAuf, type ModulPosten } from './preise.ts';
import { BRANCHEN_IDS, type BrancheId } from './schema.ts';
import { BRIEFING_ZU_TEMPLATE } from './paletten.ts';

export type ModulArt = 'besucher' | 'inhaber';

/** Was ein Betrieb sehen darf. Kein Preis. */
export interface ModulText {
  schluessel: string;
  name: string;
  art: ModulArt;
  /** Ein Satz fuer das Schema, Sie-Form, ohne Preis. */
  kurz: string;
  /** In welchen Branchen des Schemas das Modul erscheint. */
  schemaBranchen: BrancheId[];
  /** In welchen Website-Vorlagen es sich bauen laesst (Template-Branchen aus dekaru-templates). */
  templates: string[];
  einleitung: string;
  nutzen: string[];
  kannNicht: string[];
  voraussetzungen: string[];
  einrichtung: string;
  daten: string;
  laufend: string;
}

export interface Frage {
  frage: string;
  antwort: string;
}

/** Nur fuer Vertriebler. */
export interface ModulHilfe {
  schluessel: string;
  fuerWen: string;
  einstieg: string;
  fragen: Frage[];
  intern: string[];
}

export interface Zweittermin {
  titel: string;
  schritte: string[];
  merke: string;
}

/** Ein verkaufbares Modul mit allem, was das Portal dazu zeigt. */
export interface Modul extends ModulText, ModulHilfe {
  preis: number;
  stufe: string;
  einheit: string;
  /** 35 % auf den Modulpreis, nur im Erstauftrag. */
  provision: number;
  /** Briefing-Branchen (Teil B), fuer die sich das Modul bauen laesst. */
  briefingBranchen: string[];
}

const ARTEN: ModulArt[] = ['besucher', 'inhaber'];
const TEMPLATES = new Set(Object.values(BRIEFING_ZU_TEMPLATE));

/** Textregeln aus CLAUDE.md und inhalt/README.md, fuer jeden Satz. */
export function textFehler(text: string, wo: string, ohneEuro = false): string[] {
  const f: string[] = [];
  if (/[–—]/.test(text)) f.push(`${wo}: langer Gedankenstrich.`);
  if (/\bDekaru\b|\bDEKARU\b/.test(text)) f.push(`${wo}: dekaru wird kleingeschrieben.`);
  if (/\b(sieben|zwei|drei|vier|\d+)\s+(Tage|Tagen|Wochen)\b/i.test(text)) f.push(`${wo}: keine Bauzeit in Tagen oder Wochen.`);
  if (/kommt bald|demnächst|in Kürze/i.test(text)) f.push(`${wo}: nichts als "kommt bald" ankündigen.`);
  if (/lokal|aus Ihrer Region|in Ihrer Nähe/i.test(text)) f.push(`${wo}: kein Ortsbezug.`);
  if (ohneEuro && /€|\bEuro\b|\bEUR\b/.test(text)) f.push(`${wo}: kein Preis in Texten für den Betrieb.`);
  return f;
}

function istText(wert: unknown): wert is string {
  return typeof wert === 'string' && wert.trim().length > 0;
}

function istListe(wert: unknown, min = 1): wert is string[] {
  return Array.isArray(wert) && wert.length >= min && wert.every(istText);
}

/** Prueft inhalt/module.json. Fehlerhafte Eintraege fallen weg. */
export function pruefeModulTexte(roh: unknown): { texte: ModulText[]; fehler: string[] } {
  const fehler: string[] = [];
  const texte: ModulText[] = [];
  const liste = (roh as { module?: unknown })?.module;
  if (!Array.isArray(liste)) return { texte, fehler: ['inhalt/module.json: Liste "module" fehlt.'] };
  const gesehen = new Set<string>();
  for (const [i, e] of liste.entries()) {
    const m = e as Partial<ModulText>;
    const wo = `module.json, Eintrag ${i + 1} (${m?.schluessel ?? '?'})`;
    const f: string[] = [];
    if (!istText(m.schluessel) || !/^modul-[a-z0-9-]+$/.test(m.schluessel)) f.push(`${wo}: schluessel fehlt oder ist ungültig.`);
    else if (gesehen.has(m.schluessel)) f.push(`${wo}: schluessel doppelt.`);
    for (const feld of ['name', 'kurz', 'einleitung', 'einrichtung', 'daten', 'laufend'] as const) if (!istText(m[feld])) f.push(`${wo}: ${feld} fehlt.`);
    if (!ARTEN.includes(m.art as ModulArt)) f.push(`${wo}: art muss besucher oder inhaber sein.`);
    for (const feld of ['nutzen', 'kannNicht', 'voraussetzungen'] as const) if (!istListe(m[feld])) f.push(`${wo}: ${feld} braucht mindestens einen Eintrag.`);
    if (!Array.isArray(m.schemaBranchen) || m.schemaBranchen.some((b) => !BRANCHEN_IDS.includes(b))) f.push(`${wo}: schemaBranchen nur aus ${BRANCHEN_IDS.join(', ')}.`);
    if (!istListe(m.templates) || m.templates.some((t) => !TEMPLATES.has(t))) f.push(`${wo}: templates nur aus ${[...TEMPLATES].join(', ')}.`);
    if (f.length === 0) {
      const saetze = [m.name!, m.kurz!, m.einleitung!, m.einrichtung!, m.daten!, m.laufend!, ...m.nutzen!, ...m.kannNicht!, ...m.voraussetzungen!];
      for (const s of saetze) f.push(...textFehler(s, wo, true));
    }
    if (f.length) {
      fehler.push(...f);
      continue;
    }
    gesehen.add(m.schluessel!);
    texte.push(m as ModulText);
  }
  return { texte, fehler };
}

/** Prueft inhalt/verkaufshilfen.json. */
export function pruefeVerkaufshilfen(roh: unknown): { einleitung: string; zweittermin: Zweittermin | null; hilfen: ModulHilfe[]; fehler: string[] } {
  const fehler: string[] = [];
  const hilfen: ModulHilfe[] = [];
  const o = (roh ?? {}) as { einleitung?: unknown; zweittermin?: Partial<Zweittermin>; module?: unknown };
  const einleitung = istText(o.einleitung) ? o.einleitung : '';
  if (!einleitung) fehler.push('verkaufshilfen.json: einleitung fehlt.');
  let zweittermin: Zweittermin | null = null;
  const z = o.zweittermin;
  if (z && istText(z.titel) && istListe(z.schritte, 2) && istText(z.merke)) {
    const f = [z.titel, z.merke, ...z.schritte].flatMap((s) => textFehler(s, 'verkaufshilfen.json, zweittermin'));
    if (f.length) fehler.push(...f);
    else zweittermin = z as Zweittermin;
  } else fehler.push('verkaufshilfen.json: zweittermin braucht titel, mindestens zwei schritte und merke.');
  const liste = Array.isArray(o.module) ? o.module : [];
  if (!Array.isArray(o.module)) fehler.push('verkaufshilfen.json: Liste "module" fehlt.');
  for (const [i, e] of liste.entries()) {
    const m = e as Partial<ModulHilfe>;
    const wo = `verkaufshilfen.json, Eintrag ${i + 1} (${m?.schluessel ?? '?'})`;
    const f: string[] = [];
    if (!istText(m.schluessel)) f.push(`${wo}: schluessel fehlt.`);
    if (!istText(m.fuerWen)) f.push(`${wo}: fuerWen fehlt.`);
    if (!istText(m.einstieg)) f.push(`${wo}: einstieg fehlt.`);
    else if (m.einstieg.split(/\s+/).length > 40) f.push(`${wo}: einstieg ist länger als ein Satz mit 40 Wörtern.`);
    if (!Array.isArray(m.fragen) || m.fragen.length === 0 || m.fragen.some((q) => !istText(q?.frage) || !istText(q?.antwort))) f.push(`${wo}: fragen braucht frage und antwort.`);
    if (!istListe(m.intern)) f.push(`${wo}: intern braucht mindestens einen Hinweis.`);
    if (f.length === 0) {
      // Antworten sagt der Vertriebler dem Betrieb: dort keine Preise.
      const saetze = [m.fuerWen!, m.einstieg!, ...m.intern!].flatMap((s) => textFehler(s, wo));
      const gesprochen = m.fragen!.flatMap((q) => [...textFehler(q.frage, wo, true), ...textFehler(q.antwort, wo, true)]);
      f.push(...saetze, ...gesprochen);
    }
    if (f.length) {
      fehler.push(...f);
      continue;
    }
    hilfen.push(m as ModulHilfe);
  }
  return { einleitung, zweittermin, hilfen, fehler };
}

/** Briefing-Branchen (Teil B) je Template. */
function briefingBranchen(templates: string[]): string[] {
  return Object.entries(BRIEFING_ZU_TEMPLATE)
    .filter(([, t]) => templates.includes(t))
    .map(([label]) => label);
}

/** Fuehrt Sync, Texte und Hilfen zusammen. Exportiert fuer Tests mit eigenen Daten. */
export function fuehreZusammen(posten: ModulPosten[], texte: ModulText[], hilfen: ModulHilfe[]): { module: Modul[]; fehler: string[] } {
  const fehler: string[] = [];
  const module: Modul[] = [];
  for (const p of posten) {
    const text = texte.find((t) => t.schluessel === p.schluessel);
    const hilfe = hilfen.find((h) => h.schluessel === p.schluessel);
    if (!text) fehler.push(`${p.schluessel} ist verkaufbar, hat aber keinen gültigen Text in inhalt/module.json. Es wird nicht angezeigt.`);
    if (!hilfe) fehler.push(`${p.schluessel} ist verkaufbar, hat aber keine gültige Verkaufshilfe in inhalt/verkaufshilfen.json. Es wird nicht angezeigt.`);
    if (!text || !hilfe) continue;
    module.push({ ...text, ...hilfe, name: text.name, preis: p.preis, stufe: p.stufe, einheit: p.einheit, provision: provisionAuf(p.preis), briefingBranchen: briefingBranchen(text.templates) });
  }
  return { module, fehler };
}

const texte = pruefeModulTexte(texteRoh);
const hilfen = pruefeVerkaufshilfen(hilfenRoh);
const zusammen = fuehreZusammen(MODULE, texte.texte, hilfen.hilfen);

/** Alle Module, die heute verkauft werden, mit Texten. Reihenfolge wie in dekaru-rechnungen. */
export const VERKAUFBARE_MODULE: Modul[] = zusammen.module;
/** Fehler in den Inhalten, sieht der Admin unter Verkaufshilfen. */
export const MODUL_FEHLER: string[] = [...texte.fehler, ...hilfen.fehler, ...zusammen.fehler];
export const VERKAUFSHILFEN_EINLEITUNG: string = hilfen.einleitung;
export const ZWEITTERMIN: Zweittermin | null = hilfen.zweittermin;

export function findeVerkaufbaresModul(schluessel: string | undefined | null): Modul | null {
  if (!schluessel || !findeModul(schluessel)) return null;
  return VERKAUFBARE_MODULE.find((m) => m.schluessel === schluessel) ?? null;
}

/** Fuer das Schema: verkaufbare Module der Branche, nur Name und Nutzen. */
export function moduleFuerSchema(branche: BrancheId, module: Modul[] = VERKAUFBARE_MODULE): { schluessel: string; name: string; kurz: string }[] {
  return module.filter((m) => m.schemaBranchen.includes(branche)).map((m) => ({ schluessel: m.schluessel, name: m.name, kurz: m.kurz }));
}

/**
 * Briefing: passt ein angekreuztes Modul zur gewaehlten Branche? Liefert je
 * unpassendem Modul einen Hinweis. Ohne Branche keiner.
 */
export function moduleZurBranche(branche: string | undefined, schluessel: string[], module: Modul[] = VERKAUFBARE_MODULE): string[] {
  if (!branche) return [];
  const template = BRIEFING_ZU_TEMPLATE[branche];
  if (!template) return [];
  return schluessel
    .map((s) => module.find((m) => m.schluessel === s))
    .filter((m): m is Modul => Boolean(m) && !m!.templates.includes(template))
    .map((m) => `${m.name} lässt sich für die Branche ${branche} nicht bauen. Passend: ${m.briefingBranchen.join(', ')}. Bitte abwählen oder mit Michael Henning klären.`);
}
