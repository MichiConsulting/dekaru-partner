// Quizfragen: Format pruefen, Antworten aus dem Formular lesen, bewerten.
// Reine Funktionen ohne Datenbank und ohne Astro, damit sie sich testen lassen.
//
// Vier Fragetypen, wie in inhalt/README.md beschrieben:
//   multiple-choice  eine richtige Option aus mehreren
//   wahr-falsch      eine Aussage stimmt oder nicht
//   paare            Begriffe links den passenden rechts zuordnen
//   lueckentext      Luecken im Text als {{antwort}} oder {{antwort|alternative}}

export interface FrageBasis {
  id: string;
  kapitel: string;
  erklaerung?: string;
}

export interface MultipleChoice extends FrageBasis {
  typ: 'multiple-choice';
  frage: string;
  optionen: string[];
  richtig: number;
}

export interface WahrFalsch extends FrageBasis {
  typ: 'wahr-falsch';
  aussage: string;
  richtig: boolean;
}

export interface Paare extends FrageBasis {
  typ: 'paare';
  frage: string;
  paare: { links: string; rechts: string }[];
}

export interface Lueckentext extends FrageBasis {
  typ: 'lueckentext';
  text: string;
}

export type Frage = MultipleChoice | WahrFalsch | Paare | Lueckentext;

export type Antwort =
  | { typ: 'multiple-choice'; index: number | null }
  | { typ: 'wahr-falsch'; wert: boolean | null }
  | { typ: 'paare'; zuordnung: Record<string, string> }
  | { typ: 'lueckentext'; eingaben: string[] };

export interface Bewertung {
  richtig: boolean;
  /** Je Teilaufgabe, ob sie stimmt: eine bei MC und Wahr/Falsch, eine je Paar oder Luecke. */
  teile: boolean[];
  loesung: string;
}

// ---------------------------------------------------------------------------
// Format

const TYPEN = ['multiple-choice', 'wahr-falsch', 'paare', 'lueckentext'];

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
    const typ = String(f.typ ?? '');
    if (!TYPEN.includes(typ)) return fehler.push(`${wo}: typ "${typ}" unbekannt.`);
    const basis = { id, kapitel, erklaerung: f.erklaerung ? String(f.erklaerung) : undefined };

    if (typ === 'multiple-choice') {
      const optionen = Array.isArray(f.optionen) ? f.optionen.map(String) : [];
      const richtig = Number(f.richtig);
      if (optionen.length < 2) return fehler.push(`${wo}: mindestens zwei Optionen.`);
      if (!Number.isInteger(richtig) || richtig < 0 || richtig >= optionen.length) {
        return fehler.push(`${wo}: richtig muss ein Index von 0 bis ${optionen.length - 1} sein.`);
      }
      fragen.push({ ...basis, typ, frage: String(f.frage ?? ''), optionen, richtig });
    } else if (typ === 'wahr-falsch') {
      if (typeof f.richtig !== 'boolean') return fehler.push(`${wo}: richtig muss true oder false sein.`);
      fragen.push({ ...basis, typ, aussage: String(f.aussage ?? f.frage ?? ''), richtig: f.richtig });
    } else if (typ === 'paare') {
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
      if (luecken(text).length === 0) return fehler.push(`${wo}: der Text hat keine Luecke {{...}}.`);
      fragen.push({ ...basis, typ: 'lueckentext', text });
    }
  });
  return { fragen, fehler };
}

// ---------------------------------------------------------------------------
// Lueckentext

export type Textteil = { art: 'text'; text: string } | { art: 'luecke'; index: number; loesungen: string[] };

/** Zerlegt "Die Provision betraegt {{35}} Prozent." in Text und Luecken. */
export function zerlegeLueckentext(text: string): Textteil[] {
  const teile: Textteil[] = [];
  const muster = /\{\{([^}]*)\}\}/g;
  let letzte = 0;
  let index = 0;
  for (const treffer of text.matchAll(muster)) {
    const start = treffer.index ?? 0;
    if (start > letzte) teile.push({ art: 'text', text: text.slice(letzte, start) });
    const loesungen = treffer[1]
      .split('|')
      .map((l) => l.trim())
      .filter(Boolean);
    teile.push({ art: 'luecke', index, loesungen });
    index += 1;
    letzte = start + treffer[0].length;
  }
  if (letzte < text.length) teile.push({ art: 'text', text: text.slice(letzte) });
  return teile;
}

export function luecken(text: string): string[][] {
  return zerlegeLueckentext(text)
    .filter((t): t is Extract<Textteil, { art: 'luecke' }> => t.art === 'luecke')
    .map((t) => t.loesungen);
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
export function antwortAusFormular(frage: Frage, form: { get(name: string): unknown }): Antwort {
  if (frage.typ === 'multiple-choice') {
    const roh = form.get(feldname(frage));
    const index = roh === null || roh === undefined || roh === '' ? null : Number(roh);
    return { typ: 'multiple-choice', index: Number.isInteger(index) ? index : null };
  }
  if (frage.typ === 'wahr-falsch') {
    const roh = form.get(feldname(frage));
    return { typ: 'wahr-falsch', wert: roh === 'wahr' ? true : roh === 'falsch' ? false : null };
  }
  if (frage.typ === 'paare') {
    const zuordnung: Record<string, string> = {};
    frage.paare.forEach((p, i) => {
      const wert = form.get(feldname(frage, i));
      if (typeof wert === 'string' && wert) zuordnung[p.links] = wert;
    });
    return { typ: 'paare', zuordnung };
  }
  const eingaben = luecken(frage.text).map((_, i) => String(form.get(feldname(frage, i)) ?? ''));
  return { typ: 'lueckentext', eingaben };
}

// ---------------------------------------------------------------------------
// Bewertung

export function bewerte(frage: Frage, antwort: Antwort): Bewertung {
  if (frage.typ === 'multiple-choice') {
    const richtig = antwort.typ === 'multiple-choice' && antwort.index === frage.richtig;
    return { richtig, teile: [richtig], loesung: frage.optionen[frage.richtig] };
  }
  if (frage.typ === 'wahr-falsch') {
    const richtig = antwort.typ === 'wahr-falsch' && antwort.wert === frage.richtig;
    return { richtig, teile: [richtig], loesung: frage.richtig ? 'Wahr' : 'Falsch' };
  }
  if (frage.typ === 'paare') {
    const zuordnung = antwort.typ === 'paare' ? antwort.zuordnung : {};
    const teile = frage.paare.map((p) => zuordnung[p.links] === p.rechts);
    return {
      richtig: teile.every(Boolean),
      teile,
      loesung: frage.paare.map((p) => `${p.links}: ${p.rechts}`).join(', '),
    };
  }
  const eingaben = antwort.typ === 'lueckentext' ? antwort.eingaben : [];
  const alle = luecken(frage.text);
  const teile = alle.map((loesungen, i) => loesungen.some((l) => normalisiere(l) === normalisiere(eingaben[i] ?? '')));
  return { richtig: teile.every(Boolean), teile, loesung: alle.map((l) => l[0]).join(', ') };
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
