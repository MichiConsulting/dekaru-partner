#!/usr/bin/env node
// Spiegelt die Preise aus ihren Quellen nach src/data/preise.json.
//
//   node scripts/preise-sync.mjs              schreibt src/data/preise.json
//   node scripts/preise-sync.mjs --pruefen    vergleicht nur, Exit-Code 1 bei Abweichung
//
// Warum: Der Preisrechner im Portal muss dieselben Zahlen zeigen wie der auf
// dekaru.de, und die Zusatzleistungen dieselben wie das Angebotssystem. Keine
// Zahl wird hier von Hand gepflegt. Quellen:
//
//   dekaru-website/site/src/data/preise.ts    Pakete, Bausteine, Funktion
//   dekaru-website/site/src/data/hosting.ts   Hosting-Stufen, Gratisquartal
//   dekaru-rechnungen/preise.json             leistungen.einmalig (Zusatzleistungen)
//
// Die Ausgabe liegt eingecheckt im Repo, weil der Build auf Vercel die anderen
// Repos nicht sieht. Nach jeder Preisaenderung einmal laufen lassen und die
// geaenderte preise.json mit committen. tests/preise-sync.test.ts meldet,
// wenn die eingecheckte Datei von den Quellen abweicht.
//
// Die beiden .ts-Dateien werden mit dem TypeScript-Transpiler aus node_modules
// in JavaScript uebersetzt und ausgewertet. Sie enthalten nur Literale und
// einfache Ableitungen, keine Imports; sonst faellt dieses Skript mit einer
// Meldung aus, nicht still.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ZIEL = join(APP, 'src', 'data', 'preise.json');

/**
 * Wo die anderen Repos liegen. Normalerweise neben dekaru-partner unter
 * ~/dekaru. Liegt dieses Repo woanders (zum Beispiel ein Worktree), greift
 * der Rueckfall auf ~/dekaru oder die Variable DEKARU_WURZEL.
 */
export function dekaruWurzel() {
  if (process.env.DEKARU_WURZEL) return process.env.DEKARU_WURZEL;
  const neben = resolve(APP, '..', '..');
  if (existsSync(join(neben, 'dekaru-website')) && existsSync(join(neben, 'dekaru-rechnungen'))) return neben;
  return join(homedir(), 'dekaru');
}

export function quellPfade(wurzel = dekaruWurzel()) {
  return {
    preise: join(wurzel, 'dekaru-website', 'site', 'src', 'data', 'preise.ts'),
    hosting: join(wurzel, 'dekaru-website', 'site', 'src', 'data', 'hosting.ts'),
    leistungen: join(wurzel, 'dekaru-rechnungen', 'preise.json'),
  };
}

export function quellenVorhanden(pfade = quellPfade()) {
  return Object.values(pfade).every((p) => existsSync(p));
}

/** Uebersetzt eine TS-Datei ohne Imports nach CommonJS und liefert ihre Exporte. */
function ladeTsModul(pfad) {
  const quelle = readFileSync(pfad, 'utf8');
  if (/^\s*import\s/m.test(quelle)) {
    throw new Error(`${pfad} enthaelt Imports. Dieses Skript wertet nur eigenstaendige Datendateien aus.`);
  }
  const { outputText, diagnostics } = ts.transpileModule(quelle, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  if (diagnostics?.length) {
    throw new Error(`${pfad} laesst sich nicht uebersetzen: ${diagnostics.map((d) => d.messageText).join('; ')}`);
  }
  const exports = {};
  new Function('exports', 'require', 'module', outputText)(exports, () => {
    throw new Error('require wird in Datendateien nicht erwartet.');
  }, { exports });
  return exports;
}

function pflicht(obj, namen, datei) {
  for (const name of namen) {
    if (obj[name] === undefined) throw new Error(`${datei} exportiert ${name} nicht mehr. Erst pruefen, dann dieses Skript anpassen.`);
  }
}

/** Plausibilitaet, damit ein Tippfehler in der Quelle nicht still ins Portal wandert. */
function pruefe(daten) {
  const schluessel = new Set(daten.gruppen.flatMap((g) => g.posten.map((p) => p.schluessel)));
  if (daten.pakete.length !== 3) throw new Error(`preise.ts nennt ${daten.pakete.length} Pakete, erwartet sind drei.`);
  for (const paket of daten.pakete) {
    if (!Number.isInteger(paket.preis) || paket.preis <= 0) throw new Error(`Paket ${paket.schluessel} hat keinen Preis.`);
    for (const key of Object.keys(paket.enthalten)) {
      if (!schluessel.has(key)) throw new Error(`Paket ${paket.schluessel} enthaelt den unbekannten Baustein ${key}.`);
    }
  }
  if (daten.pakete.filter((p) => p.empfohlen).length !== 1) throw new Error('Genau ein Paket muss empfohlen sein.');
  if (daten.hosting.tarife.length !== 3) throw new Error('hosting.ts nennt nicht drei Tarife.');
  for (const t of daten.hosting.tarife) {
    if (!Number.isInteger(t.jahr) || t.jahr <= 0) throw new Error(`Hosting ${t.id} hat keinen Jahrespreis.`);
    if (t.monat !== null && (!Number.isInteger(t.monat) || t.monat <= 0)) throw new Error(`Hosting ${t.id}: Monatspreis unplausibel.`);
  }
  if (daten.hosting.ab !== Math.min(...daten.hosting.tarife.map((t) => t.monat ?? Infinity))) {
    throw new Error('HOSTING_AB in preise.ts passt nicht zum guenstigsten Monatspreis in hosting.ts.');
  }
  for (const l of daten.zusatzleistungen) {
    if (!l.schluessel || !l.name || !Number.isFinite(l.preis)) throw new Error(`Zusatzleistung ${l.schluessel ?? '?'} unvollstaendig.`);
  }
}

/** Liest alle Quellen und baut den Inhalt von src/data/preise.json ohne Zeitstempel. */
export function leseQuellen(pfade = quellPfade()) {
  for (const [name, pfad] of Object.entries(pfade)) {
    if (!existsSync(pfad)) throw new Error(`Quelle ${name} fehlt: ${pfad}. Liegen dekaru-website und dekaru-rechnungen unter ${dekaruWurzel()}?`);
  }
  const preise = ladeTsModul(pfade.preise);
  pflicht(preise, ['GRUNDLEISTUNG', 'FUNKTION', 'PAKETE', 'GRUPPEN', 'HOSTING_AB'], 'preise.ts');
  const hosting = ladeTsModul(pfade.hosting);
  pflicht(
    hosting,
    ['HOSTING_TARIFE', 'HOSTING_EINZELAENDERUNG', 'HOSTING_BEZAHLTE_MONATE', 'HOSTING_GRATIS_MONATE', 'HOSTING_MINDEST_BEZAHLT', 'HOSTING_GRATIS_HINWEIS'],
    'hosting.ts',
  );
  const rechnungen = JSON.parse(readFileSync(pfade.leistungen, 'utf8'));
  const einmalig = rechnungen?.leistungen?.einmalig;
  if (!Array.isArray(einmalig)) throw new Error('dekaru-rechnungen/preise.json hat keinen Block leistungen.einmalig.');

  const daten = {
    _hinweis:
      'Erzeugt mit scripts/preise-sync.mjs aus dekaru-website (preise.ts, hosting.ts) und dekaru-rechnungen (preise.json). Nicht von Hand aendern. Nach jeder Preisaenderung: npm run preise-sync',
    quellen: {
      preise: 'dekaru-website/site/src/data/preise.ts',
      hosting: 'dekaru-website/site/src/data/hosting.ts',
      zusatzleistungen: 'dekaru-rechnungen/preise.json (leistungen.einmalig)',
    },
    grundleistung: preise.GRUNDLEISTUNG,
    funktion: preise.FUNKTION,
    pakete: preise.PAKETE,
    gruppen: preise.GRUPPEN,
    hosting: {
      ab: preise.HOSTING_AB,
      tarife: hosting.HOSTING_TARIFE,
      einzelaenderung: hosting.HOSTING_EINZELAENDERUNG,
      bezahlteMonate: hosting.HOSTING_BEZAHLTE_MONATE,
      gratisMonate: hosting.HOSTING_GRATIS_MONATE,
      mindestBezahlt: hosting.HOSTING_MINDEST_BEZAHLT,
      gratisHinweis: hosting.HOSTING_GRATIS_HINWEIS,
    },
    zusatzleistungen: einmalig.map((l) => ({
      schluessel: l.schluessel,
      name: l.name,
      preis: l.preis,
      einheit: l.einheit,
      ...(l.zusatz ? { zusatz: l.zusatz } : {}),
      ...(Array.isArray(l.voraussetzung) ? { voraussetzung: l.voraussetzung } : {}),
      nutzen: l.nutzen,
    })),
  };
  pruefe(daten);
  return daten;
}

export function leseZiel() {
  return existsSync(ZIEL) ? JSON.parse(readFileSync(ZIEL, 'utf8')) : null;
}

/** Vergleicht ohne den Zeitstempel. */
export function stimmtUeberein(quelle, ziel) {
  if (!ziel) return false;
  const ohne = (o) => JSON.stringify({ ...o, erzeugt: null });
  return ohne(quelle) === ohne(ziel);
}

const istHauptlauf = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (istHauptlauf) {
  const nurPruefen = process.argv.includes('--pruefen');
  const quelle = leseQuellen();
  const ziel = leseZiel();
  const pakete = quelle.pakete.map((p) => `${p.name} ${p.preis}`).join(', ');
  const tarife = quelle.hosting.tarife.map((t) => `${t.name} ${t.monat ?? `${t.jahr}/Jahr`}`).join(', ');

  if (nurPruefen) {
    const gleich = stimmtUeberein(quelle, ziel);
    console.log(gleich ? 'src/data/preise.json ist aktuell.' : 'src/data/preise.json weicht von den Quellen ab. Lauf ohne --pruefen gleicht ab.');
    console.log(`  Pakete ${pakete} Euro. Hosting ${tarife}. ${quelle.zusatzleistungen.length} Zusatzleistungen.`);
    process.exit(gleich ? 0 : 1);
  }

  writeFileSync(ZIEL, `${JSON.stringify({ ...quelle, erzeugt: new Date().toISOString().slice(0, 10) }, null, 2)}\n`);
  console.log('src/data/preise.json geschrieben.');
  console.log(`  Pakete            ${pakete} Euro`);
  console.log(`  Bausteine         ${quelle.gruppen.length} Gruppen, ${quelle.gruppen.reduce((n, g) => n + g.posten.length, 0)} Posten`);
  console.log(`  Hosting           ${tarife} Euro`);
  console.log(`  Zusatzleistungen  ${quelle.zusatzleistungen.length}`);
}
