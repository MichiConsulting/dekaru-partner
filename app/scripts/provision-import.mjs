#!/usr/bin/env node
// Liest provision/<monat>/*.json aus dekaru-rechnungen und legt sie im Portal ab.
//   DATABASE_URL=postgres://... node scripts/provision-import.mjs [--monat JJJJ-MM] [--quelle <pfad>]
// Ohne --monat werden alle Monate importiert. --quelle zeigt auf den
// provision-Ordner, Standard ist ../../dekaru-rechnungen/provision.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { migriere, pgDb, pgliteDb } from '../src/lib/db.ts';
import { importiereAbrechnung, pruefeAbrechnung } from '../src/lib/provision.ts';

function argument(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const quelle = resolve(argument('quelle') ?? new URL('../../../dekaru-rechnungen/provision', import.meta.url).pathname);
const nurMonat = argument('monat');
if (!existsSync(quelle)) {
  console.error(`Ordner fehlt: ${quelle}`);
  process.exit(1);
}

const monate = readdirSync(quelle)
  .filter((m) => /^\d{4}-\d{2}$/.test(m) && (!nurMonat || m === nurMonat))
  .sort();

const url = process.env.DATABASE_URL;
const db = url ? await pgDb(url) : await pgliteDb(process.env.PGLITE_PFAD || undefined);
let fehler = 0;
try {
  if (url) await migriere(db);
  for (const monat of monate) {
    for (const datei of readdirSync(join(quelle, monat)).filter((d) => d.endsWith('.json'))) {
      const pfad = join(quelle, monat, datei);
      const { abrechnung, fehler: liste } = pruefeAbrechnung(JSON.parse(readFileSync(pfad, 'utf8')));
      if (!abrechnung) {
        fehler += 1;
        console.error(`  ${monat}/${datei}: ${liste.join(' ')}`);
        continue;
      }
      const e = await importiereAbrechnung(db, abrechnung, null);
      console.log(`  ${monat}/${datei}: ${e.ersetzt ? 'ersetzt' : 'neu'}`);
    }
  }
  console.log(fehler ? `\n${fehler} Datei(en) uebersprungen.` : '\nFertig.');
} finally {
  await db.close();
}
process.exit(fehler ? 1 : 0);
