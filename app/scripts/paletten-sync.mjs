#!/usr/bin/env node
// Spiegelt die Farbpaletten aus dem Template-System nach src/data/paletten.json.
//
//   node scripts/paletten-sync.mjs              schreibt src/data/paletten.json
//   node scripts/paletten-sync.mjs --pruefen    vergleicht nur, Exit-Code 1 bei Abweichung
//
// Quelle: dekaru-templates/_system/paletten.json. Die Datei ist dort selbst
// erzeugt (npm run paletten aus _system/paletten.mjs). Hier wird nichts von
// Hand gepflegt: Schema und Briefing-Bogen zeigen genau die Paletten, die
// beim Bau der Website per Code gesetzt werden.
//
// Die Kopie liegt eingecheckt im Repo, weil der Build auf Vercel das
// Template-Repo nicht sieht. tests/paletten-sync.test.ts meldet Abweichungen.
// Liegt das Template-Repo nicht unter ~/dekaru/dekaru-templates (zum
// Beispiel in einem Worktree), zeigt DEKARU_TEMPLATES auf seinen Ordner.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ZIEL = join(APP, 'src', 'data', 'paletten.json');

export function quellPfad() {
  const wurzel = process.env.DEKARU_TEMPLATES || join(process.env.DEKARU_WURZEL || join(homedir(), 'dekaru'), 'dekaru-templates');
  return join(wurzel, '_system', 'paletten.json');
}

export function quelleVorhanden(pfad = quellPfad()) {
  return existsSync(pfad);
}

const HEX = /^#[0-9a-f]{6}$/;

/** Plausibilitaet, damit eine kaputte Quelle nicht still ins Portal wandert. */
function pruefe(daten) {
  if (!Array.isArray(daten.branchen) || daten.branchen.length === 0) throw new Error('paletten.json hat keine Branchen.');
  const codes = new Set();
  for (const b of daten.branchen) {
    if (!b.id || !b.label || !Array.isArray(b.paletten) || b.paletten.length === 0) throw new Error(`Branche ${b.id ?? '?'} unvollstaendig.`);
    for (const p of b.paletten) {
      if (!/^[A-Z]{2}-\d{1,2}$/.test(p.code)) throw new Error(`Ungueltiger Palettencode ${p.code}.`);
      if (codes.has(p.code)) throw new Error(`Palettencode ${p.code} doppelt.`);
      codes.add(p.code);
      for (const t of ['bg', 'surface', 'ink', 'ink-soft', 'accent', 'accent-deep', 'on-accent', 'border']) {
        if (!HEX.test(p.farben?.[t] ?? '')) throw new Error(`Palette ${p.code}: Farbe ${t} fehlt oder ist kein Hex-Wert.`);
      }
      if (!HEX.test(p.link ?? '')) throw new Error(`Palette ${p.code}: Linkfarbe fehlt.`);
    }
  }
}

/** Liest die Quelle und baut den Inhalt von src/data/paletten.json ohne Zeitstempel. */
export function leseQuelle(pfad = quellPfad()) {
  if (!existsSync(pfad)) throw new Error(`Quelle fehlt: ${pfad}. Liegt dekaru-templates unter ~/dekaru, oder DEKARU_TEMPLATES setzen.`);
  const roh = JSON.parse(readFileSync(pfad, 'utf8'));
  pruefe(roh);
  return {
    ...roh,
    _hinweis:
      'Erzeugt mit scripts/paletten-sync.mjs aus dekaru-templates/_system/paletten.json (dort aus paletten.mjs). Nicht von Hand aendern. Nach jeder Palettenaenderung: npm run paletten-sync',
  };
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
  const quelle = leseQuelle();
  const anzahl = quelle.branchen.reduce((n, b) => n + b.paletten.length, 0);
  if (process.argv.includes('--pruefen')) {
    const gleich = stimmtUeberein(quelle, leseZiel());
    console.log(gleich ? `src/data/paletten.json ist aktuell (${anzahl} Paletten).` : 'src/data/paletten.json weicht von dekaru-templates ab. Lauf ohne --pruefen gleicht ab.');
    process.exit(gleich ? 0 : 1);
  }
  writeFileSync(ZIEL, `${JSON.stringify({ ...quelle, erzeugt: new Date().toISOString().slice(0, 10) }, null, 2)}\n`);
  console.log(`src/data/paletten.json geschrieben: ${anzahl} Paletten in ${quelle.branchen.length} Branchen.`);
}
