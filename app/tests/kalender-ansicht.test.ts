// Kalender-Ansichten: URL, Zeitraeume, Raster und Lage der Termine.
import { describe, expect, it } from 'vitest';
import {
  bereichFuer,
  eintragBeschreibung,
  jetztLage,
  kalenderUrl,
  legeTagAus,
  leseAnsicht,
  monatsRaster,
  neuUrl,
  schritt,
  schrittText,
  sichtbareBalken,
  stundenBereich,
  titelFuer,
} from '../src/lib/kalender-ansicht.ts';
import { datumLang, kalenderwoche, minutenBerlin, monatsTitel } from '../src/lib/datum.ts';

const HEUTE = '2026-10-05';
const p = (q: string) => new URLSearchParams(q);

describe('Ansicht und Datum aus der URL', () => {
  it('liest ansicht und datum, Standard ist der Monat mit heute', () => {
    expect(leseAnsicht(p(''), HEUTE)).toEqual({ ansicht: 'monat', datum: HEUTE });
    expect(leseAnsicht(p('ansicht=woche&datum=2026-11-12'), HEUTE)).toEqual({ ansicht: 'woche', datum: '2026-11-12' });
    expect(leseAnsicht(p('ansicht=tag&datum=2026-11-12'), HEUTE)).toEqual({ ansicht: 'tag', datum: '2026-11-12' });
    expect(leseAnsicht(p('ansicht=liste'), HEUTE)).toEqual({ ansicht: 'liste', datum: HEUTE });
  });

  it('faellt bei Unsinn auf sichere Werte zurueck', () => {
    expect(leseAnsicht(p('ansicht=jahr&datum=2026-02-30'), HEUTE)).toEqual({ ansicht: 'monat', datum: HEUTE });
    expect(leseAnsicht(p('ansicht=<script>&datum=2026-10-07'), HEUTE)).toEqual({ ansicht: 'monat', datum: '2026-10-07' });
    expect(leseAnsicht(p('datum=gestern'), HEUTE)).toEqual({ ansicht: 'monat', datum: HEUTE });
  });

  it('versteht die alten Links ?von= und ?monat=', () => {
    expect(leseAnsicht(p('von=2026-10-12'), HEUTE)).toEqual({ ansicht: 'woche', datum: '2026-10-12' });
    expect(leseAnsicht(p('ansicht=monat&monat=2026-12'), HEUTE)).toEqual({ ansicht: 'monat', datum: '2026-12-01' });
    expect(leseAnsicht(p('ansicht=monat&monat=2026-10'), HEUTE)).toEqual({ ansicht: 'monat', datum: HEUTE });
    expect(leseAnsicht(p('ansicht=monat&monat=2026-13'), HEUTE)).toEqual({ ansicht: 'monat', datum: HEUTE });
  });

  it('baut Links', () => {
    expect(kalenderUrl('woche', '2026-10-05')).toBe('/kalender?ansicht=woche&datum=2026-10-05');
    expect(kalenderUrl('monat', '2026-10-05', 'kal-tagesliste')).toBe('/kalender?ansicht=monat&datum=2026-10-05#kal-tagesliste');
    expect(neuUrl('2026-10-05')).toBe('/kalender/neu?datum=2026-10-05');
    expect(neuUrl('2026-10-05', '09:00')).toBe('/kalender/neu?datum=2026-10-05&beginn=09%3A00');
  });
});

describe('Zeitraeume und Schritte', () => {
  it('laedt fuer den Monat das ganze Raster von Montag bis Sonntag', () => {
    // Oktober 2026 beginnt an einem Donnerstag und endet an einem Samstag.
    expect(bereichFuer('monat', '2026-10-17')).toEqual({ von: '2026-09-28', bis: '2026-11-01' });
    expect(bereichFuer('woche', '2026-10-07')).toEqual({ von: '2026-10-05', bis: '2026-10-11' });
    expect(bereichFuer('tag', '2026-10-07')).toEqual({ von: '2026-10-07', bis: '2026-10-07' });
    expect(bereichFuer('liste', '2026-10-07')).toEqual({ von: '2026-10-01', bis: '2026-10-31' });
  });

  it('baut das Monatsraster in ganzen Wochen', () => {
    const raster = monatsRaster('2026-10-05');
    expect(raster.length).toBe(5);
    expect(raster[0][0]).toBe('2026-09-28');
    expect(raster[4][6]).toBe('2026-11-01');
    expect(raster.every((w) => w.length === 7)).toBe(true);
    // Februar 2027 beginnt an einem Montag: vier Wochen reichen.
    expect(monatsRaster('2027-02-10').length).toBe(4);
    // Maerz 2026 beginnt an einem Sonntag: sechs Wochen.
    expect(monatsRaster('2026-03-01').length).toBe(6);
  });

  it('springt vor und zurueck und kappt am Monatsende', () => {
    expect(schritt('monat', '2026-10-31', 1)).toBe('2026-11-30');
    expect(schritt('monat', '2026-03-31', -1)).toBe('2026-02-28');
    expect(schritt('monat', '2026-12-15', 1)).toBe('2027-01-15');
    expect(schritt('liste', '2026-01-15', -1)).toBe('2025-12-15');
    expect(schritt('woche', '2026-10-05', 1)).toBe('2026-10-12');
    expect(schritt('woche', '2026-10-05', -1)).toBe('2026-09-28');
    expect(schritt('tag', '2026-10-31', 1)).toBe('2026-11-01');
    expect(schrittText('woche', -1)).toBe('Vorige Woche');
    expect(schrittText('tag', 1)).toBe('Nächster Tag');
    expect(schrittText('monat', -1)).toBe('Voriger Monat');
  });

  it('schreibt Titel wie ein Kalender', () => {
    expect(titelFuer('monat', '2026-10-05')).toBe('Oktober 2026');
    expect(titelFuer('tag', '2026-10-05')).toBe('Montag, 5. Oktober 2026');
    expect(titelFuer('woche', '2026-10-07')).toBe('KW 41, 5. bis 11. Oktober 2026');
    expect(titelFuer('woche', '2026-09-30')).toBe('KW 40, 28. September bis 4. Oktober 2026');
    expect(titelFuer('woche', '2026-12-30')).toBe('KW 53, 28. Dezember 2026 bis 3. Januar 2027');
    expect(kalenderwoche('2027-01-04')).toBe(1);
    expect(kalenderwoche('2026-01-01')).toBe(1);
    expect(datumLang('2026-03-09', false)).toBe('9. März');
    expect(monatsTitel('2026-03')).toBe('März 2026');
  });

  it('zeigt hoechstens drei Balken, sonst zwei und "+n weitere"', () => {
    expect(sichtbareBalken([1, 2, 3])).toEqual({ zeigen: [1, 2, 3], weitere: 0 });
    expect(sichtbareBalken([1, 2, 3, 4, 5])).toEqual({ zeigen: [1, 2], weitere: 3 });
  });
});

describe('Stundenraster', () => {
  const t = (beginn: string | null, dauerMinuten: number | null = 60, name = beginn ?? '') => ({ beginn, dauerMinuten, name });

  it('zeigt 7 bis 20 Uhr und erweitert fuer fruehe und spaete Termine', () => {
    expect(stundenBereich([])).toEqual({ von: 7, bis: 20 });
    expect(stundenBereich([t(null), t('09:00')])).toEqual({ von: 7, bis: 20 });
    expect(stundenBereich([t('06:30'), t('19:30', 90)])).toEqual({ von: 6, bis: 21 });
    expect(stundenBereich([t('23:00', 180)])).toEqual({ von: 7, bis: 24 });
  });

  it('legt Termine nach Uhrzeit und Dauer ins Raster', () => {
    const [a] = legeTagAus([t('08:00', 60)], { von: 7, bis: 20 });
    expect(a.oben).toBeCloseTo((60 / 780) * 100);
    expect(a.hoehe).toBeCloseTo((60 / 780) * 100);
    expect(a).toMatchObject({ spur: 0, spuren: 1, ende: '09:00' });
    // Ganztaegige gehoeren nicht ins Raster.
    expect(legeTagAus([t(null)], { von: 7, bis: 20 })).toEqual([]);
  });

  it('stellt ueberlappende Termine nebeneinander, getrennte bleiben breit', () => {
    const liste = legeTagAus(
      [t('09:00', 60, 'A'), t('09:30', 60, 'B'), t('10:00', 30, 'C'), t('12:00', 60, 'D'), t('12:00', 30, 'E')],
      { von: 7, bis: 20 },
    );
    const nach = Object.fromEntries(liste.map((x) => [x.eintrag.name, x]));
    expect([nach.A.spur, nach.B.spur, nach.C.spur]).toEqual([0, 1, 0]);
    expect([nach.A.spuren, nach.B.spuren, nach.C.spuren]).toEqual([2, 2, 2]);
    expect([nach.D.spur, nach.E.spur, nach.D.spuren, nach.E.spuren]).toEqual([0, 1, 2, 2]);
  });

  it('gibt kurzen Terminen eine lesbare Hoehe und kappt um Mitternacht', () => {
    const [kurz, nachfolger] = legeTagAus([t('09:00', 5, 'kurz'), t('09:10', 30, 'danach')], { von: 7, bis: 20 });
    expect(kurz.hoehe).toBeCloseTo((20 / 780) * 100);
    // Der sichtbare Block reicht bis 9:20, der naechste steht daneben.
    expect(nachfolger.spur).toBe(1);
    const [spaet] = legeTagAus([t('23:00', 180)], { von: 7, bis: 24 });
    expect(spaet.ende).toBe('24:00');
    expect(spaet.oben + spaet.hoehe).toBeCloseTo(100);
  });

  it('setzt die Linie jetzt nur innerhalb des Rasters', () => {
    expect(jetztLage(7 * 60, { von: 7, bis: 20 })).toBe(0);
    expect(jetztLage(13 * 60 + 30, { von: 7, bis: 20 })).toBeCloseTo(50);
    expect(jetztLage(6 * 60, { von: 7, bis: 20 })).toBeNull();
    expect(jetztLage(21 * 60, { von: 7, bis: 20 })).toBeNull();
  });

  it('rechnet die Uhrzeit in Europe/Berlin, nicht in der Serverzeit', () => {
    // 05.10.2026 22:30 UTC ist in Berlin (Sommerzeit) 00:30.
    expect(minutenBerlin(new Date('2026-10-05T22:30:00Z'))).toBe(30);
    // Im Winter eine Stunde Abstand.
    expect(minutenBerlin(new Date('2026-12-01T12:15:00Z'))).toBe(13 * 60 + 15);
  });

  it('beschreibt Eintraege fuer Screenreader', () => {
    expect(eintragBeschreibung({ typ: 'termin', beginn: '14:30', dauerMinuten: 90, kundeName: 'Bäckerei' }, 'Termin vereinbart')).toBe(
      'Termin, 14:30 bis 16:00 Uhr: Bäckerei, Termin vereinbart',
    );
    expect(eintragBeschreibung({ typ: 'wiedervorlage', beginn: null, dauerMinuten: null, kundeName: 'X' }, 'Angebot')).toBe(
      'Wiedervorlage, ganztägig: X, Angebot',
    );
  });
});
