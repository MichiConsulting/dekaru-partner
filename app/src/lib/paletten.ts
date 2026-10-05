// Farbpaletten fuer Kundenseiten, wie sie im Template-System gesetzt werden.
// Quelle ist dekaru-templates/_system/paletten.mjs, hier liegt die
// abgeleitete Kopie src/data/paletten.json (npm run paletten-sync).
//
// Ein Code wie "HW-2" ist alles, was Michi beim Bau braucht: in der
// site.config.ts des Kunden steht dann palette: "HW-2".
//
// Ohne node-Abhaengigkeiten, nur Daten und kleine Helfer. Das Browser-Skript
// des Schemas importiert diese Datei trotzdem nicht: die Farben kommen dort
// fertig als Attribute aus dem Server.

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

export interface Palette {
  code: string;
  name: string;
  charakter: string;
  standard: boolean;
  farben: Partial<Record<FarbToken, string>> & Record<'bg' | 'surface' | 'ink' | 'ink-soft' | 'muted' | 'accent' | 'accent-deep' | 'on-accent' | 'border', string>;
  /** Farbe fuer Links und Textakzente auf der Seite. */
  link: string;
}

export interface PalettenBranche {
  id: string;
  kuerzel: string;
  label: string;
  modus: 'hell' | 'dunkel';
  standard: string;
  paletten: Palette[];
}

export const PALETTEN_BRANCHEN = daten.branchen as PalettenBranche[];
export const ALLE_PALETTEN: Palette[] = PALETTEN_BRANCHEN.flatMap((b) => b.paletten);

/** Wert im Briefing-Bogen, wenn der Betrieb noch keine Palette gewaehlt hat. */
export const PALETTE_OFFEN = 'offen';

/**
 * Schema-Branchen des Erstgespraechs auf Template-Branchen. Das Schema kennt
 * nur vier Gespraechsbranchen: Friseur gehoert im Template-System zu
 * "dienstleister" (Beauty), Praxis zu "gesundheit".
 */
export const SCHEMA_ZU_TEMPLATE: Record<string, string> = {
  handwerk: 'handwerk',
  gastro: 'gastro',
  friseur: 'dienstleister',
  praxis: 'gesundheit',
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

export function findePalette(code: string | null | undefined): Palette | null {
  if (!code) return null;
  const c = String(code).trim().toUpperCase();
  return ALLE_PALETTEN.find((p) => p.code === c) ?? null;
}

export function palettenBranche(templateId: string | null | undefined): PalettenBranche | null {
  return PALETTEN_BRANCHEN.find((b) => b.id === templateId) ?? null;
}

/** Zu welcher Template-Branche gehoert ein Code? */
export function brancheVonPalette(code: string): PalettenBranche | null {
  return PALETTEN_BRANCHEN.find((b) => b.paletten.some((p) => p.code === code)) ?? null;
}

/** Ueberschrift fuer die Ansage: "Palette HW-2 Petrol". */
export const paletteTitel = (p: Palette) => `Palette ${p.code} ${p.name}`;

/**
 * CSS-Variablen fuer eine Palettenprobe im Portal, als style-Attribut. Die
 * Probe zeigt bewusst die Farben der Palette, nicht die des Portals.
 */
export function probeStil(p: Palette): string {
  const f = p.farben;
  return [
    `--pl-bg:${f.bg}`,
    `--pl-surface:${f.surface}`,
    `--pl-ink:${f.ink}`,
    `--pl-ink-soft:${f['ink-soft']}`,
    `--pl-muted:${f.muted}`,
    `--pl-accent:${f.accent}`,
    `--pl-accent-deep:${f['accent-deep']}`,
    `--pl-on-accent:${f['on-accent']}`,
    `--pl-border:${f.border}`,
    `--pl-link:${p.link}`,
  ].join(';');
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

/**
 * Palette aus der Adresse des Schemas, nur wenn sie zur Schema-Branche
 * gehoert. Sonst null (dann zeigt das Schema keine Wahl an).
 */
export function paletteFuerSchema(schemaBranche: string, code: string | null | undefined): Palette | null {
  const p = findePalette(code);
  if (!p) return null;
  return brancheVonPalette(p.code)?.id === SCHEMA_ZU_TEMPLATE[schemaBranche] ? p : null;
}
