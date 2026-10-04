// Protokoll der Admin-Aktionen: jede Aktion hinterlaesst genau einen Eintrag,
// ohne Passwort, und kein Eintrag laesst sich aendern oder loeschen.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../src/lib/db.ts';
import { erstelleBenutzer, holeBenutzer, type Benutzer } from '../src/lib/auth.ts';
import { erstelleKunde, pruefeKunde } from '../src/lib/kunden.ts';
import { pruefeAbrechnung } from '../src/lib/provision.ts';
import { pruefeDublette } from '../src/lib/dubletten.ts';
import {
  AdminFehler,
  akteurAus,
  auszahlungMarkieren,
  dubletteEntscheiden,
  einmalPasswortNeu,
  provisionImportieren,
  slugAendern,
  zugangAktivieren,
  zugangAnlegen,
  zugangDeaktivieren,
} from '../src/lib/admin-aktionen.ts';
import {
  AKTIONEN,
  bereinigeDetails,
  ladeProtokoll,
  protokolliere,
  skriptAkteur,
  type Akteur,
} from '../src/lib/admin-protokoll.ts';
import { neueDb, vertriebler } from './helfer.ts';

let db: Db;
let chef: Benutzer;
let akteur: Akteur;

const abrechnung = pruefeAbrechnung({
  format: 1, monat: '2026-10', vertriebler: 'neu-slug', name: 'Nora', erstellt: '2026-10-28', auszahlungZum: '2026-10-28',
  zeilen: [], vortragCent: 0, summeCent: 0, auszahlungCent: 0, neuerVortragCent: 0, aufgelaufen: [], aufgelaufenCent: 0, hinweise: [],
}).abrechnung!;

async function alle() {
  return (await ladeProtokoll(db, {})).eintraege;
}

beforeAll(async () => {
  db = await neueDb();
  chef = await erstelleBenutzer(db, { email: 'chef@example.test', name: 'Chef', rolle: 'admin', passwort: 'geheim-passwort-1' });
  akteur = akteurAus(chef);
});
afterAll(() => db.close());

describe('Protokoll: Vollstaendigkeit', () => {
  const passwoerter: string[] = [];

  it('jede Admin-Aktion schreibt genau einen Eintrag mit Wer, Was, Ziel', async () => {
    const vorher = (await alle()).length;
    const { benutzer: nora, passwort } = await zugangAnlegen(db, akteur, { name: 'Nora', email: 'nora@example.test', slug: 'nora', rolle: 'vertriebler' });
    passwoerter.push(passwort);
    await zugangDeaktivieren(db, akteur, nora.id);
    await zugangAktivieren(db, akteur, nora.id);
    passwoerter.push(await einmalPasswortNeu(db, akteur, nora.id));
    await slugAendern(db, akteur, nora.id, 'neu-slug');
    const imp = await provisionImportieren(db, akteur, abrechnung, 'neu-slug.json');
    await auszahlungMarkieren(db, akteur, imp.id, '2026-10-30');
    await auszahlungMarkieren(db, akteur, imp.id, null);

    const eintraege = await alle();
    expect(eintraege.length - vorher).toBe(8);
    const aktionen = eintraege.map((e) => e.aktion).reverse();
    expect(aktionen).toEqual([
      'zugang_angelegt',
      'zugang_deaktiviert',
      'zugang_aktiviert',
      'einmal_passwort_neu',
      'slug_geaendert',
      'provision_importiert',
      'provision_ausgezahlt',
      'provision_auszahlung_zurueck',
    ]);
    for (const e of eintraege) {
      expect(e.adminId).toBe(chef.id);
      expect(e.adminName).toBe('Chef');
      expect(e.zeitpunkt).toBeInstanceOf(Date);
      expect(e.zielText).not.toBe('');
    }
    const slug = eintraege.find((e) => e.aktion === 'slug_geaendert')!;
    expect(slug.details).toEqual({ alt: 'nora', neu: 'neu-slug' });
    expect(slug.zielId).toBe(nora.id);
    expect(eintraege.find((e) => e.aktion === 'provision_ausgezahlt')!.zielText).toBe('neu-slug 2026-10');
  });

  it('kein Passwort, kein Hash, kein Token landet im Protokoll', async () => {
    const rohe = await db.query('SELECT * FROM admin_protokoll');
    const text = JSON.stringify(rohe);
    for (const p of passwoerter) expect(text).not.toContain(p);
    expect(text).not.toMatch(/scrypt\$/);
    const hash = await db.query<{ passwort_hash: string }>("SELECT passwort_hash FROM benutzer WHERE email = 'nora@example.test'");
    expect(text).not.toContain(hash[0].passwort_hash);
  });

  it('bereinigt Details, auch verschachtelt', async () => {
    expect(bereinigeDetails({ passwort: 'x', neuesPasswort: 'y', token: 't', csrf: 'c', ok: 1, tief: { hash: 'h', b: 'b' } })).toEqual({
      ok: 1,
      tief: { b: 'b' },
    });
    await protokolliere(db, akteur, { aktion: 'stufe_geaendert', zielText: 'Nora', details: { alt: 1, neu: 2, passwort: 'nie' } });
    const e = (await alle())[0];
    expect(e.details).toEqual({ alt: 1, neu: 2 });
  });

  it('fehlgeschlagene Aktionen schreiben nichts', async () => {
    const vorher = (await alle()).length;
    await expect(slugAendern(db, akteur, chef.id, 'Ungueltig!')).rejects.toBeInstanceOf(AdminFehler);
    await expect(zugangDeaktivieren(db, akteur, chef.id)).rejects.toBeInstanceOf(AdminFehler);
    await expect(zugangAnlegen(db, akteur, { name: 'Nora 2', email: 'nora@example.test', rolle: 'vertriebler' })).rejects.toBeInstanceOf(AdminFehler);
    await expect(auszahlungMarkieren(db, akteur, '00000000-0000-0000-0000-000000000000', '2026-10-01')).rejects.toBeInstanceOf(AdminFehler);
    expect((await alle()).length).toBe(vorher);
  });

  it('protokolliert Dubletten-Entscheidungen und Skript-Importe', async () => {
    const anna = await vertriebler(db, 'Anna');
    const bert = await vertriebler(db, 'Bert');
    const k = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Bäckerei Muster', ort: 'Horb', status: 'angerufen' }).wert);
    await pruefeDublette(db, bert, { name: 'Baeckerei Muster GmbH', ort: 'Horb', telefon: '' });
    const [m] = await db.query<{ id: string }>("SELECT id FROM dubletten_meldungen WHERE status = 'offen'");
    await dubletteEntscheiden(db, akteur, m.id, 'freigeben');
    const e = (await alle())[0];
    expect(e.aktion).toBe('dublette_freigegeben');
    expect(e.zielText).toContain('Bert');
    expect(k.id).toBeTruthy();

    await provisionImportieren(db, skriptAkteur('provision-import'), abrechnung);
    const s = (await alle())[0];
    expect(s.adminId).toBeNull();
    expect(s.adminName).toBe('Skript provision-import');
  });

  it('lehnt unbekannte Aktionen ab', async () => {
    // @ts-expect-error absichtlich falscher Schluessel
    await expect(protokolliere(db, akteur, { aktion: 'irgendwas' })).rejects.toThrow(/Unbekannte/);
  });

  it('filtert nach Aktion, Suche und Zeitraum', async () => {
    const nurSlug = await ladeProtokoll(db, { aktion: 'slug_geaendert' });
    expect(nurSlug.eintraege.map((e) => e.aktion)).toEqual(['slug_geaendert']);
    const nora = await ladeProtokoll(db, { suche: 'nora' });
    expect(nora.eintraege.length).toBeGreaterThanOrEqual(5);
    expect(nora.eintraege.every((e) => /nora/i.test(e.zielText) || /nora/i.test(e.adminName))).toBe(true);
    const morgen = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    expect((await ladeProtokoll(db, { von: morgen })).eintraege).toEqual([]);
    expect((await ladeProtokoll(db, { aktion: 'gibts-nicht' })).eintraege.length).toBe((await alle()).length);
  });
});

describe('Protokoll: unveraenderlich', () => {
  it('UPDATE, DELETE und TRUNCATE scheitern an der Datenbank', async () => {
    const vorher = await db.query('SELECT * FROM admin_protokoll ORDER BY id');
    await expect(db.query("UPDATE admin_protokoll SET admin_name = 'Fremd'")).rejects.toThrow(/unveraenderlich/);
    await expect(db.query('DELETE FROM admin_protokoll')).rejects.toThrow(/unveraenderlich/);
    await expect(db.query('TRUNCATE admin_protokoll')).rejects.toThrow(/unveraenderlich/);
    expect(await db.query('SELECT * FROM admin_protokoll ORDER BY id')).toEqual(vorher);
  });

  it('nur Eintraege nach Ablauf der Aufbewahrung lassen sich loeschen', async () => {
    // Ein alter Eintrag laesst sich nur anlegen, nicht nachtraeglich altern.
    await db.query(
      "INSERT INTO admin_protokoll (admin_name, aktion, zeitpunkt) VALUES ('Chef', 'zugang_angelegt', now() - interval '25 months')",
    );
    const geloescht = await db.query("DELETE FROM admin_protokoll WHERE zeitpunkt < now() - interval '24 months' RETURNING id");
    expect(geloescht.length).toBe(1);
  });

  it('ein geloeschter Benutzer laesst seine Eintraege stehen', async () => {
    const nora = (await db.query<{ id: string }>("SELECT id FROM benutzer WHERE email = 'nora@example.test'"))[0];
    const vorher = (await alle()).length;
    await db.query('DELETE FROM benutzer WHERE id = $1', [nora.id]);
    expect(await holeBenutzer(db, nora.id)).toBeNull();
    expect((await alle()).length).toBe(vorher);
  });

  it('im Code gibt es kein UPDATE und kein DELETE auf admin_protokoll', () => {
    const src = fileURLToPath(new URL('../src', import.meta.url));
    const skripte = fileURLToPath(new URL('../scripts', import.meta.url));
    for (const datei of dateien(src).concat(dateien(skripte))) {
      const text = readFileSync(datei, 'utf8');
      expect(text, datei).not.toMatch(/(UPDATE|DELETE\s+FROM|TRUNCATE)\s+admin_protokoll/i);
    }
  });
});

describe('Protokoll: Admin-Seiten schreiben nur ueber admin-aktionen.ts', () => {
  // Bausteine, die nur ueber eine protokollierende Funktion aufgerufen werden duerfen.
  const VERBOTEN = /\b(setzeAktiv|setzePasswort|erstelleBenutzer|importiereAbrechnung|markiereAusgezahlt|beendeAlleSitzungen)\s*\(|\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\b/;

  it('keine Admin-Seite ruft einen schreibenden Baustein direkt auf', () => {
    const ordner = fileURLToPath(new URL('../src/pages/admin', import.meta.url));
    const liste = dateien(ordner);
    expect(liste.length).toBeGreaterThan(3);
    for (const datei of liste) {
      expect(readFileSync(datei, 'utf8'), datei).not.toMatch(VERBOTEN);
    }
  });

  it('die Skripte protokollieren ihre Schreibvorgaenge', () => {
    for (const name of ['provision-import.mjs', 'admin-anlegen.mjs']) {
      const text = readFileSync(fileURLToPath(new URL(`../scripts/${name}`, import.meta.url)), 'utf8');
      expect(text, name).toMatch(/skriptAkteur/);
      expect(text, name).not.toMatch(/\bimportiereAbrechnung\s*\(/);
    }
  });

  it('der Katalog kennt alle geforderten Aktionen', () => {
    for (const a of ['zugang_angelegt', 'zugang_deaktiviert', 'einmal_passwort_neu', 'slug_geaendert', 'stufe_geaendert', 'provision_importiert', 'provision_ausgezahlt']) {
      expect(Object.keys(AKTIONEN)).toContain(a);
    }
  });
});

function dateien(ordner: string): string[] {
  return readdirSync(ordner).flatMap((n) => {
    const p = join(ordner, n);
    return statSync(p).isDirectory() ? dateien(p) : /\.(ts|astro|mjs)$/.test(n) ? [p] : [];
  });
}
