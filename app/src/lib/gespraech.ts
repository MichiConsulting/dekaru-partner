// Gespraechshilfe: Format pruefen, Eintraege filtern, Pflichtsaetze ueben.
// Reine Funktionen ohne Datenbank und ohne Astro, damit sie sich testen lassen.
//
// Format nach inhalt/README.md, Abschnitt gespraechshilfe.json.

export const THEMEN = ['Preis', 'Ablauf', 'Hosting', 'Vertrauen', 'Kein Interesse', 'Recht und Datenschutz'] as const;
export type Thema = (typeof THEMEN)[number];

export const PLATZHALTER_NAME = '{{Ihr Name}}';

export interface Uebung {
  /** Woerter oder Wortgruppen, die im Lueckentext fehlen. Muessen im Satz vorkommen. */
  luecken: string[];
  /** Satzteile in der richtigen Reihenfolge. Mit Leerzeichen verbunden ergeben sie den Satz. */
  teile: string[];
}

export interface Eintrag {
  id: string;
  thema: Thema;
  frage: string;
  antwort: string;
  pflicht: boolean;
  hinweis?: string;
  uebung?: Uebung;
}

export interface Gespraechsdaten {
  einleitung: string;
  eintraege: Eintrag[];
}

// ---------------------------------------------------------------------------
// Format

function text(wert: unknown): string {
  return typeof wert === 'string' ? wert.trim() : '';
}

function normalisiereLeerraum(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Prueft gespraechshilfe.json. Fehlerhafte Eintraege werden mit Begruendung uebersprungen. */
export function pruefeGespraechsDaten(daten: unknown): { daten: Gespraechsdaten; fehler: string[] } {
  const fehler: string[] = [];
  const eintraege: Eintrag[] = [];
  const wurzel = (daten ?? {}) as Record<string, unknown>;
  const liste = Array.isArray(daten) ? daten : wurzel.eintraege;
  const einleitung = text(wurzel.einleitung) || 'Sechs Sätze lernen Sie wortgleich, alles andere sagen Sie in eigenen Worten.';
  if (!Array.isArray(liste)) {
    return { daten: { einleitung, eintraege }, fehler: ['gespraechshilfe.json braucht ein Feld "eintraege" mit einer Liste.'] };
  }

  const ids = new Set<string>();
  liste.forEach((roh, index) => {
    const e = (roh ?? {}) as Record<string, unknown>;
    const wo = `Eintrag ${index + 1}${e.id ? ` (${String(e.id)})` : ''}`;
    if (!roh || typeof roh !== 'object') return fehler.push(`${wo}: kein Objekt.`);
    const id = text(e.id);
    if (!id) return fehler.push(`${wo}: id fehlt.`);
    if (ids.has(id)) return fehler.push(`${wo}: id doppelt.`);
    const thema = text(e.thema);
    if (!(THEMEN as readonly string[]).includes(thema)) return fehler.push(`${wo}: thema "${thema}" unbekannt.`);
    const frage = text(e.frage);
    const antwort = text(e.antwort);
    if (!frage) return fehler.push(`${wo}: frage fehlt.`);
    if (!antwort) return fehler.push(`${wo}: antwort fehlt.`);
    const pflicht = e.pflicht === true;
    const hinweis = text(e.hinweis) || undefined;

    let uebung: Uebung | undefined;
    if (pflicht) {
      const u = (e.uebung ?? {}) as Record<string, unknown>;
      const luecken = Array.isArray(u.luecken) ? u.luecken.map(text).filter(Boolean) : [];
      const teile = Array.isArray(u.teile) ? u.teile.map(text).filter(Boolean) : [];
      if (luecken.length === 0) return fehler.push(`${wo}: Pflichtsatz ohne uebung.luecken.`);
      if (teile.length < 3) return fehler.push(`${wo}: Pflichtsatz braucht mindestens drei uebung.teile.`);
      if (normalisiereLeerraum(teile.join(' ')) !== normalisiereLeerraum(antwort)) {
        return fehler.push(`${wo}: uebung.teile ergeben zusammen nicht die antwort.`);
      }
      if (!lueckenPositionen(antwort, luecken)) return fehler.push(`${wo}: eine Luecke kommt im Satz nicht vor oder ueberschneidet sich.`);
      if (luecken.some((l) => l.includes(PLATZHALTER_NAME))) return fehler.push(`${wo}: der Platzhalter ${PLATZHALTER_NAME} darf keine Luecke sein.`);
      uebung = { luecken, teile };
    }

    ids.add(id);
    eintraege.push({ id, thema: thema as Thema, frage, antwort, pflicht, hinweis, uebung });
  });
  return { daten: { einleitung, eintraege }, fehler };
}

/** Setzt den Namen der angemeldeten Person in den Platzhalter ein. */
export function mitName(s: string, name: string): string {
  return s.split(PLATZHALTER_NAME).join(name.trim() || 'Ihr Name');
}

// ---------------------------------------------------------------------------
// Filter

export interface Filter {
  suche?: string;
  thema?: string;
}

function suchbar(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

/** Filtert nach Thema und nach Suchwoertern. Alle Woerter muessen in Frage, Antwort oder Hinweis vorkommen. */
export function filtereEintraege(eintraege: Eintrag[], filter: Filter): Eintrag[] {
  const thema = text(filter.thema);
  const woerter = suchbar(text(filter.suche)).split(/\s+/).filter(Boolean);
  return eintraege.filter((e) => {
    if (thema && e.thema !== thema) return false;
    if (woerter.length === 0) return true;
    const heu = suchbar(`${e.frage} ${e.antwort} ${e.hinweis ?? ''} ${e.thema}`);
    return woerter.every((w) => heu.includes(w));
  });
}

/** Der Text, in dem das Browser-Skript sucht. Dieselbe Normalisierung wie filtereEintraege. */
export function suchtext(e: Eintrag): string {
  return suchbar(`${e.frage} ${e.antwort} ${e.hinweis ?? ''} ${e.thema}`);
}

export function pflichtsaetze(eintraege: Eintrag[]): Eintrag[] {
  return eintraege.filter((e) => e.pflicht && e.uebung);
}

// ---------------------------------------------------------------------------
// Uebung

export type Modus = 'luecken' | 'reihenfolge';
export const MODI: Modus[] = ['luecken', 'reihenfolge'];

export type Satzteil = { art: 'text'; text: string } | { art: 'luecke'; index: number; loesung: string };

/** Positionen der Luecken im Satz, in Textreihenfolge. null, wenn eine fehlt oder sich zwei ueberschneiden. */
export function lueckenPositionen(satz: string, luecken: string[]): { start: number; ende: number; loesung: string }[] | null {
  const treffer: { start: number; ende: number; loesung: string }[] = [];
  for (const l of luecken) {
    // Nur ganze Woerter, damit "frei" nicht in "Freitag" landet.
    const muster = new RegExp(`(^|[^\\p{L}\\p{N}])(${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^\\p{L}\\p{N}])`, 'u');
    const m = muster.exec(satz);
    if (!m) return null;
    const start = (m.index ?? 0) + m[1].length;
    treffer.push({ start, ende: start + l.length, loesung: l });
  }
  treffer.sort((a, b) => a.start - b.start);
  for (let i = 1; i < treffer.length; i += 1) {
    if (treffer[i].start < treffer[i - 1].ende) return null;
  }
  return treffer;
}

/** Der Satz als Folge aus Text und Luecken. */
export function lueckenAufgabe(satz: string, luecken: string[]): Satzteil[] {
  const positionen = lueckenPositionen(satz, luecken) ?? [];
  const teile: Satzteil[] = [];
  let letzte = 0;
  positionen.forEach((p, index) => {
    if (p.start > letzte) teile.push({ art: 'text', text: satz.slice(letzte, p.start) });
    teile.push({ art: 'luecke', index, loesung: p.loesung });
    letzte = p.ende;
  });
  if (letzte < satz.length) teile.push({ art: 'text', text: satz.slice(letzte) });
  return teile;
}

/** Deterministisch gemischt. Ergibt nie die Originalreihenfolge, solange es mindestens zwei Teile gibt. */
export function reihenfolgeAufgabe(teile: string[], schluessel: string): string[] {
  let h = 2166136261;
  for (const zeichen of schluessel) {
    h ^= zeichen.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const naechste = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return h;
  };
  const ergebnis = [...teile];
  for (let versuch = 0; versuch < 20; versuch += 1) {
    for (let i = ergebnis.length - 1; i > 0; i -= 1) {
      const j = naechste() % (i + 1);
      [ergebnis[i], ergebnis[j]] = [ergebnis[j], ergebnis[i]];
    }
    if (ergebnis.some((t, i) => t !== teile[i])) return ergebnis;
  }
  return ergebnis.reverse();
}

export type UebungsAntwort =
  | { typ: 'luecken'; eingaben: string[] }
  /** gemischt: die Teile, wie sie beim Versuch angezeigt wurden, damit sich das Ergebnis spaeter nachzeichnen laesst. */
  | { typ: 'reihenfolge'; reihenfolge: number[]; gemischt?: string[] };

export interface UebungsBewertung {
  richtig: boolean;
  /** Je Luecke oder je Position, ob sie stimmt. */
  teile: boolean[];
}

function normalisiere(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s*(€|eur|euro)$/g, '')
    .trim();
}

export function feldname(modus: Modus, index: number): string {
  return `${modus === 'luecken' ? 'l' : 'r'}_${index}`;
}

export interface FormularQuelle {
  get(name: string): unknown;
}

/** Liest die Antwort aus den Formularfeldern. Bei der Reihenfolge je gemischtem Teil die gewaehlte Position (1-basiert). */
export function uebungsAntwortAusFormular(modus: Modus, anzahl: number, form: FormularQuelle): UebungsAntwort {
  if (modus === 'luecken') {
    const eingaben = Array.from({ length: anzahl }, (_, i) => String(form.get(feldname('luecken', i)) ?? '').slice(0, 200));
    return { typ: 'luecken', eingaben };
  }
  // reihenfolge[p] = Index des gemischten Teils, der an Position p steht. -1, wenn leer oder doppelt.
  const reihenfolge = Array.from({ length: anzahl }, () => -1);
  for (let i = 0; i < anzahl; i += 1) {
    const pos = Number(form.get(feldname('reihenfolge', i)));
    if (Number.isInteger(pos) && pos >= 1 && pos <= anzahl && reihenfolge[pos - 1] === -1) reihenfolge[pos - 1] = i;
  }
  return { typ: 'reihenfolge', reihenfolge };
}

export function bewerteUebung(
  modus: Modus,
  satz: string,
  uebung: Uebung,
  gemischt: string[],
  antwort: UebungsAntwort,
): UebungsBewertung {
  if (modus === 'luecken') {
    const loesungen = (lueckenPositionen(satz, uebung.luecken) ?? []).map((p) => p.loesung);
    const eingaben = antwort.typ === 'luecken' ? antwort.eingaben : [];
    const teile = loesungen.map((l, i) => normalisiere(l) === normalisiere(eingaben[i] ?? ''));
    return { richtig: teile.length > 0 && teile.every(Boolean), teile };
  }
  const reihenfolge = antwort.typ === 'reihenfolge' ? antwort.reihenfolge : [];
  const teile = uebung.teile.map((t, p) => {
    const index = reihenfolge[p];
    return index !== undefined && index >= 0 && gemischt[index] === t;
  });
  return { richtig: teile.every(Boolean), teile };
}

/** Welcher Modus beim naechsten Versuch dran ist: die Modi wechseln sich ab. */
export function modusFuerVersuch(versuche: number): Modus {
  return MODI[versuche % MODI.length];
}
