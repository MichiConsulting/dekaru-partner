// Quizfragen: Format pruefen, Antworten aus dem Formular lesen, bewerten.
// Reine Funktionen ohne Datenbank und ohne Astro, damit sie sich testen lassen.
//
// Vier Fragetypen, Format nach inhalt/README.md:
//   multiple-choice  "richtig" ist eine Liste von Indizes, "mehrfach" erlaubt mehrere
//   wahr-falsch      eine Aussage stimmt oder nicht
//   zuordnen         Paare aus "links" und "rechts", die rechte Seite wird gemischt
//   lueckentext      Platzhalter {{n}} im Text, "luecken" nennt je Nummer die
//                    akzeptierten Antworten. Als Kurzform geht auch {{antwort|alternative}}

export interface FrageBasis {
  id: string;
  kapitel: string;
  erklaerung?: string;
}

export interface MultipleChoice extends FrageBasis {
  typ: 'multiple-choice';
  frage: string;
  optionen: string[];
  richtig: number[];
  mehrfach: boolean;
}

export interface WahrFalsch extends FrageBasis {
  typ: 'wahr-falsch';
  aussage: string;
  richtig: boolean;
}

export interface Zuordnen extends FrageBasis {
  typ: 'zuordnen';
  frage: string;
  paare: { links: string; rechts: string }[];
}

export interface Lueckentext extends FrageBasis {
  typ: 'lueckentext';
  text: string;
  /** Je Luecke die akzeptierten Antworten, in der Reihenfolge des Textes. */
  luecken: string[][];
}

export type Frage = MultipleChoice | WahrFalsch | Zuordnen | Lueckentext;

export type Antwort =
  | { typ: 'multiple-choice'; indizes: number[] }
  | { typ: 'wahr-falsch'; wert: boolean | null }
  | { typ: 'zuordnen'; zuordnung: Record<string, string> }
  | { typ: 'lueckentext'; eingaben: string[] };

export interface Bewertung {
  richtig: boolean;
  /** Je Teilaufgabe, ob sie stimmt: eine bei MC und Wahr/Falsch, eine je Paar oder Luecke. */
  teile: boolean[];
  loesung: string;
}

// ---------------------------------------------------------------------------
// Format

const TYPEN = ['multiple-choice', 'wahr-falsch', 'zuordnen', 'lueckentext'];

/** Prueft quiz.json. Fehlerhafte Fragen werden mit Begruendung uebersprungen. */
export function pruefeQuizDaten(daten: unknown): { fragen: Frage[]; fehler: string[] } {
  const fehler: string[] = [];
  const fragen: Frage[] = [];
  const liste = Array.isArray(daten) ? daten : (daten as { fragen?: unknown })?.fragen;
  if (!Array.isArray(liste)) return { fragen, fehler: ['quiz.json braucht ein Feld "fragen" mit einer Liste.'] };

  const ids = new Set<string>();
  liste.forEach((roh, index) => {
    const f = roh as Record<string, unknown>;
    const wo = `Frage ${index + 1}${f?.id ? ` (${f.id})` : ''}`;
    if (!f || typeof f !== 'object') return fehler.push(`${wo}: kein Objekt.`);
    const id = String(f.id ?? '').trim();
    if (!id) return fehler.push(`${wo}: id fehlt.`);
    if (ids.has(id)) return fehler.push(`${wo}: id doppelt.`);
    ids.add(id);
    const kapitel = String(f.kapitel ?? '').trim();
    if (!kapitel) return fehler.push(`${wo}: kapitel fehlt.`);
    const typ = f.typ === 'paare' ? 'zuordnen' : String(f.typ ?? '');
    if (!TYPEN.includes(typ)) return fehler.push(`${wo}: typ "${typ}" unbekannt.`);
    const basis = { id, kapitel, erklaerung: f.erklaerung ? String(f.erklaerung) : undefined };

    if (typ === 'multiple-choice') {
      const optionen = Array.isArray(f.optionen) ? f.optionen.map(String) : [];
      const richtig = (Array.isArray(f.richtig) ? f.richtig : [f.richtig]).map(Number);
      if (optionen.length < 2) return fehler.push(`${wo}: mindestens zwei Optionen.`);
      if (richtig.length === 0 || richtig.some((r) => !Number.isInteger(r) || r < 0 || r >= optionen.length)) {
        return fehler.push(`${wo}: richtig muss Indizes von 0 bis ${optionen.length - 1} enthalten.`);
      }
      const mehrfach = f.mehrfach === true || richtig.length > 1;
      fragen.push({ ...basis, typ, frage: String(f.frage ?? ''), optionen, richtig: [...new Set(richtig)].sort((a, b) => a - b), mehrfach });
    } else if (typ === 'wahr-falsch') {
      if (typeof f.richtig !== 'boolean') return fehler.push(`${wo}: richtig muss true oder false sein.`);
      fragen.push({ ...basis, typ, aussage: String(f.aussage ?? f.frage ?? ''), richtig: f.richtig });
    } else if (typ === 'zuordnen') {
      const roh = Array.isArray(f.paare) ? f.paare : [];
      const paare = roh
        .map((p: unknown) => {
          if (Array.isArray(p)) return { links: String(p[0] ?? ''), rechts: String(p[1] ?? '') };
          const o = p as Record<string, unknown>;
          return { links: String(o?.links ?? ''), rechts: String(o?.rechts ?? '') };
        })
        .filter((p) => p.links && p.rechts);
      if (paare.length < 2) return fehler.push(`${wo}: mindestens zwei Paare.`);
      if (new Set(paare.map((p) => p.links)).size !== paare.length) return fehler.push(`${wo}: linke Begriffe doppelt.`);
      fragen.push({ ...basis, typ, frage: String(f.frage ?? 'Ordnen Sie zu.'), paare });
    } else {
      const text = String(f.text ?? '');
      const teile = zerlegeLueckentext(text, lueckenListe(f.luecken));
      const alle = teile.filter((t): t is Extract<Textteil, { art: 'luecke' }> => t.art === 'luecke');
      if (alle.length === 0) return fehler.push(`${wo}: der Text hat keine Lücke {{...}}.`);
      const ohne = alle.find((l) => l.loesungen.length === 0);
      if (ohne) return fehler.push(`${wo}: für Lücke ${ohne.index + 1} fehlt die Lösung in "luecken".`);
      fragen.push({ ...basis, typ: 'lueckentext', text, luecken: alle.map((l) => l.loesungen) });
    }
  });
  return { fragen, fehler };
}

// ---------------------------------------------------------------------------
// Lueckentext

export type Textteil = { art: 'text'; text: string } | { art: 'luecke'; index: number; loesungen: string[] };

/** "luecken" aus quiz.json als Karte Nummer -> Loesungen. */
function lueckenListe(roh: unknown): Map<string, string[]> {
  const karte = new Map<string, string[]>();
  if (!Array.isArray(roh)) return karte;
  for (const eintrag of roh) {
    const o = (eintrag ?? {}) as Record<string, unknown>;
    const liste = Array.isArray(o.richtig) ? o.richtig : [o.richtig];
    karte.set(String(o.nr ?? ''), liste.map(String).map((l) => l.trim()).filter(Boolean));
  }
  return karte;
}

/**
 * Zerlegt einen Lueckentext in Text und Luecken. {{1}} schlaegt in der
 * Loesungsliste nach, {{antwort|alternative}} traegt die Loesung selbst.
 */
export function zerlegeLueckentext(text: string, loesungen: Map<string, string[]> = new Map()): Textteil[] {
  const teile: Textteil[] = [];
  const muster = /\{\{([^}]*)\}\}/g;
  let letzte = 0;
  let index = 0;
  for (const treffer of text.matchAll(muster)) {
    const start = treffer.index ?? 0;
    if (start > letzte) teile.push({ art: 'text', text: text.slice(letzte, start) });
    const inhalt = treffer[1].trim();
    // Eine reine Nummer verweist auf "luecken", alles andere traegt die Loesung selbst.
    const eigene = /^\d+$/.test(inhalt)
      ? (loesungen.get(inhalt) ?? [])
      : inhalt.split('|').map((l) => l.trim()).filter(Boolean);
    teile.push({ art: 'luecke', index, loesungen: eigene });
    index += 1;
    letzte = start + treffer[0].length;
  }
  if (letzte < text.length) teile.push({ art: 'text', text: text.slice(letzte) });
  return teile;
}

/** Textteile einer geprueften Frage, Loesungen schon aufgeloest. */
export function lueckenteile(frage: Lueckentext): Textteil[] {
  let i = 0;
  return zerlegeLueckentext(frage.text).map((t) =>
    t.art === 'luecke' ? { ...t, loesungen: frage.luecken[i++] ?? [] } : t,
  );
}

function normalisiere(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s*(€|eur|euro|%|prozent)$/g, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Antworten aus dem Formular

export function feldname(frage: Frage, teil?: number | string): string {
  const basis = `f_${frage.id}`;
  return teil === undefined ? basis : `${basis}__${teil}`;
}

/** Liest die Antwort einer Frage aus den Formularfeldern. */
export interface FormularQuelle {
  get(name: string): unknown;
  getAll?(name: string): unknown[];
}

export function antwortAusFormular(frage: Frage, form: FormularQuelle): Antwort {
  if (frage.typ === 'multiple-choice') {
    const roh = form.getAll ? form.getAll(feldname(frage)) : [form.get(feldname(frage))];
    const indizes = roh
      .filter((r) => r !== null && r !== undefined && r !== '')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0 && n < frage.optionen.length);
    return { typ: 'multiple-choice', indizes: [...new Set(indizes)].sort((a, b) => a - b) };
  }
  if (frage.typ === 'wahr-falsch') {
    const roh = form.get(feldname(frage));
    return { typ: 'wahr-falsch', wert: roh === 'wahr' ? true : roh === 'falsch' ? false : null };
  }
  if (frage.typ === 'zuordnen') {
    const zuordnung: Record<string, string> = {};
    frage.paare.forEach((p, i) => {
      const wert = form.get(feldname(frage, i));
      if (typeof wert === 'string' && wert) zuordnung[p.links] = wert;
    });
    return { typ: 'zuordnen', zuordnung };
  }
  const eingaben = frage.luecken.map((_, i) => String(form.get(feldname(frage, i)) ?? '').slice(0, 200));
  return { typ: 'lueckentext', eingaben };
}

// ---------------------------------------------------------------------------
// Bewertung

export function bewerte(frage: Frage, antwort: Antwort): Bewertung {
  if (frage.typ === 'multiple-choice') {
    const gewaehlt = antwort.typ === 'multiple-choice' ? antwort.indizes : [];
    const richtig = gewaehlt.length === frage.richtig.length && frage.richtig.every((r) => gewaehlt.includes(r));
    return { richtig, teile: [richtig], loesung: frage.richtig.map((r) => frage.optionen[r]).join('; ') };
  }
  if (frage.typ === 'wahr-falsch') {
    const richtig = antwort.typ === 'wahr-falsch' && antwort.wert === frage.richtig;
    return { richtig, teile: [richtig], loesung: frage.richtig ? 'Wahr' : 'Falsch' };
  }
  if (frage.typ === 'zuordnen') {
    const zuordnung = antwort.typ === 'zuordnen' ? antwort.zuordnung : {};
    const teile = frage.paare.map((p) => zuordnung[p.links] === p.rechts);
    return {
      richtig: teile.every(Boolean),
      teile,
      loesung: frage.paare.map((p) => `${p.links}: ${p.rechts}`).join(', '),
    };
  }
  const eingaben = antwort.typ === 'lueckentext' ? antwort.eingaben : [];
  const teile = frage.luecken.map((loesungen, i) => loesungen.some((l) => normalisiere(l) === normalisiere(eingaben[i] ?? '')));
  return { richtig: teile.every(Boolean), teile, loesung: frage.luecken.map((l) => l[0]).join(', ') };
}

/** Punkte eines Durchlaufs: eine je richtig beantworteter Frage. */
export function punkte(bewertungen: Bewertung[]): { punkte: number; max: number } {
  return { punkte: bewertungen.filter((b) => b.richtig).length, max: bewertungen.length };
}

/** Deterministisch gemischt, damit die rechte Spalte bei Paaren nicht die Loesung verraet. */
export function mischeStabil<T>(liste: T[], schluessel: string): T[] {
  let h = 2166136261;
  for (const zeichen of schluessel) {
    h ^= zeichen.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const ergebnis = [...liste];
  for (let i = ergebnis.length - 1; i > 0; i -= 1) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    const j = h % (i + 1);
    [ergebnis[i], ergebnis[j]] = [ergebnis[j], ergebnis[i]];
  }
  return ergebnis;
}
