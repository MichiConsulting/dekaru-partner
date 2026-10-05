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

/** Alle Versionen laut Dateien im Ordner, aufsteigend. */
const ALLE = readdirSync(MIGRATIONEN_ORDNER)
  .filter((n) => /^\d{3}-.*\.sql$/.test(n))
  .map((n) => Number(n.slice(0, 3)))
  .sort((a, b) => a - b);
const ab = (n: number) => ALLE.filter((v) => v >= n);

const NEUE_TABELLEN = [
  'pflichtsatz_antworten',
  'lernkarten_stand',
  'abfrage_durchlaeufe',
  'kalender_token',
  'stufen_protokoll',
  'briefings',
  'admin_protokoll',
  'kunden_statuswechsel',
  'dubletten_meldungen',
];

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
    expect(nummern).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const datei of dateien) {
      const sql = readFileSync(join(MIGRATIONEN_ORDNER, datei), 'utf8');
      expect(sql).toContain(`INSERT INTO schema_version (version) VALUES (${Number(datei.slice(0, 3))})`);
    }
  });

  it('wendet auf eine frische Datenbank alle Versionen an', async () => {
    db = await leereDb();
    expect(await migriere(db)).toEqual(ALLE);
    expect(await versionen(db)).toEqual(ALLE);
    expect(await tabellen(db)).toEqual(expect.arrayContaining(NEUE_TABELLEN));
    expect(await migriere(db)).toEqual([]);
  });

  it('wendet auf eine Datenbank mit nur Version 1 genau die fehlenden an', async () => {
    ordner = mkdtempSync(join(tmpdir(), 'migration-'));
    copyFileSync(join(MIGRATIONEN_ORDNER, '001-schema.sql'), join(ordner, '001-schema.sql'));
    db = await leereDb();
    expect(await migriere(db, ordner)).toEqual([1]);
    expect(await versionen(db)).toEqual([1]);
    expect(await tabellen(db)).not.toEqual(expect.arrayContaining(['pflichtsatz_antworten']));

    expect(await migriere(db)).toEqual(ab(2));
    expect(await versionen(db)).toEqual(ALLE);
    expect(await tabellen(db)).toEqual(expect.arrayContaining(NEUE_TABELLEN));
  });

  it('Version 5 ergaenzt die Wiedervorlage-Spalten an kunden', async () => {
    db = await leereDb();
    await migriere(db);
    const spalten = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'kunden'",
    );
    expect(spalten.map((s) => s.column_name)).toEqual(
      expect.arrayContaining(['wiedervorlage_am', 'wiedervorlage_grund', 'wiedervorlage_erledigt_am']),
    );
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

  it('bringt eine Datenbank mit Stand 1 bis 3 und Bestand auf 9, so wie die Live-Datenbank', async () => {
    ordner = mkdtempSync(join(tmpdir(), 'migration-'));
    for (const datei of ['001-schema.sql', '002-pflichtsaetze.sql', '003-lernen.sql']) {
      copyFileSync(join(MIGRATIONEN_ORDNER, datei), join(ordner, datei));
    }
    db = await leereDb();
    expect(await migriere(db, ordner)).toEqual([1, 2, 3]);
    const [v] = await db.query<{ id: string }>(
      `INSERT INTO benutzer (email, name, rolle, passwort_hash, vertriebler_slug, passwort_wechsel_noetig)
       VALUES ('live@example.test', 'Live', 'vertriebler', 'scrypt$1$1$1$a$a', 'live', true) RETURNING id`,
    );
    await db.query(
      `INSERT INTO kunden (benutzer_id, name, ort, telefon, status, status_seit) VALUES ($1, 'Bäckerei Alt', 'Horb', '07451 1234', 'termin', '2026-09-01')`,
      [v.id],
    );
    await db.query(
      `INSERT INTO provision_abrechnungen (vertriebler_slug, monat, daten) VALUES ('live', '2026-09', '{"format":1}'::jsonb)`,
    );

    expect(await migriere(db)).toEqual(ab(4));
    expect(await versionen(db)).toEqual(ALLE);
    expect(await tabellen(db)).toEqual(expect.arrayContaining(NEUE_TABELLEN));

    const [b] = await db.query<{ stufe: number; provision_mail: boolean; einmal_passwort_bis: string | null }>(
      "SELECT stufe, provision_mail, einmal_passwort_bis FROM benutzer WHERE email = 'live@example.test'",
    );
    expect(Number(b.stufe)).toBe(1);
    expect(b.provision_mail).toBe(true);
    expect(b.einmal_passwort_bis).not.toBeNull();
    // Alte Abrechnungen bekommen keinen Mailstatus, also keine Mail fuer alte Monate.
    const [a] = await db.query<{ benachrichtigung: string | null }>('SELECT benachrichtigung FROM provision_abrechnungen');
    expect(a.benachrichtigung).toBeNull();
    // Der Statusverlauf zieht den Bestand nach.
    const wechsel = await db.query<{ status: string }>('SELECT status FROM kunden_statuswechsel');
    expect(wechsel.map((w) => w.status)).toEqual(['termin']);
    // Ein zweiter Lauf aendert nichts.
    expect(await migriere(db)).toEqual([]);
  });

  it('Version 9 ergaenzt Uhrzeit und Dauer am Termin, alte Termine bleiben ganztaegig', async () => {
    ordner = mkdtempSync(join(tmpdir(), 'migration-'));
    for (const datei of readdirSync(MIGRATIONEN_ORDNER).filter((n) => /^00[1-8]-.*\.sql$/.test(n))) {
      copyFileSync(join(MIGRATIONEN_ORDNER, datei), join(ordner, datei));
    }
    db = await leereDb();
    await migriere(db, ordner);
    const [v] = await db.query<{ id: string }>(
      `INSERT INTO benutzer (email, name, rolle, passwort_hash) VALUES ('t@example.test', 'T', 'vertriebler', 'h') RETURNING id`,
    );
    await db.query(
      `INSERT INTO kunden (benutzer_id, name, status, status_seit, termin_datum) VALUES ($1, 'Alt', 'termin', '2026-10-01', '2026-10-07')`,
      [v.id],
    );
    expect(await migriere(db)).toEqual([9, 10]);
    const [k] = await db.query<{ termin_beginn: string | null; termin_dauer_minuten: number | null }>(
      'SELECT termin_beginn, termin_dauer_minuten FROM kunden',
    );
    expect(k.termin_beginn).toBeNull();
    expect(k.termin_dauer_minuten).toBeNull();

    // Uhrzeit nur mit Datum, Dauer nur mit Uhrzeit, Dauer 5 bis 720 Minuten.
    await expect(db.query("UPDATE kunden SET termin_datum = NULL, termin_beginn = '10:00'")).rejects.toThrow();
    await expect(db.query('UPDATE kunden SET termin_dauer_minuten = 60')).rejects.toThrow();
    await expect(db.query("UPDATE kunden SET termin_beginn = '10:00', termin_dauer_minuten = 721")).rejects.toThrow();
    await db.query("UPDATE kunden SET termin_beginn = '10:00', termin_dauer_minuten = 90");

    // Ein zweiter Lauf derselben Datei wirft nicht.
    await db.exec(readFileSync(join(MIGRATIONEN_ORDNER, '009-termin-uhrzeit.sql'), 'utf8'));
  });

  it('Version 10 ergaenzt die Farbpalette am Bogen, uebernimmt Werte aus dem JSON und prueft das Format', async () => {
    ordner = mkdtempSync(join(tmpdir(), 'migration-'));
    for (const datei of readdirSync(MIGRATIONEN_ORDNER).filter((n) => /^\d{3}-.*\.sql$/.test(n) && Number(n.slice(0, 3)) < 10)) {
      copyFileSync(join(MIGRATIONEN_ORDNER, datei), join(ordner, datei));
    }
    db = await leereDb();
    await migriere(db, ordner);
    const [v] = await db.query<{ id: string }>(
      `INSERT INTO benutzer (email, name, rolle, passwort_hash) VALUES ('p@example.test', 'P', 'vertriebler', 'scrypt$1$1$1$a$a') RETURNING id`,
    );
    await db.query(`INSERT INTO briefings (benutzer_id, daten) VALUES ($1, '{"felder":{"farbpalette":"HW-2"}}'::jsonb)`, [v.id]);
    await db.query(`INSERT INTO briefings (benutzer_id, daten) VALUES ($1, '{"felder":{"farbpalette":"<b>"}}'::jsonb)`, [v.id]);
    expect(await migriere(db)).toEqual([10]);
    const werte = await db.query<{ farbpalette: string | null }>('SELECT farbpalette FROM briefings ORDER BY farbpalette NULLS LAST');
    expect(werte.map((w) => w.farbpalette)).toEqual(['HW-2', null]);
    await db.query(`UPDATE briefings SET farbpalette = 'offen' WHERE farbpalette IS NULL`);
    await expect(db.query(`UPDATE briefings SET farbpalette = 'Petrol'`)).rejects.toThrow();
    // Wiederholbar.
    await db.exec(readFileSync(join(MIGRATIONEN_ORDNER, '010-briefing-farbpalette.sql'), 'utf8'));
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
