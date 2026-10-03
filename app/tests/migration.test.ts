// Migrationen: jede Datei NNN-*.sql traegt eine eigene Versionsnummer.
// Geprueft wird eine frische Datenbank und eine, die nur Version 1 hat, so wie
// die Live-Datenbank vor Gespraechshilfe und neuem Lernbereich.
import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { MIGRATIONEN_ORDNER, migriere, type Db } from '../src/lib/db.ts';

/** PGlite im Speicher ohne automatische Migration. */
async function leereDb(): Promise<Db> {
  const pglite = new PGlite();
  await pglite.waitReady;
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await pglite.query(sql, params)).rows as T[];
    },
    async exec(sql: string) {
      await pglite.exec(sql);
    },
    close: () => pglite.close(),
  };
}

async function versionen(db: Db): Promise<number[]> {
  const zeilen = await db.query<{ version: number }>('SELECT version FROM schema_version ORDER BY version');
  return zeilen.map((z) => Number(z.version));
}

async function tabellen(db: Db): Promise<string[]> {
  const zeilen = await db.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
  );
  return zeilen.map((z) => z.table_name);
}

const NEUE_TABELLEN = ['pflichtsatz_antworten', 'lernkarten_stand', 'abfrage_durchlaeufe'];

describe('Migrationen', () => {
  let db: Db | null = null;
  let ordner: string | null = null;
  afterEach(async () => {
    await db?.close();
    db = null;
    if (ordner) rmSync(ordner, { recursive: true, force: true });
    ordner = null;
  });

  it('jede Datei hat eine eigene Versionsnummer, und sie passt zum Eintrag in schema_version', () => {
    const dateien = readdirSync(MIGRATIONEN_ORDNER).filter((n) => /^\d{3}-.*\.sql$/.test(n)).sort();
    const nummern = dateien.map((n) => Number(n.slice(0, 3)));
    expect(new Set(nummern).size).toBe(nummern.length);
    expect(nummern).toEqual([1, 2, 3]);
    for (const datei of dateien) {
      const sql = readFileSync(join(MIGRATIONEN_ORDNER, datei), 'utf8');
      expect(sql).toContain(`INSERT INTO schema_version (version) VALUES (${Number(datei.slice(0, 3))})`);
    }
  });

  it('wendet auf eine frische Datenbank 1, 2 und 3 an', async () => {
    db = await leereDb();
    expect(await migriere(db)).toEqual([1, 2, 3]);
    expect(await versionen(db)).toEqual([1, 2, 3]);
    expect(await tabellen(db)).toEqual(expect.arrayContaining(NEUE_TABELLEN));
    expect(await migriere(db)).toEqual([]);
  });

  it('wendet auf eine Datenbank mit nur Version 1 genau 2 und 3 an', async () => {
    ordner = mkdtempSync(join(tmpdir(), 'migration-'));
    copyFileSync(join(MIGRATIONEN_ORDNER, '001-schema.sql'), join(ordner, '001-schema.sql'));
    db = await leereDb();
    expect(await migriere(db, ordner)).toEqual([1]);
    expect(await versionen(db)).toEqual([1]);
    expect(await tabellen(db)).not.toEqual(expect.arrayContaining(['pflichtsatz_antworten']));

    expect(await migriere(db)).toEqual([2, 3]);
    expect(await versionen(db)).toEqual([1, 2, 3]);
    expect(await tabellen(db)).toEqual(expect.arrayContaining(NEUE_TABELLEN));
  });
});
