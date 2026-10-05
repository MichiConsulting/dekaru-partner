// Kalender-Ansichten: welche Ansicht und welches Datum die URL meint, welcher
// Zeitraum dafuer geladen wird, Vor und Zurueck, das Monatsraster und die
// Lage der Termine im Stundenraster. Ohne Astro, damit es testbar bleibt.

import type { KalenderEintrag } from './kalender.ts';
import { STANDARD_DAUER } from './kunden.ts';
import {
  datumLang,
  istIsoDatum,
  istMonat,
  kalenderwoche,
  monat,
  monatPlus,
  monatVon,
  monatsTitel,
  plusTage,
  woche,
  wochentagName,
  type Bereich,
} from './datum.ts';

export type Ansicht = 'monat' | 'woche' | 'tag' | 'liste';

export const ANSICHTEN: readonly { wert: Ansicht; label: string }[] = [
  { wert: 'monat', label: 'Monat' },
  { wert: 'woche', label: 'Woche' },
  { wert: 'tag', label: 'Tag' },
  { wert: 'liste', label: 'Liste' },
];

export const STANDARD_ANSICHT: Ansicht = 'monat';

function istAnsicht(wert: unknown): wert is Ansicht {
  return ANSICHTEN.some((a) => a.wert === wert);
}

/**
 * Liest Ansicht und Datum aus der URL (?ansicht=monat&datum=2026-10-05).
 * Alte Links bleiben gueltig: ?von=JJJJ-MM-TT war die Woche,
 * ?ansicht=monat&monat=JJJJ-MM der Monat. Unbekanntes faellt auf den
 * Monat mit heute zurueck.
 */
export function leseAnsicht(params: URLSearchParams, heute: string): { ansicht: Ansicht; datum: string } {
  const roh = params.get('ansicht');
  const datum = params.get('datum');
  const von = params.get('von');
  const alterMonat = params.get('monat');

  if (istIsoDatum(datum)) {
    return { ansicht: istAnsicht(roh) ? roh : STANDARD_ANSICHT, datum };
  }
  if (!roh && istIsoDatum(von)) return { ansicht: 'woche', datum: von };
  if (roh === 'monat' && istMonat(alterMonat)) {
    return { ansicht: 'monat', datum: alterMonat === monatVon(heute) ? heute : `${alterMonat}-01` };
  }
  return { ansicht: istAnsicht(roh) ? roh : STANDARD_ANSICHT, datum: heute };
}

export function kalenderUrl(ansicht: Ansicht, datum: string, anker = ''): string {
  return `/kalender?ansicht=${ansicht}&datum=${datum}${anker ? `#${anker}` : ''}`;
}

/** Link zum Anlegen eines Termins, vorbelegt mit Datum und wahlweise Uhrzeit. */
export function neuUrl(datum: string, beginn?: string | null): string {
  return `/kalender/neu?datum=${datum}${beginn ? `&beginn=${encodeURIComponent(beginn)}` : ''}`;
}

/** Erster bis letzter sichtbarer Tag des Monatsrasters, Montag bis Sonntag. */
export function monatsBereich(datum: string): Bereich {
  const m = monat(monatVon(datum));
  return { von: woche(m.von).von, bis: woche(m.bis).bis };
}

/** Der Zeitraum, dessen Eintraege die Ansicht braucht. */
export function bereichFuer(ansicht: Ansicht, datum: string): Bereich {
  switch (ansicht) {
    case 'monat':
      // Das ganze Raster, damit auch die Tage der Nachbarmonate ihre Eintraege zeigen.
      return monatsBereich(datum);
    case 'woche':
      return woche(datum);
    case 'tag':
      return { von: datum, bis: datum };
    case 'liste':
      return monat(monatVon(datum));
  }
}

/** Gleicher Tag im Nachbarmonat, am Monatsende gekappt (31.10. wird 30.11.). */
function monatSchritt(datum: string, schritte: number): string {
  const ziel = monatPlus(monatVon(datum), schritte);
  const letzter = monat(ziel).bis;
  const tag = `${ziel}-${datum.slice(8, 10)}`;
  return tag > letzter ? letzter : tag;
}

/** Datum nach einem Schritt vor (1) oder zurueck (-1) in der Ansicht. */
export function schritt(ansicht: Ansicht, datum: string, richtung: 1 | -1): string {
  switch (ansicht) {
    case 'monat':
    case 'liste':
      return monatSchritt(datum, richtung);
    case 'woche':
      return plusTage(datum, 7 * richtung);
    case 'tag':
      return plusTage(datum, richtung);
  }
}

export function schrittText(ansicht: Ansicht, richtung: 1 | -1): string {
  const einheit = { monat: 'Monat', liste: 'Monat', woche: 'Woche', tag: 'Tag' }[ansicht];
  if (richtung === 1) return einheit === 'Woche' ? 'Nächste Woche' : `Nächster ${einheit}`;
  return einheit === 'Woche' ? 'Vorige Woche' : `Voriger ${einheit}`;
}

export function titelFuer(ansicht: Ansicht, datum: string): string {
  if (ansicht === 'monat' || ansicht === 'liste') {
    return monatsTitel(monatVon(datum));
  }
  if (ansicht === 'tag') return `${wochentagName(datum)}, ${datumLang(datum)}`;
  const w = woche(datum);
  const gleichesJahr = w.von.slice(0, 4) === w.bis.slice(0, 4);
  const gleicherMonat = w.von.slice(0, 7) === w.bis.slice(0, 7);
  const anfang = gleicherMonat ? `${Number(w.von.slice(8, 10))}.` : datumLang(w.von, !gleichesJahr);
  return `KW ${kalenderwoche(datum)}, ${anfang} bis ${datumLang(w.bis)}`;
}

/** Wochen des Monatsrasters, je sieben Tage von Montag bis Sonntag. */
export function monatsRaster(datum: string): string[][] {
  const { von, bis } = monatsBereich(datum);
  const wochen: string[][] = [];
  for (let tag = von; tag <= bis; tag = plusTage(tag, 7)) {
    wochen.push(Array.from({ length: 7 }, (_, i) => plusTage(tag, i)));
  }
  return wochen;
}

/** Wie viele Balken eine Monatszelle zeigt; der Rest wird zu "+n weitere". */
export const BALKEN_JE_ZELLE = 3;

export function sichtbareBalken<T>(eintraege: T[], max = BALKEN_JE_ZELLE): { zeigen: T[]; weitere: number } {
  if (eintraege.length <= max) return { zeigen: eintraege, weitere: 0 };
  return { zeigen: eintraege.slice(0, max - 1), weitere: eintraege.length - (max - 1) };
}

// ---------------------------------------------------------------------------
// Stundenraster fuer Woche und Tag

export const STUNDEN_STANDARD = { von: 7, bis: 20 } as const;

function minuten(zeit: string): number {
  const [h, m] = zeit.split(':').map(Number);
  return h * 60 + m;
}

/** Ende in Minuten seit Mitternacht des Beginntags, hoechstens 24:00. */
function endeMinuten(e: Pick<KalenderEintrag, 'beginn' | 'dauerMinuten'>): number {
  return Math.min(24 * 60, minuten(e.beginn ?? '00:00') + (e.dauerMinuten ?? STANDARD_DAUER));
}

/**
 * Sichtbarer Stundenbereich: 7 bis 20 Uhr, erweitert um Termine davor oder
 * danach, damit nichts aus dem Raster faellt.
 */
export function stundenBereich(eintraege: Pick<KalenderEintrag, 'beginn' | 'dauerMinuten'>[]): { von: number; bis: number } {
  let von: number = STUNDEN_STANDARD.von;
  let bis: number = STUNDEN_STANDARD.bis;
  for (const e of eintraege) {
    if (!e.beginn) continue;
    von = Math.min(von, Math.floor(minuten(e.beginn) / 60));
    bis = Math.max(bis, Math.ceil(endeMinuten(e) / 60));
  }
  return { von, bis };
}

export interface Platzierung<T> {
  eintrag: T;
  /** Abstand von oben in Prozent des Rasters. */
  oben: number;
  /** Hoehe in Prozent des Rasters. */
  hoehe: number;
  /** Spur (0 bis spuren - 1) bei ueberlappenden Terminen. */
  spur: number;
  spuren: number;
  /** Ende als HH:MM, 24:00 bei Terminen ueber Mitternacht. */
  ende: string;
}

/** Kuerzeste dargestellte Dauer, damit auch ein 5-Minuten-Termin lesbar bleibt. */
const MIN_ANZEIGE_MINUTEN = 20;

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * Legt die Termine eines Tages mit Uhrzeit ins Raster. Ueberlappende Termine
 * stehen nebeneinander: jede Gruppe sich ueberschneidender Termine bekommt
 * so viele Spuren, wie gleichzeitig noetig sind, jeder Termin die erste freie.
 */
export function legeTagAus<T extends Pick<KalenderEintrag, 'beginn' | 'dauerMinuten'>>(
  eintraege: T[],
  bereich: { von: number; bis: number },
): Platzierung<T>[] {
  const start = bereich.von * 60;
  const gesamt = (bereich.bis - bereich.von) * 60;
  const mitZeit = eintraege
    .filter((e) => e.beginn)
    .map((e) => ({ e, a: minuten(e.beginn!), b: endeMinuten(e) }))
    .sort((x, y) => x.a - y.a || y.b - x.b);

  const ergebnis: Platzierung<T>[] = [];
  let gruppe: Platzierung<T>[] = [];
  let spurEnden: number[] = [];
  let gruppenEnde = -1;

  const schliesseGruppe = () => {
    for (const p of gruppe) p.spuren = spurEnden.length;
    gruppe = [];
    spurEnden = [];
  };

  for (const { e, a, b } of mitZeit) {
    // Fuer die Ueberschneidung zaehlt die sichtbare Hoehe, sonst lagen kurze
    // Termine optisch uebereinander.
    const sichtbarB = Math.max(b, a + MIN_ANZEIGE_MINUTEN);
    if (a >= gruppenEnde) schliesseGruppe();
    let spur = spurEnden.findIndex((ende) => ende <= a);
    if (spur === -1) {
      spur = spurEnden.length;
      spurEnden.push(sichtbarB);
    } else {
      spurEnden[spur] = sichtbarB;
    }
    gruppenEnde = Math.max(gruppenEnde, sichtbarB);
    const p: Platzierung<T> = {
      eintrag: e,
      oben: ((a - start) / gesamt) * 100,
      hoehe: ((sichtbarB - a) / gesamt) * 100,
      spur,
      spuren: 1,
      ende: hhmm(b),
    };
    gruppe.push(p);
    ergebnis.push(p);
  }
  schliesseGruppe();
  return ergebnis;
}

/** Lage der Linie "jetzt" in Prozent, oder null ausserhalb des Rasters. */
export function jetztLage(minutenSeitMitternacht: number, bereich: { von: number; bis: number }): number | null {
  const start = bereich.von * 60;
  const ende = bereich.bis * 60;
  if (minutenSeitMitternacht < start || minutenSeitMitternacht > ende) return null;
  return ((minutenSeitMitternacht - start) / (ende - start)) * 100;
}

/** Art und Zeit: "Termin, 14:30 bis 15:30 Uhr" oder "Wiedervorlage, ganztägig". */
export function eintragArtZeit(e: Pick<KalenderEintrag, 'typ' | 'beginn' | 'dauerMinuten'>): string {
  const art = e.typ === 'termin' ? 'Termin' : 'Wiedervorlage';
  return `${art}, ${e.beginn ? `${e.beginn} bis ${hhmm(endeMinuten(e))} Uhr` : 'ganztägig'}`;
}

/** Text fuer Screenreader und Tooltip: "Termin, 14:30 bis 15:30 Uhr: Baeckerei Muster, Termin vereinbart". */
export function eintragBeschreibung(e: Pick<KalenderEintrag, 'typ' | 'beginn' | 'dauerMinuten' | 'kundeName'>, statusText: string): string {
  return `${eintragArtZeit(e)}: ${e.kundeName}, ${statusText}`;
}
