// Stile und Bewegungsstufen der Kundenseiten, wie sie im Template-System
// gesetzt werden (site.config.ts: stil, bewegung). Quelle ist
// dekaru-templates/_core/stile/stile.mjs, hier liegt die abgeleitete Kopie
// src/data/stile.json (npm run stile-sync). Die Texte mit Umlauten stehen in
// inhalt/stile.json.
//
// Entscheidung vom 07.10.2026: Der Stil kommt ins Angebot und in den
// Briefing-Bogen, damit Michi danach bauen kann. Im Erstgespraech wird er
// nicht gezeigt: das Schema (/schema, SchemaErstgespraech) importiert diese
// Datei nie. Im Paket enthalten, kein Aufpreis.
//
// Die Vertraeglichkeit mit der Palette folgt pruefeStil aus stile.mjs:
//   - Branchen mit dunklem Design (tattoo): nur Stile mit dunkler Fassung,
//     auch mit einer hellen Palette.
//   - Sonst: eine dunkle Palette (modus "dunkel") verlangt einen Stil mit
//     dunkler Fassung.
// tests/stile-sync.test.ts gleicht das mit dem echten pruefeStil ab.

import daten from '../data/stile.json' with { type: 'json' };
import texteRoh from '../../../inhalt/stile.json' with { type: 'json' };
import type { Design, Palette } from './paletten.ts';

export interface Stil {
  kennung: string;
  name: string;
  /** Kurzbeschreibung in einem Wort, z. B. "editorial". */
  beschreibung: string;
  leitidee: string;
  passtZu: string;
  /** In welchen Designs es den Stil gibt. */
  modi: Design[];
  heroStyles: string[];
}

export interface Bewegungsstufe {
  wert: string;
  name: string;
  erklaerung: string;
}

interface StilText {
  beschreibung: string;
  leitidee: string;
  passtZu: string;
}

const texte = texteRoh as { stile: Record<string, StilText>; bewegung: Record<string, { name: string; erklaerung: string }> };

/** Wert im Bogen: der Standard der Branche, aufgeloest erst beim Bau. */
export const STIL_STANDARD = 'standard';
/** Wert im Bogen: mit dem Betrieb noch nicht besprochen. */
export const STIL_OFFEN = 'offen';

export const ALLE_STILE: Stil[] = daten.stile.map((s) => {
  const t = texte.stile[s.kennung];
  return {
    kennung: s.kennung,
    name: s.name,
    beschreibung: t?.beschreibung ?? '',
    leitidee: t?.leitidee ?? '',
    passtZu: t?.passtZu ?? '',
    modi: s.modi as Design[],
    heroStyles: s.heroStyles,
  };
});

export const STANDARD_JE_BRANCHE = daten.standard as Record<string, Record<Design, string>>;
export const DUNKLE_BRANCHEN: string[] = daten.dunkleBranchen;

export const BEWEGUNG_STANDARD: string = daten.bewegung.standard;
export const BEWEGUNGSSTUFEN: Bewegungsstufe[] = daten.bewegung.stufen.map((w) => ({
  wert: w,
  name: texte.bewegung[w]?.name ?? w,
  erklaerung: texte.bewegung[w]?.erklaerung ?? '',
}));

export function findeStil(kennung: string | null | undefined): Stil | null {
  if (!kennung) return null;
  return ALLE_STILE.find((s) => s.kennung === kennung) ?? null;
}

export function findeBewegung(wert: string | null | undefined): Bewegungsstufe | null {
  if (!wert) return null;
  return BEWEGUNGSSTUFEN.find((b) => b.wert === wert) ?? null;
}

/** Nur hell, nur dunkel oder beides, fuer Bogen und Ansicht. */
export function modiText(s: Stil): string {
  if (s.modi.includes('hell') && s.modi.includes('dunkel')) return 'hell und dunkel';
  return s.modi.includes('dunkel') ? 'nur dunkel' : 'nur hell';
}

/** Design, in dem die Seite gebaut wird: wie modus in pruefeStil. */
export function designFuer(templateId: string, palette: Palette | null): Design {
  if (palette) return palette.modus;
  return DUNKLE_BRANCHEN.includes(templateId) ? 'dunkel' : 'hell';
}

/** Der Standardstil der Branche fuer dieses Design, null bei unbekannter Branche. */
export function standardStil(templateId: string | undefined, palette: Palette | null): Stil | null {
  if (!templateId) return null;
  const st = STANDARD_JE_BRANCHE[templateId];
  return st ? findeStil(st[designFuer(templateId, palette)]) : null;
}

/**
 * Laesst sich der Stil mit Branche und Palette bauen? Liefert sonst einen
 * Hinweis, der im Bogen beim Einreichen erscheint. Standard und offen passen
 * immer, ebenso ein Stil, solange Branche oder Stil unbekannt sind.
 */
export function stilZurPalette(templateId: string | undefined, palette: Palette | null, stilWert: string | undefined): string | null {
  const s = findeStil(stilWert);
  if (!s || !templateId || !STANDARD_JE_BRANCHE[templateId]) return null;
  const dunkleStile = ALLE_STILE.filter((x) => x.modi.includes('dunkel')).map((x) => x.name);
  const liste = dunkleStile.join(', ');
  if (DUNKLE_BRANCHEN.includes(templateId) && !s.modi.includes('dunkel')) {
    return `Stil ${s.name} gibt es nur hell, die Branche hat ein dunkles Design. Bitte einen Stil mit dunkler Fassung wählen (${liste}), Standard der Branche oder noch offen.`;
  }
  const design = designFuer(templateId, palette);
  if (!s.modi.includes(design)) {
    return `Stil ${s.name} gibt es nur hell, die Farbpalette ${palette?.code} ${palette?.name} ist dunkel. Bitte eine helle Palette wählen oder einen Stil mit dunkler Fassung (${liste}), Standard der Branche oder noch offen.`;
  }
  return null;
}

export interface StilFuerBau {
  /** gewaehlt: ein Stil ist ausdruecklich gesetzt. fehlt: alter Bogen ohne Feld. */
  art: 'gewaehlt' | 'standard' | 'offen' | 'fehlt';
  /** Der gesetzte Stil oder der Standard, den die Seite zurzeit bekaeme. */
  stil: Stil | null;
  /** Wert fuer site.config.ts. null heisst: Feld stil leer lassen. */
  configStil: string | null;
  /** Standard haengt noch an einer offenen Palette oder fehlender Branche. */
  vorlaeufig: boolean;
  /** Ein Satz fuer Ansicht und YAML. */
  anzeige: string;
  bewegung: Bewegungsstufe;
  bewegungAngegeben: boolean;
}

/**
 * Was beim Bau in site.config.ts steht. Beim Standard bleibt das Feld stil
 * leer: dann waehlt der Build selbst den Standard zum Design der Palette,
 * auch wenn die Palette sich noch aendert. Nur ein ausdruecklich gewaehlter
 * Stil wird als Wert gesetzt.
 */
export function stilFuerBau(felder: Record<string, string | undefined>, templateId: string | undefined, palette: Palette | null): StilFuerBau {
  const wert = felder.stil;
  const gewaehlt = findeStil(wert);
  const bewegungGewaehlt = findeBewegung(felder.bewegung);
  const bewegung = bewegungGewaehlt ?? findeBewegung(BEWEGUNG_STANDARD)!;
  const basis = { bewegung, bewegungAngegeben: Boolean(bewegungGewaehlt) };
  if (gewaehlt) {
    return { ...basis, art: 'gewaehlt', stil: gewaehlt, configStil: gewaehlt.kennung, vorlaeufig: false, anzeige: `${gewaehlt.name} (${gewaehlt.beschreibung})` };
  }
  if (wert === STIL_OFFEN) {
    return { ...basis, art: 'offen', stil: null, configStil: null, vorlaeufig: true, anzeige: 'noch offen, mit dem Betrieb klären' };
  }
  const standard = standardStil(templateId, palette);
  const vorlaeufig = !standard || !palette;
  const zurzeit = standard ? `, ergibt zurzeit ${standard.name}${vorlaeufig ? ' (vorläufig, Palette noch offen)' : ''}` : ', Branche fehlt noch';
  const art = wert === STIL_STANDARD ? 'standard' : 'fehlt';
  const kopf = art === 'standard' ? 'Standard der Branche' : 'nicht angegeben, gilt als Standard der Branche';
  return { ...basis, art, stil: standard, configStil: null, vorlaeufig, anzeige: `${kopf}${zurzeit}` };
}
