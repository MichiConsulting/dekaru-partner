// Bindeglied zu den Inhalten: Quizfragen und Grafiken werden zur Build-Zeit
// eingelesen. Nur dieses Modul kennt import.meta.glob, alles andere bleibt
// reines TypeScript.

import { pruefeQuizDaten, type Frage } from './quiz.ts';
import { pruefeLernkarten, type Lernkapitel, type Lernkarte } from './lernkarten.ts';

// Die Globs werden beim Build aufgeloest und die Inhalte in das Bundle
// geschrieben. Zur Laufzeit liest nichts mehr vom Dateisystem, deshalb darf
// die Entscheidung echt oder Platzhalter nur von den Globs abhaengen, nicht
// von Pfaden relativ zum Bundle.
const quizEcht = import.meta.glob('../../../inhalt/quiz.json', { eager: true, import: 'default' });
const quizPlatzhalter = import.meta.glob('../../inhalt-platzhalter/quiz.json', { eager: true, import: 'default' });
const grafikenEcht = import.meta.glob('../../../inhalt/grafiken/*.svg', { eager: true, query: '?raw', import: 'default' });
const grafikenPlatzhalter = import.meta.glob('../../inhalt-platzhalter/grafiken/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
});
// Lernkarten und die Grafiken des Lernbereichs. Die Lerngrafiken werden
// inline in die Seite geschrieben, damit sie die Farbvariablen des Portals
// uebernehmen und in hell wie dunkel funktionieren.
const lernkartenEcht = import.meta.glob('../../../inhalt/lernen/*.json', { eager: true, import: 'default' });
const lernGrafikenEcht = import.meta.glob('../../../inhalt/lernen/grafiken/*.svg', { eager: true, query: '?raw', import: 'default' });
const echt = Object.keys(quizEcht).length > 0 || Object.keys(grafikenEcht).length > 0;

const quizRoh = Object.values(echt ? quizEcht : quizPlatzhalter)[0] ?? { fragen: [] };
const geprueft = pruefeQuizDaten(quizRoh);

/** Alle gueltigen Fragen. Fehler im Format stehen in quizFehler. */
export const fragen: Frage[] = geprueft.fragen;
export const quizFehler: string[] = geprueft.fehler;

export function fragenJeKapitel(kapitelSlugs: string[]): Map<string, Frage[]> {
  const karte = new Map<string, Frage[]>();
  for (const slug of kapitelSlugs) karte.set(slug, []);
  for (const f of fragen) {
    if (!karte.has(f.kapitel)) karte.set(f.kapitel, []);
    karte.get(f.kapitel)!.push(f);
  }
  return karte;
}

export function frageNachId(id: string): Frage | undefined {
  return fragen.find((f) => f.id === id);
}

const grafiken = new Map<string, string>();
for (const [pfad, inhalt] of Object.entries(echt ? grafikenEcht : grafikenPlatzhalter)) {
  const name = pfad.split('/').pop()!;
  grafiken.set(name, String(inhalt));
}

/** SVG-Quelltext einer Grafik nach Dateiname, oder null. */
export function grafik(datei: string): string | null {
  return grafiken.get(datei) ?? null;
}

export const inhaltsQuelle = echt ? 'inhalt/' : 'app/inhalt-platzhalter/';

// ---------------------------------------------------------------------------
// Lernbereich

const lernGrafiken = new Map<string, string>();
for (const [pfad, inhalt] of Object.entries(lernGrafikenEcht)) {
  lernGrafiken.set(pfad.split('/').pop()!, String(inhalt));
}

/** SVG-Quelltext einer Lerngrafik zum Inline-Einbetten, oder null. */
export function lernGrafik(datei: string): string | null {
  return lernGrafiken.get(datei) ?? null;
}

/** Der <title> einer Kapitelgrafik als Alternativtext fuer <img>. */
export function grafikTitel(datei: string): string {
  const svg = grafik(datei) ?? '';
  const treffer = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(svg);
  return treffer ? treffer[1].replace(/\s+/g, ' ').trim() : '';
}

const alleGrafikNamen = new Set<string>([...grafiken.keys(), ...lernGrafiken.keys()]);

const lernkartenJeKapitel = new Map<string, Lernkapitel>();
const lernkartenFehlerListe: string[] = [];
for (const [pfad, roh] of Object.entries(lernkartenEcht)) {
  const slug = pfad.split('/').pop()!.replace(/\.json$/, '');
  const { kapitel, fehler } = pruefeLernkarten(roh, slug, alleGrafikNamen);
  if (kapitel) lernkartenJeKapitel.set(slug, kapitel);
  for (const f of fehler) lernkartenFehlerListe.push(`${slug}.json: ${f}`);
}

/** Lernkarten eines Kapitels, oder null, wenn es keine gueltige Datei gibt. */
export function lernkarten(slug: string): Lernkarte[] | null {
  return lernkartenJeKapitel.get(slug)?.karten ?? null;
}

/** Formatfehler in inhalt/lernen, fuer den Admin. */
export const lernkartenFehler: string[] = lernkartenFehlerListe;
