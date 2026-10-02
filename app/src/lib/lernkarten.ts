// Lernkarten: die kurze Lernversion eines Kapitels, Format pruefen.
// Reine Funktionen ohne Astro und ohne Datenbank, damit sie sich testen lassen.
//
// Je Kapitel eine Datei inhalt/lernen/<kapitel>.json mit 4 bis 8 Karten.
// Jede Karte hat einen Titel und 1 bis 3 Kernsaetze (zusammen hoechstens
// 40 Woerter). Dazu wahlweise eine Grafik, eine Kennzahl, eine Mini-Tabelle,
// eine kurze Liste oder ein Zitat fuer das Gespraech, und ein Merksatz.

export const ICONS = [
  'sprechblase',
  'person',
  'paket',
  'stern',
  'telefon',
  'warnung',
  'liste',
  'zahnrad',
  'plus',
  'euro',
  'google',
  'dokument',
  'server',
  'treppe',
  'haken',
  'kreuz',
  'uhr',
  'kalender',
  'mail',
  'weg',
  'lupe',
  'karte',
  'schild',
  'hand',
  'buch',
  'bildschirm',
] as const;

export type Icon = (typeof ICONS)[number];

export interface Kennzahl {
  wert: string;
  label: string;
}

export interface MiniTabelle {
  kopf: string[];
  zeilen: string[][];
}

export interface Lernkarte {
  titel: string;
  icon: Icon;
  saetze: string[];
  grafik?: string;
  kennzahl?: Kennzahl;
  tabelle?: MiniTabelle;
  liste?: string[];
  zitat?: string;
  merke?: string;
}

export interface Lernkapitel {
  kapitel: string;
  karten: Lernkarte[];
}

export const MIN_KARTEN = 4;
export const MAX_KARTEN = 8;
export const MAX_WOERTER_SAETZE = 40;
export const MAX_WOERTER_ZITAT = 80;
export const MAX_LISTE = 6;
export const MAX_TABELLE_ZEILEN = 11;

export function zaehleWoerter(text: string): number {
  return String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function istText(wert: unknown): wert is string {
  return typeof wert === 'string' && wert.trim().length > 0;
}

/**
 * Prueft eine Lernkarten-Datei. Liefert das geprueefte Kapitel oder eine
 * Liste von Fehlern. Anders als beim Quiz wird nichts uebersprungen: eine
 * fehlerhafte Karte macht die Datei ungueltig, damit der Fehler auffaellt.
 */
export function pruefeLernkarten(
  daten: unknown,
  erwartetesKapitel?: string,
  bekannteGrafiken?: Set<string>,
): { kapitel: Lernkapitel | null; fehler: string[] } {
  const fehler: string[] = [];
  const roh = daten as Record<string, unknown> | null;
  if (!roh || typeof roh !== 'object') return { kapitel: null, fehler: ['Die Datei braucht ein Objekt mit "kapitel" und "karten".'] };

  const kapitel = String(roh.kapitel ?? '').trim();
  if (!kapitel) fehler.push('"kapitel" fehlt.');
  if (erwartetesKapitel && kapitel && kapitel !== erwartetesKapitel) {
    fehler.push(`"kapitel" ist "${kapitel}", der Dateiname sagt "${erwartetesKapitel}".`);
  }

  const liste = Array.isArray(roh.karten) ? roh.karten : null;
  if (!liste) return { kapitel: null, fehler: [...fehler, '"karten" muss eine Liste sein.'] };
  if (liste.length < MIN_KARTEN || liste.length > MAX_KARTEN) {
    fehler.push(`${liste.length} Karten, erlaubt sind ${MIN_KARTEN} bis ${MAX_KARTEN}.`);
  }

  const karten: Lernkarte[] = [];
  liste.forEach((rohKarte, index) => {
    const k = rohKarte as Record<string, unknown>;
    const wo = `Karte ${index + 1}`;
    if (!k || typeof k !== 'object') return fehler.push(`${wo}: kein Objekt.`);

    if (!istText(k.titel)) fehler.push(`${wo}: titel fehlt.`);
    const icon = String(k.icon ?? '');
    if (!(ICONS as readonly string[]).includes(icon)) fehler.push(`${wo}: icon "${icon}" unbekannt.`);

    const saetze = Array.isArray(k.saetze) ? k.saetze.filter(istText) : [];
    if (saetze.length < 1 || saetze.length > 3) fehler.push(`${wo}: 1 bis 3 Kernsätze, nicht ${saetze.length}.`);
    const woerter = saetze.reduce((summe, s) => summe + zaehleWoerter(s), 0);
    if (woerter > MAX_WOERTER_SAETZE) fehler.push(`${wo}: ${woerter} Wörter in den Kernsätzen, erlaubt sind ${MAX_WOERTER_SAETZE}.`);

    const visuelle = ['grafik', 'kennzahl', 'tabelle', 'liste', 'zitat'].filter((feld) => k[feld] !== undefined && k[feld] !== null);
    if (visuelle.length > 2) fehler.push(`${wo}: höchstens zwei von grafik, kennzahl, tabelle, liste, zitat.`);

    const karte: Lernkarte = { titel: String(k.titel ?? '').trim(), icon: icon as Icon, saetze };

    if (k.grafik !== undefined) {
      const grafik = String(k.grafik ?? '');
      if (!/^[a-z0-9-]+\.svg$/.test(grafik)) fehler.push(`${wo}: grafik "${grafik}" ist kein Dateiname wie name.svg.`);
      else if (bekannteGrafiken && !bekannteGrafiken.has(grafik)) fehler.push(`${wo}: grafik "${grafik}" gibt es nicht.`);
      karte.grafik = grafik;
    }
    if (k.kennzahl !== undefined) {
      const z = k.kennzahl as Record<string, unknown>;
      if (!z || !istText(z.wert) || !istText(z.label)) fehler.push(`${wo}: kennzahl braucht wert und label.`);
      else karte.kennzahl = { wert: z.wert.trim(), label: z.label.trim() };
    }
    if (k.tabelle !== undefined) {
      const t = k.tabelle as Record<string, unknown>;
      const kopf = Array.isArray(t?.kopf) ? t.kopf.map(String) : null;
      const zeilen = Array.isArray(t?.zeilen) ? t.zeilen : null;
      if (!kopf || !zeilen || zeilen.length === 0) fehler.push(`${wo}: tabelle braucht kopf und zeilen.`);
      else if (zeilen.length > MAX_TABELLE_ZEILEN) fehler.push(`${wo}: tabelle hat ${zeilen.length} Zeilen, erlaubt sind ${MAX_TABELLE_ZEILEN}.`);
      else if (zeilen.some((z) => !Array.isArray(z) || z.length !== kopf.length)) {
        fehler.push(`${wo}: jede Tabellenzeile braucht ${kopf.length} Zellen wie der Kopf.`);
      } else karte.tabelle = { kopf, zeilen: zeilen.map((z) => (z as unknown[]).map(String)) };
    }
    if (k.liste !== undefined) {
      const eintraege = Array.isArray(k.liste) ? k.liste.filter(istText) : [];
      if (eintraege.length < 2 || eintraege.length > MAX_LISTE) fehler.push(`${wo}: liste braucht 2 bis ${MAX_LISTE} Einträge.`);
      karte.liste = eintraege.map((e) => e.trim());
    }
    if (k.zitat !== undefined) {
      if (!istText(k.zitat)) fehler.push(`${wo}: zitat ist leer.`);
      else if (zaehleWoerter(k.zitat) > MAX_WOERTER_ZITAT) fehler.push(`${wo}: zitat hat ${zaehleWoerter(k.zitat)} Wörter, erlaubt sind ${MAX_WOERTER_ZITAT}.`);
      karte.zitat = String(k.zitat).trim();
    }
    if (k.merke !== undefined) {
      if (!istText(k.merke)) fehler.push(`${wo}: merke ist leer.`);
      karte.merke = String(k.merke).trim();
    }
    karten.push(karte);
  });

  if (fehler.length > 0) return { kapitel: null, fehler };
  return { kapitel: { kapitel, karten }, fehler };
}

/** Notloesung, wenn zu einem Kapitel keine Lernkarten vorliegen. */
export function ersatzKarten(titel: string, kurz: string | undefined): Lernkarte[] {
  return [
    {
      titel,
      icon: 'buch',
      saetze: [kurz || 'Zu diesem Kapitel gibt es noch keine Lernkarten. Lesen Sie das Kapitel ausführlich.'],
    },
  ];
}
