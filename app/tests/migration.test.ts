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

const NEUE_TABELLEN = ['pflichtsatz_antworten', 'lernkarten_stand', 'abfrage_durchlaeufe', 'stufen_protokoll', 'briefings'];

/** Alle Versionsnummern aus db/migrationen, aufsteigend. Luecken sind erlaubt, Zweige bringen eigene Nummern mit. */
const ALLE_VERSIONEN = readdirSync(MIGRATIONEN_ORDNER)
  .filter((n) => /^\d{3}-.*\.sql$/.test(n))
  .map((n) => Number(n.slice(0, 3)))
  .sort((a, b) => a - b);

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
    expect(nummern).toEqual(expect.arrayContaining([1, 2, 3, 4, 6]));
    for (const datei of dateien) {
      const sql = readFileSync(join(MIGRATIONEN_ORDNER, datei), 'utf8');
      expect(sql).toContain(`INSERT INTO schema_version (version) VALUES (${Number(datei.slice(0, 3))})`);
    }
  });

  it('wendet auf eine frische Datenbank alle Versionen an', async () => {
    db = await leereDb();
    expect(await migriere(db)).toEqual(ALLE_VERSIONEN);
    expect(await versionen(db)).toEqual(ALLE_VERSIONEN);
    expect(await tabellen(db)).toEqual(expect.arrayContaining(NEUE_TABELLEN));
    expect(await migriere(db)).toEqual([]);
  });

  it('wendet auf eine Datenbank mit nur Version 1 genau die uebrigen an', async () => {
    ordner = mkdtempSync(join(tmpdir(), 'migration-'));
    copyFileSync(join(MIGRATIONEN_ORDNER, '001-schema.sql'), join(ordner, '001-schema.sql'));
    db = await leereDb();
    expect(await migriere(db, ordner)).toEqual([1]);
    expect(await versionen(db)).toEqual([1]);
    expect(await tabellen(db)).not.toEqual(expect.arrayContaining(['pflichtsatz_antworten']));

    expect(await migriere(db)).toEqual(ALLE_VERSIONEN.filter((v) => v !== 1));
    expect(await versionen(db)).toEqual(ALLE_VERSIONEN);
    expect(await tabellen(db)).toEqual(expect.arrayContaining(NEUE_TABELLEN));
  });

  it('Version 6 gibt bestehenden Vertrieblern Stufe 1 und laesst sich wiederholen', async () => {
    ordner = mkdtempSync(join(tmpdir(), 'migration-'));
    copyFileSync(join(MIGRATIONEN_ORDNER, '001-schema.sql'), join(ordner, '001-schema.sql'));
    db = await leereDb();
    await migriere(db, ordner);
    await db.query(
      `INSERT INTO benutzer (email, name, rolle, passwort_hash) VALUES ('alt@example.test', 'Alt', 'vertriebler', 'scrypt$1$1$1$a$a')`,
    );
    await migriere(db);
    const zeilen = await db.query<{ stufe: number; stufe_seit: string | null }>(
      "SELECT stufe, stufe_seit FROM benutzer WHERE email = 'alt@example.test'",
    );
    expect(Number(zeilen[0].stufe)).toBe(1);
    expect(zeilen[0].stufe_seit).toBeNull();
    // Ein zweiter Lauf derselben Datei aendert nichts und wirft nicht.
    await db.exec(readFileSync(join(MIGRATIONEN_ORDNER, '006-stufe-briefing.sql'), 'utf8'));
    await expect(db.query("INSERT INTO benutzer (email, name, rolle, passwort_hash, stufe) VALUES ('x@example.test', 'X', 'vertriebler', 'h', 3)")).rejects.toThrow();
  });

  it('befristet beim Nachziehen von Version 4 auch laengst bestehende offene Einladungen', async () => {
    ordner = mkdtempSync(join(tmpdir(), 'migration-'));
    for (const datei of ['001-schema.sql', '002-pflichtsaetze.sql', '003-lernen.sql']) {
      copyFileSync(join(MIGRATIONEN_ORDNER, datei), join(ordner, datei));
    }
    db = await leereDb();
    await migriere(db, ordner);
    // Eine Einladung aus der Zeit vor Version 4: Spalte existiert noch nicht,
    // "passwort_wechsel_noetig" ist wahr. Ohne den Nachzieh-Befehl in 004
    // bliebe das Einmal-Passwort fuer immer gueltig.
    await db.query(
      `INSERT INTO benutzer (email, name, rolle, passwort_hash, passwort_wechsel_noetig)
       VALUES ('alt@example.test', 'Alt', 'vertriebler', 'scrypt$1$1$1$a$a', true)`,
    );

    await migriere(db);

    const zeilen = await db.query<{ einmal_passwort_bis: string | null }>(
      "SELECT einmal_passwort_bis FROM benutzer WHERE email = 'alt@example.test'",
    );
    expect(zeilen[0].einmal_passwort_bis).not.toBeNull();
  });
});
