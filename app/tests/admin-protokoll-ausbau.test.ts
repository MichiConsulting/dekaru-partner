// Protokoll fuer die Admin-Aktionen aus Stufe, Briefing und automatischem
// Provisionsimport: Stufe aendern, Bogen uebernehmen oder zurueckgeben,
// YAML-Export, Upload mit Mail, Nachholen einer Mail und Import per Token.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db.ts';
import { erstelleBenutzer, type Benutzer } from '../src/lib/auth.ts';
import { erstelleKunde, pruefeKunde } from '../src/lib/kunden.ts';
import { pruefeAbrechnung } from '../src/lib/provision.ts';
import { erstelleBriefing, holeBriefing, holeBriefingAdmin, pruefeBriefing, reicheEin } from '../src/lib/briefing.ts';
import { ladeStufe } from '../src/lib/stufe.ts';
import {
  AdminFehler,
  akteurAus,
  briefingStatusSetzen,
  briefingYamlExportieren,
  provisionImportierenMitMail,
  stufeAendern,
} from '../src/lib/admin-aktionen.ts';
import { ladeProtokoll, type Akteur } from '../src/lib/admin-protokoll.ts';
import { bearbeiteImportAnfrage } from '../src/lib/provision-import.ts';
import type { Nachricht, Versender } from '../src/lib/smtp.ts';
import { neueDb, vertriebler } from './helfer.ts';

let db: Db;
let chef: Benutzer;
let akteur: Akteur;
let anna: Benutzer;

class FakeVersender implements Versender {
  gesendet: Nachricht[] = [];
  fehler = false;
  async senden(n: Nachricht) {
    if (this.fehler) throw new Error('Relay abgelehnt');
    this.gesendet.push(n);
  }
}

function abrechnung(monat: string, summeCent = 0) {
  return pruefeAbrechnung({
    format: 1, monat, vertriebler: 'anna', name: 'Anna', erstellt: '2026-11-03', auszahlungZum: '2026-11-05',
    zeilen: [], vortragCent: 0, summeCent, auszahlungCent: summeCent, neuerVortragCent: 0, aufgelaufen: [], aufgelaufenCent: 0, hinweise: [],
  }).abrechnung!;
}

async function neueste() {
  return (await ladeProtokoll(db, {})).eintraege[0];
}
async function anzahl() {
  return (await ladeProtokoll(db, {})).eintraege.length;
}

beforeAll(async () => {
  db = await neueDb();
  chef = await erstelleBenutzer(db, { email: 'chef@example.test', name: 'Chef', rolle: 'admin', passwort: 'geheim-passwort-1' });
  akteur = akteurAus(chef);
  anna = await vertriebler(db, 'Anna', 'anna');
});
afterAll(() => db.close());

describe('Protokoll: Stufe', () => {
  it('Stufe aendern schreibt stufe_geaendert mit alt und neu', async () => {
    await stufeAendern(db, akteur, anna.id, { stufe: '2', seit: '2026-10-01', bestaetigtAm: '2026-09-30' });
    expect((await ladeStufe(db, anna.id)).stufe).toBe(2);
    const e = await neueste();
    expect(e.aktion).toBe('stufe_geaendert');
    expect(e.adminId).toBe(chef.id);
    expect(e.zielId).toBe(anna.id);
    expect(e.details).toMatchObject({ alt: 1, neu: 2, seit: '2026-10-01', bestaetigtAm: '2026-09-30' });
  });

  it('Stufe 2 ohne Bestaetigung scheitert und schreibt nichts', async () => {
    const vorher = await anzahl();
    await expect(stufeAendern(db, akteur, anna.id, { stufe: '2', seit: '2026-10-01', bestaetigtAm: '' })).rejects.toBeInstanceOf(AdminFehler);
    expect(await anzahl()).toBe(vorher);
  });
});

describe('Protokoll: Briefing-Bogen', () => {
  it('YAML-Export, Zurueckgeben und Uebernehmen stehen im Protokoll', async () => {
    const kunde = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Metallbau Sturm', ort: 'Nagold', status: 'zweittermin' }).wert);
    const bogen = (await erstelleBriefing(db, anna.id, kunde.id))!;
    const voll = pruefeBriefing({
      firmenname: 'Metallbau Sturm GmbH', rechtsform: 'GmbH', unterzeichner: 'Herr Peter Sturm', strasse: 'Industriestraße 7',
      plz: '72202', ort: 'Nagold', email: 'info@example.de', branche: 'Handwerk', paket: 'mittel', hosting: 'basis',
      zahlweise: 'monatlich', zulieferung_bis: '2026-11-01', fotos: 'kunde', fotorechte: 'on', logo: 'datei', referenz: 'ja',
      weiss_angebot: 'on', weiss_zulieferung: 'on', weiss_rueckfragen: 'on',
    });
    await reicheEin(db, anna.id, bogen.id, voll.daten);

    const yaml = await briefingYamlExportieren(db, akteur, (await holeBriefingAdmin(db, bogen.id))!);
    expect(yaml.inhalt).toContain('Metallbau Sturm GmbH');
    expect((await holeBriefing(db, anna.id, bogen.id))?.status).toBe('uebernommen');
    let e = await neueste();
    expect(e.aktion).toBe('briefing_yaml_exportiert');
    expect(e.zielTyp).toBe('briefing');
    expect(e.zielText).toBe('Metallbau Sturm (von Anna)');
    expect(e.details).toMatchObject({ alsUebernommenMarkiert: true });
    // Kein Feldinhalt aus dem Bogen im Protokoll, nur Name und Dateiname.
    expect(JSON.stringify(e.details)).not.toContain('Industriestraße');

    const admin = (await holeBriefingAdmin(db, bogen.id))!;
    await briefingStatusSetzen(db, akteur, admin, 'entwurf');
    e = await neueste();
    expect(e.aktion).toBe('briefing_zurueckgegeben');

    // Ein Entwurf laesst sich nicht noch einmal zurueckgeben, kein Eintrag.
    const vorher = await anzahl();
    await expect(briefingStatusSetzen(db, akteur, admin, 'entwurf')).rejects.toBeInstanceOf(AdminFehler);
    expect(await anzahl()).toBe(vorher);

    await reicheEin(db, anna.id, bogen.id, voll.daten);
    await briefingStatusSetzen(db, akteur, admin, 'uebernommen');
    expect((await neueste()).aktion).toBe('briefing_uebernommen');
  });
});

describe('Protokoll: Provision mit Mail', () => {
  const post = new FakeVersender();
  const optionen = { versender: post, portalUrl: 'https://partner.dekaru.de', datei: 'anna.json' };

  it('Upload im Admin protokolliert Import und Mailstatus', async () => {
    const e = await provisionImportierenMitMail(db, akteur, abrechnung('2026-10'), optionen);
    expect(e).toMatchObject({ status: 'neu', benachrichtigung: 'gesendet' });
    const p = await neueste();
    expect(p.aktion).toBe('provision_importiert');
    expect(p.adminId).toBe(chef.id);
    expect(p.details).toMatchObject({ ersetzt: false, benachrichtigung: 'gesendet', datei: 'anna.json' });
  });

  it('unveraendert ohne offene Mail schreibt nichts', async () => {
    const vorher = await anzahl();
    const e = await provisionImportierenMitMail(db, akteur, abrechnung('2026-10'), optionen);
    expect(e.status).toBe('unveraendert');
    expect(await anzahl()).toBe(vorher);
  });

  it('eine nachgeholte Mail steht als eigener Eintrag im Protokoll', async () => {
    post.fehler = true;
    await provisionImportierenMitMail(db, akteur, abrechnung('2026-11'), optionen);
    expect((await neueste()).details).toMatchObject({ benachrichtigung: 'fehler' });
    post.fehler = false;
    const e = await provisionImportierenMitMail(db, akteur, abrechnung('2026-11'), optionen);
    expect(e).toMatchObject({ status: 'unveraendert', benachrichtigung: 'gesendet' });
    const p = await neueste();
    expect(p.aktion).toBe('provision_mail_nachgeholt');
    expect(p.details).toEqual({ benachrichtigung: 'gesendet' });
  });

  it('der Import per Token steht als "Import per Token" ohne Admin-ID im Protokoll', async () => {
    const token = 'b'.repeat(64);
    const r = await bearbeiteImportAnfrage({
      request: new Request('http://localhost/api/provision-import', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(abrechnung('2026-12')),
      }),
      db,
      ip: '203.0.113.9',
      env: { PROVISION_IMPORT_TOKEN: token },
      versender: post,
      portalUrl: 'https://partner.dekaru.de',
    });
    expect(r.status).toBe(200);
    const p = await neueste();
    expect(p.aktion).toBe('provision_importiert');
    expect(p.adminId).toBeNull();
    expect(p.adminName).toBe('Import per Token');
    expect(p.zielText).toBe('anna 2026-12');
    expect(JSON.stringify(p)).not.toContain(token);
  });
});
