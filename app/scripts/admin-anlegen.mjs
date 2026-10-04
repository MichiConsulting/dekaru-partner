#!/usr/bin/env node
// Legt den ersten Admin an oder setzt sein Passwort neu.
//   DATABASE_URL=postgres://... node scripts/admin-anlegen.mjs --email michi@example.de --name "Michael Henning"
// Das Einmal-Passwort wird einmal ausgegeben, beim ersten Login muss ein
// eigenes gesetzt werden. Gibt es die Adresse schon, wird nur das Passwort
// neu gesetzt und der Zugang aktiviert.

import { migriere, pgDb, pgliteDb } from '../src/lib/db.ts';
import { erstelleBenutzer, normalisiereEmail, setzePasswort } from '../src/lib/auth.ts';
import { erzeugeEinmalPasswort } from '../src/lib/passwort.ts';
import { protokolliere, skriptAkteur } from '../src/lib/admin-protokoll.ts';

function argument(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const email = argument('email');
const name = argument('name') ?? 'Michael Henning';
const slug = argument('slug') ?? null;
if (!email) {
  console.error('Aufruf: node scripts/admin-anlegen.mjs --email <adresse> [--name "<Name>"] [--slug <vertriebler-slug>]');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
const db = url ? await pgDb(url) : await pgliteDb(process.env.PGLITE_PFAD || undefined);
try {
  if (url) await migriere(db);
  const passwort = erzeugeEinmalPasswort();
  const vorhanden = await db.query('SELECT id, name FROM benutzer WHERE email = $1', [normalisiereEmail(email)]);
  if (vorhanden[0]) {
    await setzePasswort(db, vorhanden[0].id, passwort, true);
    await db.query('UPDATE benutzer SET aktiv = true WHERE id = $1', [vorhanden[0].id]);
    await db.query('DELETE FROM sitzungen WHERE benutzer_id = $1', [vorhanden[0].id]);
    await protokolliere(db, skriptAkteur('admin-anlegen'), {
      aktion: 'einmal_passwort_neu',
      zielTyp: 'benutzer',
      zielId: vorhanden[0].id,
      zielText: vorhanden[0].name,
    });
    console.log(`Passwort fuer ${email} neu gesetzt.`);
  } else {
    const neu = await erstelleBenutzer(db, { email, name, rolle: 'admin', passwort, vertrieblerSlug: slug, wechselNoetig: true });
    await protokolliere(db, skriptAkteur('admin-anlegen'), {
      aktion: 'zugang_angelegt',
      zielTyp: 'benutzer',
      zielId: neu.id,
      zielText: neu.name,
      details: { rolle: 'admin', slug: slug ?? '' },
    });
    console.log(`Admin ${email} angelegt.`);
  }
  console.log(`Einmal-Passwort: ${passwort}`);
  console.log('Beim ersten Login wird ein eigenes Passwort verlangt.');
} finally {
  await db.close();
}
