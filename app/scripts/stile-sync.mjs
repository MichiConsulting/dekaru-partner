#!/usr/bin/env node
// Spiegelt die Stile und Bewegungsstufen aus dem Template-System nach src/data/stile.json.
//
//   node scripts/stile-sync.mjs              schreibt src/data/stile.json
//   node scripts/stile-sync.mjs --pruefen    vergleicht nur, Exit-Code 1 bei Abweichung
//
// Quelle: dekaru-templates/_core/stile/stile.mjs (Katalog STILE, Standard je
// Branche, dunkle Branchen, Bewegungsstufen). Die Datei hat keine Imports und
// wird direkt geladen. Hier wird nichts von Hand gepflegt: Briefing-Bogen,
// Admin-Ansicht und Angebots-YAML kennen genau die Stile, die der Build kennt.
//
// Wo die Quelle gesucht wird, in dieser Reihenfolge:
//   1. <templates>/_core/stile/stile.mjs als Datei. <templates> ist
//      DEKARU_TEMPLATES oder ~/dekaru/dekaru-templates.
//   2. Solange die Stile nicht in main gemergt sind: dieselbe Datei aus dem
//      Branch "stile" des Template-Repos (git show). Anderer Branch ueber
//      DEKARU_STILE_REF. Nach dem Merge greift 1, dieser Weg faellt weg.
//   3. Sonst gibt es keine Quelle: der Abgleichstest wird uebersprungen.
// Welche Quelle galt, steht in der Ausgabe und in stile.json unter "quelle".
//
// Texte zum Anzeigen (Beschreibung, Leitidee mit Umlauten, "passt zu",
// Erklaerung der Bewegungsstufen) kommen bewusst nicht mit: im Katalog stehen
// sie ohne Umlaute. Sie stehen in inhalt/stile.json unter derselben Kennung,
// mit dem Wortlaut der Stiluebersicht (PDF). tests/stile-sync.test.ts meldet,
// wenn dort ein Stil fehlt oder einer zu viel ist.
//
// Die Kopie liegt eingecheckt im Repo, weil der Build auf Vercel das
// Template-Repo nicht sieht. Nach jeder Aenderung an stile.mjs:
// npm run stile-sync, Datei committen.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ZIEL = join(APP, 'src', 'data', 'stile.json');
const PFAD_IM_REPO = '_core/stile/stile.mjs';
const MODI = ['hell', 'dunkel'];

export function templatesWurzel() {
  return process.env.DEKARU_TEMPLATES || join(process.env.DEKARU_WURZEL || join(homedir(), 'dekaru'), 'dekaru-templates');
}

export function quellRef() {
  return process.env.DEKARU_STILE_REF || 'stile';
}

/**
 * Findet die Quelle. Liefert { text, beschreibung } oder null.
 * beschreibung ist fuer Menschen: Datei oder Branch, aus dem gelesen wurde.
 */
export function findeQuelle() {
  const wurzel = templatesWurzel();
  const datei = join(wurzel, PFAD_IM_REPO);
  if (existsSync(datei)) return { text: readFileSync(datei, 'utf8'), beschreibung: `dekaru-templates/${PFAD_IM_REPO}` };
  if (!existsSync(wurzel)) return null;
  const ref = quellRef();
  try {
    const text = execFileSync('git', ['-C', wurzel, 'show', `${ref}:${PFAD_IM_REPO}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { text, beschreibung: `dekaru-templates, Branch ${ref}, ${PFAD_IM_REPO} (noch nicht in main)` };
  } catch {
    return null;
  }
}

export function quelleVorhanden() {
  return findeQuelle() !== null;
}

/** Laedt den Quelltext als Modul. stile.mjs hat keine Imports, ein data:-URL genuegt. */
export async function ladeModul(text) {
  return import(`data:text/javascript;base64,${Buffer.from(text, 'utf8').toString('base64')}`);
}

/** Plausibilitaet, damit eine kaputte Quelle nicht still ins Portal wandert. */
function pruefe(m) {
  const namen = Object.keys(m.STILE ?? {});
  if (namen.length === 0) throw new Error('stile.mjs hat keine Stile.');
  for (const n of namen) {
    const s = m.STILE[n];
    if (!/^[a-z]+$/.test(n)) throw new Error(`Ungueltige Stil-Kennung ${n}.`);
    if (!s.name) throw new Error(`Stil ${n} ohne Namen.`);
    if (!Array.isArray(s.modi) || s.modi.length === 0 || s.modi.some((x) => !MODI.includes(x))) throw new Error(`Stil ${n}: modi muss hell und/oder dunkel sein.`);
    if (!Array.isArray(s.heroStyles) || s.heroStyles.length === 0) throw new Error(`Stil ${n}: heroStyles fehlt.`);
  }
  const branchen = Object.keys(m.STANDARD_STIL ?? {});
  if (branchen.length === 0) throw new Error('stile.mjs hat keinen Standard je Branche.');
  for (const b of branchen) {
    const st = m.STANDARD_STIL[b];
    for (const modus of MODI) {
      if (!m.STILE[st?.[modus]]) throw new Error(`Standard ${b}/${modus} zeigt auf unbekannten Stil ${st?.[modus]}.`);
      if (!m.STILE[st[modus]].modi.includes(modus)) throw new Error(`Standard ${b}/${modus}: Stil ${st[modus]} hat keine Fassung ${modus}.`);
    }
  }
  for (const b of m.DUNKLE_BRANCHEN ?? []) {
    if (!m.STANDARD_STIL[b]) throw new Error(`Dunkle Branche ${b} hat keinen Standard.`);
    if (!m.STILE[m.STANDARD_STIL[b].hell].modi.includes('dunkel')) throw new Error(`Dunkle Branche ${b}: Standard ${m.STANDARD_STIL[b].hell} hat keine dunkle Fassung.`);
  }
  if (!Array.isArray(m.BEWEGUNG) || !m.BEWEGUNG.includes(m.BEWEGUNG_STANDARD)) throw new Error('Bewegungsstufen oder Standard fehlen.');
  for (const [baustein, ab] of Object.entries(m.BAUSTEINE ?? {})) {
    if (!m.BEWEGUNG.includes(ab)) throw new Error(`Baustein ${baustein}: unbekannte Stufe ${ab}.`);
  }
}

/** Baut den Inhalt von src/data/stile.json ohne Zeitstempel. */
export async function leseQuelle(quelle = findeQuelle()) {
  if (!quelle) {
    throw new Error(`Quelle fehlt: weder ${join(templatesWurzel(), PFAD_IM_REPO)} noch Branch ${quellRef()} im Template-Repo. DEKARU_TEMPLATES oder DEKARU_STILE_REF setzen.`);
  }
  const m = await ladeModul(quelle.text);
  pruefe(m);
  return {
    _hinweis:
      'Erzeugt mit scripts/stile-sync.mjs aus dekaru-templates/_core/stile/stile.mjs. Nicht von Hand aendern. Texte mit Umlauten stehen in inhalt/stile.json. Nach jeder Aenderung an den Stilen: npm run stile-sync',
    quelle: quelle.beschreibung,
    feld: { stil: 'stil', bewegung: 'bewegung' },
    stile: Object.entries(m.STILE).map(([kennung, s]) => ({
      kennung,
      name: s.name,
      leitideeQuelle: s.leitidee,
      schriften: s.schriften,
      modi: s.modi,
      heroStyles: s.heroStyles,
      bewegungNicht: s.bewegungNicht ?? [],
    })),
    standard: m.STANDARD_STIL,
    dunkleBranchen: m.DUNKLE_BRANCHEN,
    bewegung: {
      stufen: m.BEWEGUNG,
      standard: m.BEWEGUNG_STANDARD,
      bausteine: m.BAUSTEINE,
    },
  };
}

export function leseZiel() {
  return existsSync(ZIEL) ? JSON.parse(readFileSync(ZIEL, 'utf8')) : null;
}

/**
 * Vergleicht ohne Zeitstempel und ohne die Herkunft: ob die Daten aus der
 * Datei in main oder noch aus dem Branch kommen, aendert nichts am Inhalt.
 */
export function stimmtUeberein(quelle, ziel) {
  if (!ziel) return false;
  const ohne = (o) => JSON.stringify({ ...o, erzeugt: null, quelle: null });
  return ohne(quelle) === ohne(ziel);
}

const istHauptlauf = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (istHauptlauf) {
  const quelle = await leseQuelle();
  console.log(`Quelle: ${quelle.quelle}`);
  const anzahl = quelle.stile.length;
  if (process.argv.includes('--pruefen')) {
    const gleich = stimmtUeberein(quelle, leseZiel());
    console.log(gleich ? `src/data/stile.json ist aktuell (${anzahl} Stile).` : 'src/data/stile.json weicht von dekaru-templates ab. Lauf ohne --pruefen gleicht ab.');
    process.exit(gleich ? 0 : 1);
  }
  writeFileSync(ZIEL, `${JSON.stringify({ ...quelle, erzeugt: new Date().toISOString().slice(0, 10) }, null, 2)}\n`);
  console.log(`src/data/stile.json geschrieben: ${anzahl} Stile, ${quelle.bewegung.stufen.length} Bewegungsstufen.`);
}
