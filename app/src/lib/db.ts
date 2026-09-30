// Datenbankzugriff hinter einer schmalen Schnittstelle.
//
// Mit DATABASE_URL spricht das Portal Postgres (Neon) ueber pg. Ohne diese
// Variable laeuft lokal PGlite, ein Postgres im Prozess, wahlweise im Speicher
// oder in einem Ordner. Beide verstehen dieselben SQL-Dateien aus
// db/migrationen, es gibt also nur ein Schema.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export type Zeile = Record<string, unknown>;

export interface Db {
  query<T = Zeile>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Mehrere Anweisungen auf einmal, ohne Parameter. Nur fuer Migrationen. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export const MIGRATIONEN_ORDNER = fileURLToPath(new URL('../../db/migrationen/', import.meta.url));

let instanz: Promise<Db> | null = null;

/** Die eine Verbindung des Prozesses. Beim ersten Aufruf wird sie aufgebaut. */
export function getDb(): Promise<Db> {
  if (!instanz) instanz = erzeuge();
  return instanz;
}

async function erzeuge(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) return pgDb(url);
  if (process.env.VERCEL) {
    throw new Error('DATABASE_URL fehlt. Auf Vercel braucht das Portal eine Postgres-Datenbank.');
  }
  return pgliteDb(process.env.PGLITE_PFAD || undefined);
}

/** Postgres ueber pg. Kleiner Pool, weil jede Serverless-Instanz ihren eigenen hat. */
export async function pgDb(url: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000 });
  return {
    async query<T = Zeile>(sql: string, params: unknown[] = []) {
      const ergebnis = await pool.query(sql, params);
      return ergebnis.rows as T[];
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}

/** PGlite fuer Entwicklung und Tests. Wendet die Migrationen sofort an. */
export async function pgliteDb(pfad?: string): Promise<Db> {
  // Der Modulname steht in einer Variablen, damit weder Vite noch die
  // Vercel-Paketierung PGlite in das Produktions-Bundle ziehen.
  const modul = '@electric-sql/pglite';
  const { PGlite } = await import(/* @vite-ignore */ modul);
  const pglite = pfad ? new PGlite(pfad) : new PGlite();
  await pglite.waitReady;
  const db: Db = {
    async query<T = Zeile>(sql: string, params: unknown[] = []) {
      const ergebnis = await pglite.query(sql, params);
      return ergebnis.rows as T[];
    },
    async exec(sql: string) {
      await pglite.exec(sql);
    },
    close: () => pglite.close(),
  };
  await migriere(db);
  return db;
}

/** Liest db/migrationen/*.sql der Reihe nach und wendet fehlende Versionen an. */
export async function migriere(db: Db, ordner = MIGRATIONEN_ORDNER): Promise<number[]> {
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_version (version integer PRIMARY KEY, angewendet_am timestamptz NOT NULL DEFAULT now())',
  );
  const vorhanden = new Set(
    (await db.query<{ version: number }>('SELECT version FROM schema_version')).map((z) => Number(z.version)),
  );
  const dateien = readdirSync(ordner)
    .filter((name) => /^\d{3}-.*\.sql$/.test(name))
    .sort();
  const angewendet: number[] = [];
  for (const datei of dateien) {
    const version = Number(datei.slice(0, 3));
    if (vorhanden.has(version)) continue;
    const sql = readFileSync(join(ordner, datei), 'utf8');
    await db.exec('BEGIN');
    try {
      await db.exec(sql);
      await db.query('INSERT INTO schema_version (version) VALUES ($1) ON CONFLICT DO NOTHING', [version]);
      await db.exec('COMMIT');
    } catch (fehler) {
      await db.exec('ROLLBACK');
      throw fehler;
    }
    angewendet.push(version);
  }
  return angewendet;
}
