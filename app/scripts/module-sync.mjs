#!/usr/bin/env node
// Spiegelt die verkaufbaren Software-Module nach src/data/module.json.
//
//   node scripts/module-sync.mjs              schreibt src/data/module.json
//   node scripts/module-sync.mjs --pruefen    vergleicht nur, Exit-Code 1 bei Abweichung
//
// Quelle: dekaru-rechnungen/preise.json, Block leistungen.module. Dort pflegt
// Michi Name, Preis, Stufe und den Schalter verkaufbar je Modul. Das
// Angebotssystem liest dieselbe Datei, es gibt also nur eine Wahrheit.
//
// Die Kopie enthaelt NUR Module mit verkaufbar: true, und nur die Felder, die
// das Portal braucht (schluessel, preis, einheit, stufe). Ein Modul gilt im
// Portal genau dann als verkaufbar, wenn es in dieser Datei steht. Was noch
// nicht verkauft wird, kennt das Portal gar nicht, damit es nirgends als
// "kommt bald" auftauchen kann.
//
// Namen und Texte kommen bewusst nicht mit: in preise.json stehen sie ohne
// Umlaute. Die Texte fuer Portal, Schema und Verkaufshilfen stehen in
// inhalt/verkaufshilfen.json, je Modul unter demselben Schluessel.
// tests/module-sync.test.ts meldet, wenn ein verkaufbares Modul dort fehlt.
//
// Nie gelesen wird dekaru-rechnungen/absender.json (Steuernummer, Bank).
// Die Kopie liegt eingecheckt im Repo, weil der Build auf Vercel das Repo
// dekaru-rechnungen nicht sieht. Nach jeder Aenderung an leistungen.module:
// npm run module-sync, Datei committen, deployen.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ZIEL = join(APP, 'src', 'data', 'module.json');

/** Stufen aus dem Bauplan, Preise entschieden am 06.10.2026. */
export const STUFEN = ['klein', 'mittel', 'gross', 'sehr gross'];

export function quellPfad() {
  if (process.env.DEKARU_WURZEL) return join(process.env.DEKARU_WURZEL, 'dekaru-rechnungen', 'preise.json');
  const neben = resolve(APP, '..', '..', 'dekaru-rechnungen', 'preise.json');
  if (existsSync(neben)) return neben;
  return join(homedir(), 'dekaru', 'dekaru-rechnungen', 'preise.json');
}

export function quelleVorhanden(pfad = quellPfad()) {
  return existsSync(pfad);
}

/** Plausibilitaet, damit ein Tippfehler in der Quelle nicht still ins Portal wandert. */
function pruefe(module) {
  const gesehen = new Set();
  for (const m of module) {
    if (!/^modul-[a-z0-9-]+$/.test(m.schluessel ?? '')) throw new Error(`Modul mit ungueltigem Schluessel: ${m.schluessel ?? '?'}.`);
    if (gesehen.has(m.schluessel)) throw new Error(`Modul ${m.schluessel} doppelt.`);
    gesehen.add(m.schluessel);
    if (typeof m.verkaufbar !== 'boolean') throw new Error(`Modul ${m.schluessel}: verkaufbar fehlt oder ist kein true/false.`);
    if (!STUFEN.includes(m.stufe)) throw new Error(`Modul ${m.schluessel}: unbekannte Stufe ${m.stufe}.`);
    if (m.verkaufbar && (!Number.isInteger(m.preis) || m.preis <= 0)) throw new Error(`Modul ${m.schluessel} ist verkaufbar, hat aber keinen Preis.`);
    if (m.verkaufbar && m.einheit !== 'einmalig') throw new Error(`Modul ${m.schluessel}: Einheit ${m.einheit}, erwartet ist einmalig.`);
  }
}

/** Liest die Quelle und baut den Inhalt von src/data/module.json ohne Zeitstempel. */
export function leseQuelle(pfad = quellPfad()) {
  if (!existsSync(pfad)) throw new Error(`Quelle fehlt: ${pfad}. Liegt dekaru-rechnungen unter ~/dekaru, oder DEKARU_WURZEL setzen.`);
  const roh = JSON.parse(readFileSync(pfad, 'utf8'));
  const module = roh?.leistungen?.module;
  if (!Array.isArray(module)) throw new Error('dekaru-rechnungen/preise.json hat keinen Block leistungen.module.');
  pruefe(module);
  return {
    _hinweis:
      'Erzeugt mit scripts/module-sync.mjs aus dekaru-rechnungen/preise.json (leistungen.module). Enthaelt nur verkaufbare Module. Nicht von Hand aendern. Nach jeder Aenderung dort: npm run module-sync',
    quelle: 'dekaru-rechnungen/preise.json (leistungen.module)',
    regel: roh?.leistungen?.regeln?.module ?? '',
    module: module
      .filter((m) => m.verkaufbar === true)
      .map((m) => ({ schluessel: m.schluessel, preis: m.preis, einheit: m.einheit, stufe: m.stufe })),
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
  const liste = quelle.module.map((m) => `${m.schluessel} ${m.preis}`).join(', ') || 'keins';
  if (process.argv.includes('--pruefen')) {
    const gleich = stimmtUeberein(quelle, leseZiel());
    console.log(gleich ? `src/data/module.json ist aktuell. Verkaufbar: ${liste}.` : 'src/data/module.json weicht von dekaru-rechnungen ab. Lauf ohne --pruefen gleicht ab.');
    process.exit(gleich ? 0 : 1);
  }
  writeFileSync(ZIEL, `${JSON.stringify({ ...quelle, erzeugt: new Date().toISOString().slice(0, 10) }, null, 2)}\n`);
  console.log(`src/data/module.json geschrieben. Verkaufbar: ${liste} Euro.`);
}
