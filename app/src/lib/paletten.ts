// Farbpaletten fuer Kundenseiten, wie sie im Template-System gesetzt werden.
// Quelle ist dekaru-templates/_system/paletten.mjs (mit paletten-katalog.mjs),
// hier liegt die abgeleitete Kopie src/data/paletten.json (npm run paletten-sync).
//
// Seit 06.10.2026 ein Katalog: 120 Paletten in Farbgruppen, unabhaengig von der
// Branche. Jede gilt in jedem Template, ausser den wenigen, deren vorlagen nur
// "hell" oder nur "dunkel" nennen. Die Paletten, die fuer eine Branche entstanden
// sind, zeigt das Schema als Empfehlung "Passt oft zu Ihrer Branche".
//
// Ein Code wie "BL-2" ist alles, was Michi beim Bau braucht: in der
// site.config.ts des Kunden steht dann palette: "BL-2".
//
// Ohne node-Abhaengigkeiten, nur Daten und kleine Helfer. Das Browser-Skript
// des Schemas importiert diese Datei nicht: es bekommt eine kompakte Kopie als
// JSON im Seitenquelltext (schemaDaten).

import daten from '../data/paletten.json' with { type: 'json' };

export type FarbToken =
  | 'bg'
  | 'surface'
  | 'sand'
  | 'border'
  | 'ink'
  | 'ink-soft'
  | 'muted'
  | 'accent'
  | 'accent-deep'
  | 'on-accent'
  | 'accent-on-dark'
  | 'success'
  | 'danger';

export type Design = 'hell' | 'dunkel';

export interface Palette {
  code: string;
  name: string;
  charakter: string;
  /** Kuerzel der Farbgruppe, z. B. "BL". */
  gruppe: string;
  /** Design der Palette selbst. */
  modus: Design;
  /** In welchen Template-Designs die Palette gebaut werden darf. */
  vorlagen: Design[];
  /** Nur Gruppe IN: die Website, deren Stimmung nachempfunden ist. */
  inspiriert?: string;
  /** Nur Branchenpaletten: Template-Branche und ob es deren Standard ist. */
  branche?: string;
  standard?: boolean;
  farben: Partial<Record<FarbToken, string>> & Record<'bg' | 'surface' | 'ink' | 'ink-soft' | 'muted' | 'accent' | 'accent-deep' | 'on-accent' | 'border', string>;
  /** Farbe fuer Links und Textakzente auf der Seite. */
  link: string;
}

export interface Farbgruppe {
  kuerzel: string;
  label: string;
  beschreibung: string;
  codes: string[];
}

export interface PalettenBranche {
  id: string;
  kuerzel: string;
  label: string;
  modus: Design;
  standard: string;
  /** Fuer diese Branche entstandene Paletten, die erste ist der Standard. */
  empfohlen: string[];
}

export const ALLE_PALETTEN = daten.paletten as Palette[];
export const FARBGRUPPEN = daten.gruppen as Farbgruppe[];
export const PALETTEN_BRANCHEN = daten.branchen as PalettenBranche[];
/** Pflichtsatz neben jeder Auswahl mit "inspiriert von"-Paletten. */
export const HINWEIS_NAMEN: string = daten.hinweisNamen;
/** Kuerzel der Gruppe "Inspiriert von bekannten Websites". */
export const GRUPPE_INSPIRIERT = 'IN';

/** Wert im Briefing-Bogen, wenn der Betrieb noch keine Palette gewaehlt hat. */
export const PALETTE_OFFEN = 'offen';

/**
 * Schema-Branchen des Erstgespraechs auf Template-Branchen. Das Schema kennt
 * sieben Gespraechsbranchen: Friseur gehoert im Template-System zu
 * "dienstleister" (Beauty), Praxis zu "gesundheit", Umzug, Reinigung und
 * Garten haben je ein gleichnamiges Template (seit 06.10.2026).
 */
export const SCHEMA_ZU_TEMPLATE: Record<string, string> = {
  handwerk: 'handwerk',
  gastro: 'gastro',
  friseur: 'dienstleister',
  praxis: 'gesundheit',
  umzug: 'umzug',
  reinigung: 'reinigung',
  garten: 'garten',
};

/**
 * Branchen des Briefing-Bogens (Teil B) auf Template-Branchen. Die zehn
 * Eintraege entsprechen eins zu eins den zehn Templates.
 */
export const BRIEFING_ZU_TEMPLATE: Record<string, string> = {
  Handwerk: 'handwerk',
  Gastronomie: 'gastro',
  Dienstleister: 'dienstleister',
  'Gesundheit, Praxis': 'gesundheit',
  'Garten- und Landschaftsbau': 'garten',
  Reinigung: 'reinigung',
  Umzug: 'umzug',
  Tierbetreuung: 'tierbetreuung',
  Fitness: 'fitness',
  Tattoo: 'tattoo',
};

const NACH_CODE = new Map(ALLE_PALETTEN.map((p) => [p.code, p]));

export function findePalette(code: string | null | undefined): Palette | null {
  if (!code) return null;
  return NACH_CODE.get(String(code).trim().toUpperCase()) ?? null;
}

export function findeGruppe(kuerzel: string | null | undefined): Farbgruppe | null {
  if (!kuerzel) return null;
  const k = String(kuerzel).trim().toUpperCase();
  return FARBGRUPPEN.find((g) => g.kuerzel === k) ?? null;
}

export function palettenDerGruppe(g: Farbgruppe): Palette[] {
  return g.codes.map((c) => NACH_CODE.get(c)).filter((p): p is Palette => Boolean(p));
}

export function gruppeVon(p: Palette): Farbgruppe {
  return FARBGRUPPEN.find((g) => g.kuerzel === p.gruppe)!;
}

export function palettenBranche(templateId: string | null | undefined): PalettenBranche | null {
  return PALETTEN_BRANCHEN.find((b) => b.id === templateId) ?? null;
}

/** Empfohlene Paletten einer Template-Branche ("Passt oft zu Ihrer Branche"). */
export function empfohlenePaletten(templateId: string | null | undefined): Palette[] {
  const b = palettenBranche(templateId);
  return b ? b.empfohlen.map((c) => NACH_CODE.get(c)).filter((p): p is Palette => Boolean(p)) : [];
}

/** Darf die Palette im Template dieser Branche gebaut werden? */
export function passtZuTemplate(p: Palette, templateId: string): boolean {
  const b = palettenBranche(templateId);
  return !b || p.vorlagen.includes(b.modus);
}

/** Kurzer Hinweis, wenn eine Palette nicht in jedes Template-Design passt. */
export function eignungsHinweis(p: Palette): string | null {
  if (p.vorlagen.length >= 2) return null;
  return p.vorlagen[0] === 'dunkel' ? 'Nur im dunklen Tattoo-Design' : 'Nicht im dunklen Tattoo-Design';
}

/** Ueberschrift fuer die Ansage: "Palette HW-2 Petrol". */
export const paletteTitel = (p: Palette) => `Palette ${p.code} ${p.name}`;

/** Reihenfolge der Farben im kompakten Format (Schema-Daten, Probe). */
const PROBE_TOKENS = ['bg', 'surface', 'ink', 'ink-soft', 'muted', 'accent', 'accent-deep', 'on-accent', 'border'] as const;

/**
 * CSS-Variablen fuer eine Palettenprobe im Portal, als style-Attribut. Die
 * Probe zeigt bewusst die Farben der Palette, nicht die des Portals.
 * scripts/schema.ts baut denselben Text im Browser (gleiche Reihenfolge).
 */
export function probeStil(p: Palette): string {
  return [...PROBE_TOKENS.map((t) => `--pl-${t}:${p.farben[t]}`), `--pl-link:${p.link}`].join(';');
}

/** Die Farbfelder einer Karte, in Leserichtung. */
export function farbfelder(p: Palette): { token: FarbToken; farbe: string; name: string }[] {
  const f = p.farben;
  return [
    { token: 'accent', farbe: f.accent, name: 'Akzent' },
    { token: 'accent-deep', farbe: f['accent-deep'], name: 'Akzent dunkel' },
    { token: 'ink', farbe: f.ink, name: 'Schrift' },
    { token: 'surface', farbe: f.surface, name: 'Fläche' },
    { token: 'bg', farbe: f.bg, name: 'Hintergrund' },
  ];
}

/** Farbstreifen einer Gruppe: die Akzente ihrer Paletten als harter Verlauf. */
export function gruppenStreifen(g: Farbgruppe): string {
  const farben = palettenDerGruppe(g).map((p) => p.farben.accent);
  const schritt = 100 / farben.length;
  const stopps = farben.map((f, i) => `${f} ${(i * schritt).toFixed(2)}% ${((i + 1) * schritt).toFixed(2)}%`);
  return `linear-gradient(90deg,${stopps.join(',')})`;
}

/**
 * Kompakte Daten fuer das Browser-Skript des Schemas: je Palette Name,
 * Charakter, Gruppe, Zusatzzeile und die Probefarben als eine Zeichenkette
 * (PROBE_TOKENS, dann link, je sieben Zeichen). Rund 15 KB statt 120 fertiger
 * Karten im HTML. Keine Preise, keine Zahlen ausser Farben.
 */
export function schemaDaten(): {
  gruppen: Record<string, { label: string; codes: string[] }>;
  paletten: Record<string, [string, string, string, string, string]>;
} {
  const gruppen = Object.fromEntries(FARBGRUPPEN.map((g) => [g.kuerzel, { label: g.label, codes: g.codes }]));
  const paletten = Object.fromEntries(
    ALLE_PALETTEN.map((p) => [
      p.code,
      [p.name, p.charakter, p.gruppe, zusatzZeile(p), [...PROBE_TOKENS.map((t) => p.farben[t]), p.link].join('')] as [string, string, string, string, string],
    ]),
  );
  return { gruppen, paletten };
}

/** Kleine Zeile unter dem Charakter: Herkunft und Einschraenkung. */
export function zusatzZeile(p: Palette): string {
  return [p.inspiriert ? `Inspiriert von ${p.inspiriert}` : '', eignungsHinweis(p) ?? ''].filter(Boolean).join('. ');
}

/** Palette aus der Adresse des Schemas. Seit dem Katalog fuer jede Branche gueltig. */
export function paletteFuerSchema(code: string | null | undefined): Palette | null {
  return findePalette(code);
}

/**
 * Offene Gruppe im Schema, nur aus ?gruppe. Eine gewaehlte Palette allein
 * oeffnet keine Gruppe: dann steht die Uebersicht da, die Wahl gross darueber.
 */
export function gruppeFuerSchema(kuerzel: string | null | undefined): Farbgruppe | null {
  return findeGruppe(kuerzel);
}
