// Die Kalender-Seiten so, wie der Server sie ausliefert (ohne JavaScript):
// Monat als Tabelle, Woche und Tag mit Stundenraster, Liste, Termin anlegen.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import KalenderSeite from '../src/pages/kalender/index.astro';
import NeuSeite from '../src/pages/kalender/neu.astro';
import KundeNeuSeite from '../src/pages/kunden/neu.astro';
import type { Db } from '../src/lib/db.ts';
import type { Benutzer } from '../src/lib/auth.ts';
import { erstelleKunde, holeKunde, pruefeKunde, type Kunde } from '../src/lib/kunden.ts';
import { setzeWiedervorlage } from '../src/lib/wiedervorlage.ts';
import { heuteBerlin, monatVon, plusTage } from '../src/lib/datum.ts';
import { neueDb, vertriebler } from './helfer.ts';

let db: Db;
let anna: Benutzer;
let bert: Benutzer;
const heute = heuteBerlin();
// Ein fester Tag mitten im Monat von heute, damit alles im selben Raster liegt.
const tag = `${monatVon(heute)}-15`;
let zeit: Kunde;
let ganz: Kunde;
let fremd: Kunde;

beforeAll(async () => {
  db = await neueDb();
  anna = await vertriebler(db, 'Anna');
  bert = await vertriebler(db, 'Bert');
  zeit = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Bäckerei Zeit', status: 'termin', terminDatum: tag, terminBeginn: '09:30', terminDauer: '90' }).wert);
  ganz = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Metallbau Ganztag', status: 'zweittermin', terminDatum: tag }).wert);
  await setzeWiedervorlage(db, anna.id, ganz.id, { datum: tag, grund: 'GEHEIMER-GRUND' });
  for (const n of ['Drei', 'Vier', 'Fünf']) {
    await erstelleKunde(db, anna.id, pruefeKunde({ name: `Betrieb ${n}`, status: 'termin', terminDatum: tag, terminBeginn: '09:45' }).wert);
  }
  fremd = await erstelleKunde(db, bert.id, pruefeKunde({ name: 'Fremder Betrieb', status: 'termin', terminDatum: tag }).wert);
});
afterAll(() => db.close());

async function seite(komponente: typeof KalenderSeite, url: string, benutzer: Benutzer, felder?: Record<string, string>) {
  const container = await AstroContainer.create();
  const request = felder
    ? new Request(`http://localhost${url}`, {
        method: 'POST',
        body: new URLSearchParams({ _csrf: 'x', ...felder }),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
    : new Request(`http://localhost${url}`);
  const antwort = await container.renderToResponse(komponente, { request, locals: { db, benutzer, csrf: 'x', sitzungId: 's' } });
  return { status: antwort.status, ort: antwort.headers.get('location'), html: await antwort.text() };
}

describe('Monat', () => {
  it('ist eine Tabelle Mo bis So mit heute markiert und Balken je Eintrag', async () => {
    const { html } = await seite(KalenderSeite, `/kalender?ansicht=monat&datum=${tag}`, anna);
    expect(html).toMatch(/<table class="kal-monat"[^>]*aria-labelledby="kal-titel"/);
    expect(html.match(/<th scope="col"/g)?.length).toBe(7);
    expect(html).toContain('abbr="Montag"');
    expect(html).toMatch(/<td class="[^"]*kal-zelle--heute[^"]*"[^>]*aria-current="date"/);
    // Fuenf Eintraege am Tag (Termine und Wiedervorlage): zwei Balken und "+4 weitere".
    expect(html).toContain('+4 weitere');
    expect(html).toContain(`href="/kalender?ansicht=tag&amp;datum=${tag}"`);
    // Unterscheidbar nicht nur ueber Farbe.
    expect(html).toContain('kal-balken--wv');
    expect(html).toContain('Wiedervorlage, ganztägig: ');
    expect(html).toContain('Termin, ganztägig: ');
    // Freie Flaeche zum Anlegen, nur Maus.
    expect(html).toMatch(new RegExp(`<a class="kal-zelle__neu" href="/kalender/neu\\?datum=${tag}" tabindex="-1" aria-hidden="true"`));
    // Fremdes und Gruende bleiben draussen.
    expect(html).not.toContain('Fremder Betrieb');
    expect(html).not.toContain('GEHEIMER-GRUND');
  });

  it('zeigt die Tagesliste des gewaehlten Tages fuers Handy', async () => {
    const { html } = await seite(KalenderSeite, `/kalender?ansicht=monat&datum=${tag}`, anna);
    const liste = html.slice(html.indexOf('id="kal-tagesliste"'));
    for (const name of ['Bäckerei Zeit', 'Metallbau Ganztag', 'Betrieb Drei', 'Betrieb Vier', 'Betrieb Fünf']) expect(liste).toContain(name);
    expect(html).toContain('kal-zelle--gewaehlt');
  });
});

describe('Woche und Tag', () => {
  it('legt Termine mit Uhrzeit ins Stundenraster und ganztaegige in die obere Zeile', async () => {
    const { html } = await seite(KalenderSeite, `/kalender?ansicht=woche&datum=${tag}`, anna);
    expect(html).toContain('data-von="7" data-bis="20"');
    // 09:30 bei 7 bis 20 Uhr: 150 von 780 Minuten.
    expect(html).toContain(`--oben:${((150 / 780) * 100).toFixed(3)}%`);
    // Drei Termine um 09:45 und einer um 09:30 ueberlappen: vier Spuren.
    expect(html).toContain('--spuren:4');
    expect(html).toContain('Termin, 09:30 bis 11:00 Uhr: ');
    expect(html).toMatch(/aria-label="Ganztägig am [^"]+"/);
    expect(html.match(/class="kal-zeit__kopf/g)?.length).toBe(7);
    // Stundenfelder nur fuer die Maus, jeder Tag hat einen Knopf fuer die Tastatur.
    expect(html).toMatch(/<a class="kal-slot" href="\/kalender\/neu\?datum=\d{4}-\d{2}-\d{2}&amp;beginn=07%3A00" tabindex="-1" aria-hidden="true"/);
    expect(html.match(/aria-label="Neuer Termin am /g)?.length).toBe(7);
  });

  it('Tag zeigt eine Spalte, alte Wochenlinks funktionieren weiter', async () => {
    const tagSeite = await seite(KalenderSeite, `/kalender?ansicht=tag&datum=${tag}`, anna);
    expect(tagSeite.html.match(/class="kal-zeit__kopf/g)?.length).toBe(1);
    expect(tagSeite.html).toContain('kal-zeit--tag');
    const alt = await seite(KalenderSeite, `/kalender?von=${tag}`, anna);
    expect(alt.html).toContain('kal-zeit--woche');
    expect(alt.html).toMatch(/<a [^>]*href="\/kalender\?ansicht=woche&amp;datum=[^"]+"[^>]*aria-current="page"/);
  });
});

describe('Liste und Navigation', () => {
  it('Liste zeigt Tage mit Eintraegen, Uhrzeit und .ics', async () => {
    const { html } = await seite(KalenderSeite, `/kalender?ansicht=liste&datum=${tag}`, anna);
    expect(html).toContain('09:30 bis 11:00 Uhr');
    expect(html).toContain(`/kalender/eintrag/termin/${zeit.id}.ics`);
    expect(html).not.toContain('Fremder Betrieb');
  });

  it('hat Vor, Zurueck, Heute und die vier Ansichten als Links', async () => {
    const { html } = await seite(KalenderSeite, `/kalender?ansicht=woche&datum=${tag}`, anna);
    expect(html).toContain(`href="/kalender?ansicht=woche&amp;datum=${plusTage(tag, -7)}" rel="prev"`);
    expect(html).toContain(`href="/kalender?ansicht=woche&amp;datum=${plusTage(tag, 7)}" rel="next"`);
    expect(html).toContain(`href="/kalender?ansicht=woche&amp;datum=${heute}"`);
    for (const a of ['monat', 'woche', 'tag', 'liste']) expect(html).toContain(`href="/kalender?ansicht=${a}&amp;datum=${tag}"`);
  });
});

describe('Termin anlegen', () => {
  it('belegt Datum und Uhrzeit vor und bietet nur eigene Betriebe an', async () => {
    const { html } = await seite(NeuSeite, `/kalender/neu?datum=${tag}&beginn=14:00`, anna);
    expect(html).toContain(`value="${tag}"`);
    expect(html).toContain('value="14:00"');
    expect(html).toContain('Bäckerei Zeit');
    expect(html).not.toContain('Fremder Betrieb');
    expect(html).toContain(`/kunden/neu?terminDatum=${tag}&amp;terminBeginn=14%3A00&amp;status=termin`);
  });

  it('speichert den Termin und fuehrt in die Woche zurueck', async () => {
    const neu = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Neu Angerufen', status: 'angerufen' }).wert);
    const r = await seite(NeuSeite, '/kalender/neu', anna, { kundeId: neu.id, terminDatum: tag, terminBeginn: '14:00', terminDauer: '30', status: '' });
    expect(r.status).toBe(303);
    expect(r.ort).toBe(`/kalender?ansicht=woche&datum=${tag}&ok=termin`);
    const k = await holeKunde(db, anna.id, neu.id);
    expect([k?.status, k?.terminDatum, k?.terminBeginn, k?.terminDauer]).toEqual(['termin', tag, '14:00', 30]);
  });

  it('aendert keinen fremden Betrieb', async () => {
    const r = await seite(NeuSeite, '/kalender/neu', anna, { kundeId: fremd.id, terminDatum: plusTage(tag, 1), status: 'termin' });
    expect(r.status).toBe(200);
    expect(r.html).toContain('Bitte einen Betrieb auswählen.');
    expect((await holeKunde(db, bert.id, fremd.id))?.terminDatum).toBe(tag);
  });

  it('neuer Betrieb aus dem Kalender: vorbelegt, danach zurueck in den Kalender', async () => {
    const vor = await seite(KundeNeuSeite, `/kunden/neu?terminDatum=${tag}&terminBeginn=08:15&status=termin`, anna);
    expect(vor.html).toContain(`value="${tag}"`);
    expect(vor.html).toContain('value="08:15"');
    expect(vor.html).toContain(`name="zurueck" value="/kalender?ansicht=woche&amp;datum=${tag}"`);
    const r = await seite(KundeNeuSeite, '/kunden/neu', anna, {
      name: 'Aus dem Kalender',
      status: 'termin',
      terminDatum: tag,
      terminBeginn: '08:15',
      terminDauer: '60',
      zurueck: `/kalender?ansicht=woche&datum=${tag}`,
    });
    expect(r.status).toBe(303);
    expect(r.ort).toBe(`/kalender?ansicht=woche&datum=${tag}&ok=termin`);
    // Fremde Ziele werden ignoriert.
    const boese = await seite(KundeNeuSeite, '/kunden/neu', anna, { name: 'Boese', status: 'angerufen', zurueck: 'https://example.com/' });
    expect(boese.ort).toBe('/kunden?ok=neu');
  });
});
