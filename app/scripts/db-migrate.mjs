#!/usr/bin/env node
// Wendet db/migrationen/*.sql auf die Datenbank aus DATABASE_URL an.
//   DATABASE_URL=postgres://... node scripts/db-migrate.mjs
// Ohne DATABASE_URL wird PGLITE_PFAD migriert, sonst bricht das Skript ab.

import { migriere, pgDb, pgliteDb } from '../src/lib/db.ts';

const url = process.env.DATABASE_URL;
const pfad = process.env.PGLITE_PFAD;
if (!url && !pfad) {
  console.error('DATABASE_URL (Postgres) oder PGLITE_PFAD (lokal) setzen.');
  process.exit(1);
}

const db = url ? await pgDb(url) : await pgliteDb(pfad);
try {
  const angewendet = url ? await migriere(db) : [];
  console.log(angewendet.length ? `Angewendet: ${angewendet.join(', ')}` : 'Schema ist aktuell.');
} finally {
  await db.close();
}
