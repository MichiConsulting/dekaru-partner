// Import per Token: Schutz, Formatpruefung, Idempotenz und Benachrichtigung.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db.ts';
import { neueDb, vertriebler } from './helfer.ts';
import { ladeAbrechnung, markiereAusgezahlt } from '../src/lib/provision.ts';
import {
  bearbeiteImportAnfrage,
  benachrichtigungen,
  gleicherInhalt,
  provisionMailAn,
  RATE_PRAEFIX,
  setzeProvisionMail,
  tokenGueltig,
} from '../src/lib/provision-import.ts';
import type { Nachricht, Versender } from '../src/lib/smtp.ts';
import { entscheideZugriff, istTokenPfad } from '../src/lib/zugriff.ts';

const TOKEN = 'a'.repeat(20) + '0123456789abcdef0123456789abcdef';
const ENV = { PROVISION_IMPORT_TOKEN: TOKEN };
const PORTAL = 'https://partner.dekaru.de';

const ZEILE = {
  monat: '2026-10', betragCent: 24500, art: 'einmalig', text: 'Zahlungseingang', nummer: '2026-0007',
  slug: 'muster-baeckerei', kunde: 'Muster Bäckerei', grundlageCent: 70000, zahlungIso: '2026-10-14', leistungsmonat: null,
};

function datei(extra: Record<string, unknown> = {}) {
  return {
    format: 1, monat: '2026-10', vertriebler: 'anna', name: 'Anna', erstellt: '2026-11-03', auszahlungZum: '2026-11-05',
    satzProzent: 35, zeilen: [ZEILE], vortragCent: 0, summeCent: 24500, auszahlungCent: 24500, neuerVortragCent: 0,
    aufgelaufen: [], aufgelaufenCent: 0, hinweise: [],
    ...extra,
  };
}

class FakeVersender implements Versender {
  gesendet: Nachricht[] = [];
  fehler = false;
  async senden(n: Nachricht) {
    if (this.fehler) throw new Error('Relay abgelehnt');
    this.gesendet.push(n);
  }
}

function anfrage(body: unknown, opt: { token?: string | null; typ?: string; pruefen?: boolean; roh?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': opt.typ ?? 'application/json' };
  const token = opt.token === undefined ? TOKEN : opt.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request(`http://localhost/api/provision-import${opt.pruefen ? '?pruefen=1' : ''}`, {
    method: 'POST',
    headers,
    body: opt.roh ?? JSON.stringify(body),
  });
}

describe('Import per Token', () => {
  let db: Db;
  let annaId: string;
  let bertEmail: string;
  const post = new FakeVersender();
  let ipZaehler = 0;

  async function senden(req: Request, env: Record<string, string | undefined> = ENV, versender: Versender | null = post, ip?: string) {
    const r = await bearbeiteImportAnfrage({ request: req, db, ip: ip ?? `10.0.0.${++ipZaehler}`, env, versender, portalUrl: PORTAL });
    return { status: r.status, json: (await r.json()) as Record<string, unknown>, headers: r.headers };
  }

  beforeAll(async () => {
    db = await neueDb();
    annaId = (await vertriebler(db, 'Anna', 'anna')).id;
    bertEmail = (await vertriebler(db, 'Bert', 'bert')).email;
  });
  afterAll(() => db.close());
  beforeEach(() => {
    post.gesendet = [];
    post.fehler = false;
  });

  describe('Token-Schutz', () => {
    it('lehnt ohne Header, mit falschem Token und mit Token im falschen Schema ab', async () => {
      expect((await senden(anfrage(datei(), { token: null }))).status).toBe(401);
      expect((await senden(anfrage(datei(), { token: 'falsch' }))).status).toBe(401);
      const basic = new Request('http://localhost/api/provision-import', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Basic ${TOKEN}` }, body: JSON.stringify(datei()),
      });
      expect((await senden(basic)).status).toBe(401);
      const query = new Request(`http://localhost/api/provision-import?token=${TOKEN}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(datei()),
      });
      expect((await senden(query)).status).toBe(401);
      expect(await ladeAbrechnung(db, 'anna', '2026-10')).toBeNull();
    });

    it('ohne eingerichtetes oder mit zu kurzem Token immer 401, auch mit leerem Bearer', async () => {
      expect((await senden(anfrage(datei(), { token: '' }), {})).status).toBe(401);
      expect((await senden(anfrage(datei(), { token: TOKEN }), {})).status).toBe(401);
      expect((await senden(anfrage(datei(), { token: 'kurz' }), { PROVISION_IMPORT_TOKEN: 'kurz' })).status).toBe(401);
      expect(tokenGueltig('Bearer ', '')).toBe(false);
      expect(tokenGueltig(null, null)).toBe(false);
      expect(tokenGueltig(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
      expect(tokenGueltig(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    });

    it('sperrt eine IP nach fuenf Fehlversuchen, auch fuer das richtige Token', async () => {
      const ip = '192.0.2.77';
      for (let i = 0; i < 5; i += 1) expect((await senden(anfrage(datei(), { token: 'falsch' }), ENV, post, ip)).status).toBe(401);
      expect((await senden(anfrage(datei(), { token: 'falsch' }), ENV, post, ip)).status).toBe(429);
      const gesperrt = await senden(anfrage(datei()), ENV, post, ip);
      expect(gesperrt.status).toBe(429);
      expect(Number(gesperrt.headers.get('retry-after'))).toBeGreaterThan(0);
      // Andere IP ist nicht betroffen.
      expect((await senden(anfrage(datei(), { pruefen: true }), ENV, post, '192.0.2.78')).status).toBe(200);
      await db.query('DELETE FROM login_versuche WHERE schluessel = $1', [`${RATE_PRAEFIX}${ip}`]);
    });

    it('erfolgreiche Anfragen zaehlen nicht als Fehlversuch', async () => {
      const ip = '192.0.2.90';
      for (let i = 0; i < 8; i += 1) expect((await senden(anfrage(datei(), { pruefen: true }), ENV, post, ip)).status).toBe(200);
    });

    it('der Pfad braucht keinen Login, sonst nichts unter /api', () => {
      expect(istTokenPfad('/api/provision-import')).toBe(true);
      expect(entscheideZugriff('/api/provision-import', null)).toEqual({ typ: 'ok' });
      expect(entscheideZugriff('/api/anderes', null)).toEqual({ typ: 'login' });
      expect(entscheideZugriff('/api/provision-import/x', null)).toEqual({ typ: 'login' });
    });
  });

  describe('Formatpruefung', () => {
    it('nur JSON, gueltig und im vorhandenen Format', async () => {
      expect((await senden(anfrage(datei(), { typ: 'text/plain' }))).status).toBe(415);
      expect((await senden(anfrage(null, { typ: 'multipart/form-data; boundary=x' }))).status).toBe(415);
      expect((await senden(anfrage(null, { roh: '{kaputt' }))).status).toBe(400);
      const falsch = await senden(anfrage(datei({ summeCent: 1 })));
      expect(falsch.status).toBe(422);
      expect(String(falsch.json.fehler)).toMatch(/summeCent/);
      expect((await senden(anfrage(datei({ format: 2 })))).status).toBe(422);
      expect((await senden(anfrage(datei({ vertriebler: 'Anna Müller' })))).status).toBe(422);
      expect((await senden(anfrage(null, { roh: ' '.repeat(2_000_001) }))).status).toBe(413);
      expect(await ladeAbrechnung(db, 'anna', '2026-10')).toBeNull();
      expect(post.gesendet).toEqual([]);
    });
  });

  describe('Import, Idempotenz und Benachrichtigung', () => {
    it('Pruefung schreibt nichts und schickt nichts', async () => {
      const r = await senden(anfrage(datei(), { pruefen: true }));
      expect(r.json).toMatchObject({ ok: true, pruefung: true, status: 'neu' });
      expect(await ladeAbrechnung(db, 'anna', '2026-10')).toBeNull();
      expect(post.gesendet).toEqual([]);
    });

    it('legt neu an und schreibt genau Anna, ohne Betraege', async () => {
      const r = await senden(anfrage(datei()));
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ ok: true, status: 'neu', benachrichtigung: 'gesendet', vertriebler: 'anna', monat: '2026-10' });
      expect((await ladeAbrechnung(db, 'anna', '2026-10'))?.summeCent).toBe(24500);

      expect(post.gesendet).toHaveLength(1);
      const m = post.gesendet[0];
      expect(m.to).toBe('anna@example.test');
      expect(m.to).not.toBe(bertEmail);
      expect(m.subject).toBe('Ihre Provisionsabrechnung für Oktober 2026 ist im Portal');
      expect(m.text).toContain('https://partner.dekaru.de/provision/2026-10');
      expect(m.text).toContain('Guten Tag Anna');
      const alles = `${m.subject}\n${m.text}`;
      expect(alles).not.toMatch(/€|EUR/);
      for (const zahl of ['245', '24500', '700', '70000', 'Muster']) expect(alles).not.toContain(zahl);
      expect(alles).not.toMatch(/–|—/);
    });

    it('derselbe Inhalt ein zweites Mal: unveraendert, keine Mail, auch mit neuem erstellt-Datum', async () => {
      const r = await senden(anfrage(datei({ erstellt: '2026-11-05' })));
      expect(r.json).toMatchObject({ status: 'unveraendert', benachrichtigung: null });
      expect(post.gesendet).toEqual([]);
      const pruef = await senden(anfrage(datei(), { pruefen: true }));
      expect(pruef.json.status).toBe('unveraendert');
    });

    it('geaenderter Inhalt ersetzt, meldet eine fruehere Auszahlung und schreibt erneut', async () => {
      const vorher = (await ladeAbrechnung(db, 'anna', '2026-10'))!;
      await markiereAusgezahlt(db, vorher.id, '2026-11-05');
      const neu = datei({ zeilen: [{ ...ZEILE, betragCent: 20000 }], summeCent: 20000, auszahlungCent: 20000 });
      const r = await senden(anfrage(neu));
      expect(r.json).toMatchObject({ status: 'ersetzt', warAusgezahlt: true, benachrichtigung: 'gesendet' });
      const nachher = (await ladeAbrechnung(db, 'anna', '2026-10'))!;
      expect(nachher.id).toBe(vorher.id);
      expect(nachher.summeCent).toBe(20000);
      expect(post.gesendet).toHaveLength(1);
      expect(post.gesendet[0].text).toContain('aktualisiert');
      expect(post.gesendet[0].text).not.toContain('200');
    });

    it('abgeschaltet: Import ja, Mail nein, Status im Admin', async () => {
      expect(await provisionMailAn(db, annaId)).toBe(true);
      await setzeProvisionMail(db, annaId, false);
      expect(await provisionMailAn(db, annaId)).toBe(false);
      const r = await senden(anfrage(datei({ monat: '2026-11', zeilen: [{ ...ZEILE, monat: '2026-11' }] })));
      expect(r.json).toMatchObject({ status: 'neu', benachrichtigung: 'abgeschaltet' });
      expect(post.gesendet).toEqual([]);
      const id = (await ladeAbrechnung(db, 'anna', '2026-11'))!.id;
      expect((await benachrichtigungen(db)).get(id)).toBe('abgeschaltet');
      await setzeProvisionMail(db, annaId, true);
    });

    it('ohne SMTP: Import ja, Status kein_smtp', async () => {
      const r = await senden(anfrage(datei({ vertriebler: 'bert', name: 'Bert' })), ENV, null);
      expect(r.json).toMatchObject({ status: 'neu', benachrichtigung: 'kein_smtp' });
    });

    it('ohne SMTP-Variablen baut der Endpunkt keinen Versender', async () => {
      const r = await bearbeiteImportAnfrage({
        request: anfrage(datei({ monat: '2026-09', zeilen: [{ ...ZEILE, monat: '2026-09' }] })),
        db, ip: '198.51.100.1', env: ENV, portalUrl: PORTAL,
      });
      expect(await r.json()).toMatchObject({ status: 'neu', benachrichtigung: 'kein_smtp' });
    });

    it('Slug ohne Zugang: Import ja, niemand bekommt Post', async () => {
      const r = await senden(anfrage(datei({ vertriebler: 'carla', name: 'Carla' })));
      expect(r.json).toMatchObject({ status: 'neu', benachrichtigung: 'kein_konto' });
      expect(post.gesendet).toEqual([]);
    });

    it('Mailfehler macht den Import nicht rueckgaengig', async () => {
      post.fehler = true;
      const r = await senden(anfrage(datei({ monat: '2026-12', zeilen: [{ ...ZEILE, monat: '2026-12' }] })));
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ status: 'neu', benachrichtigung: 'fehler' });
      expect(await ladeAbrechnung(db, 'anna', '2026-12')).not.toBeNull();
    });

    it('erneutes Senden holt eine gescheiterte oder haengengebliebene Mail genau einmal nach', async () => {
      // 2026-12 ist aus dem vorigen Test mit 'fehler' stehen geblieben.
      const zwoelf = datei({ monat: '2026-12', zeilen: [{ ...ZEILE, monat: '2026-12' }] });
      const r = await senden(anfrage(zwoelf));
      expect(r.json).toMatchObject({ status: 'unveraendert', benachrichtigung: 'gesendet' });
      expect(post.gesendet).toHaveLength(1);
      expect(post.gesendet[0].to).toBe('anna@example.test');
      const nochmal = await senden(anfrage(zwoelf));
      expect(nochmal.json).toMatchObject({ status: 'unveraendert', benachrichtigung: null });
      expect(post.gesendet).toHaveLength(1);

      // Zeitlimit mitten im Versand: Status bleibt 'ausstehend', naechstes Senden holt nach.
      const id = (await ladeAbrechnung(db, 'anna', '2026-12'))!.id;
      await db.query("UPDATE provision_abrechnungen SET benachrichtigung = 'ausstehend' WHERE id = $1", [id]);
      expect((await senden(anfrage(zwoelf))).json).toMatchObject({ benachrichtigung: 'gesendet' });
      expect(post.gesendet).toHaveLength(2);

      // Vor Migration 008 importiert (NULL): keine Mail fuer alte Monate.
      await db.query('UPDATE provision_abrechnungen SET benachrichtigung = NULL WHERE id = $1', [id]);
      expect((await senden(anfrage(zwoelf))).json).toMatchObject({ benachrichtigung: null });
      expect(post.gesendet).toHaveLength(2);
    });

    it('die Mail verlinkt die Einstellungen direkt', async () => {
      const r = await senden(anfrage(datei({ monat: '2027-01', zeilen: [{ ...ZEILE, monat: '2027-01' }] })));
      expect(r.json).toMatchObject({ benachrichtigung: 'gesendet' });
      expect(post.gesendet[0].text).toContain('https://partner.dekaru.de/einstellungen');
    });
  });
});

describe('Vergleich fuer die Idempotenz', () => {
  it('ignoriert Reihenfolge, undefined und erstellt', () => {
    expect(gleicherInhalt({ a: 1, b: { c: 2, d: undefined }, erstellt: 'x' }, { b: { c: 2 }, a: 1, erstellt: 'y' })).toBe(true);
    expect(gleicherInhalt({ a: 1 }, { a: 2 })).toBe(false);
    expect(gleicherInhalt({ l: [1, 2] }, { l: [2, 1] })).toBe(false);
  });
});
