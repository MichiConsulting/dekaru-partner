// Preisrechner: dieselben Summen wie der Rechner auf dekaru.de und dieselben
// Provisionsbetraege wie Kapitel 08 (inhalt/08-provision.md).
import { describe, expect, it } from 'vitest';
import {
  ALLE_POSTEN,
  PAKETE,
  PREIS_AB,
  auswahlAusFeldern,
  berechne,
  euro,
  findePaket,
  leereAuswahl,
  paketInhalte,
  provisionAuf,
} from '../src/lib/preise.ts';

/**
 * Die Rechnung des Website-Skripts (Preisrechner.astro, Funktion rechnen),
 * hier unabhaengig nachgebaut: Paketpreis plus Bausteine, anzahl mal Preis,
 * schalter nur wenn nicht enthalten, anfrage zaehlt null.
 */
function websiteSumme(paket: string, auswahl: Record<string, number | boolean>): number {
  const p = PAKETE.find((x) => x.schluessel === paket)!;
  return ALLE_POSTEN.reduce((summe, posten) => {
    const w = auswahl[posten.schluessel];
    if (posten.art === 'anzahl') return summe + posten.preis * Number(w ?? 0);
    if (posten.art === 'anfrage') return summe;
    if (p.enthalten[posten.schluessel]) return summe;
    return summe + (w ? posten.preis : 0);
  }, p.preis);
}

describe('Preisrechner', () => {
  it('kennt die drei Pakete und den Einstiegspreis', () => {
    expect(PAKETE.map((p) => [p.name, p.preis])).toEqual([
      ['Klein', 600],
      ['Mittel', 1300],
      ['Groß', 1600],
    ]);
    expect(PREIS_AB).toBe(600);
    expect(findePaket('Groß')?.schluessel).toBe('gross');
  });

  it('rechnet Stichproben wie die Website', () => {
    const proben: { paket: 'klein' | 'mittel' | 'gross'; bausteine: Record<string, number | boolean> }[] = [
      { paket: 'klein', bausteine: {} },
      { paket: 'klein', bausteine: { galerie: true, unterseite: 3, seo: true } },
      { paket: 'mittel', bausteine: { unterseite: 2, texte: 1, newsletter: true, individuell: true } },
      { paket: 'gross', bausteine: { logo: true } },
      { paket: 'gross', bausteine: { sprache: 2, blog: true, statistik: true, unterseite: 15 } },
    ];
    for (const probe of proben) {
      const e = berechne({ ...leereAuswahl(probe.paket), bausteine: probe.bausteine });
      expect(e.summeWebsite, JSON.stringify(probe)).toBe(websiteSumme(probe.paket, probe.bausteine));
    }
    // Zahlen aus Blatt 14 bzw. Kapitel 02: Klein mit Galerie, drei Unterseiten und SEO.
    expect(berechne({ ...leereAuswahl('klein'), bausteine: { galerie: true, unterseite: 3, seo: true } }).summeWebsite).toBe(600 + 100 + 225 + 200);
  });

  it('zaehlt enthaltene Bausteine nicht und begrenzt Anzahlen', () => {
    // Galerie und SEO sind in Mittel enthalten, zaehlen also nicht.
    const e = berechne({ ...leereAuswahl('mittel'), bausteine: { galerie: true, seo: true, team: true } });
    expect(e.summeWebsite).toBe(1300 + 100);
    expect(e.zeilen.map((z) => z.schluessel)).toEqual(['mittel', 'team']);
    // Unterseiten hoechstens 15 weitere.
    expect(berechne({ ...leereAuswahl('klein'), bausteine: { unterseite: 99 } }).summeWebsite).toBe(600 + 15 * 75);
    // Ein individuelles Feature steht in der Aufstellung, zaehlt aber null.
    const f = berechne({ ...leereAuswahl('klein'), bausteine: { individuell: true } });
    expect(f.summeWebsite).toBe(600);
    expect(f.nachAbsprache).toBe(1);
    expect(f.zeilen.find((z) => z.schluessel === 'individuell')?.betrag).toBeNull();
  });

  it('Provision wie in Kapitel 08', () => {
    expect(berechne(leereAuswahl('klein')).provisionEinmalig).toBe(210);
    expect(berechne(leereAuswahl('mittel')).provisionEinmalig).toBe(455);
    expect(berechne(leereAuswahl('gross')).provisionEinmalig).toBe(560);
    expect(berechne({ ...leereAuswahl('gross'), bausteine: { logo: true } }).provisionEinmalig).toBe(647.5);
    const mitZusatz = berechne({ ...leereAuswahl('gross'), zusatzleistungen: ['gbp-einrichtung', 'bewertungs-funnel'] });
    expect(mitZusatz.summeEinmalig).toBe(2039);
    expect(mitZusatz.provisionEinmalig).toBe(713.65);
    expect(provisionAuf(1300)).toBe(455);
  });

  it('Hosting-Provision auf zwoelf bezahlte Monate wie in Kapitel 08', () => {
    const start = berechne({ ...leereAuswahl('klein'), hosting: { tarif: 'start', zahlweise: 'monatlich', gratisquartal: false } }).hosting!;
    expect(start.jeZahlung).toBe(19);
    expect(start.provision).toBe(79.8);
    const startJahr = berechne({ ...leereAuswahl('klein'), hosting: { tarif: 'start', zahlweise: 'jaehrlich', gratisquartal: false } }).hosting!;
    expect(startJahr.jeZahlung).toBe(190);
    expect(startJahr.provision).toBe(66.5);
    const basis = berechne({ ...leereAuswahl('klein'), hosting: { tarif: 'basis', zahlweise: 'monatlich', gratisquartal: true } }).hosting!;
    expect(basis.provision).toBe(163.8);
    expect(basis.hinweise.some((h) => /Gratisquartal/.test(h))).toBe(true);
    // Plus gibt es nur jaehrlich, monatlich wird stillschweigend korrigiert und gemeldet.
    const plus = berechne({ ...leereAuswahl('gross'), hosting: { tarif: 'plus', zahlweise: 'monatlich', gratisquartal: false } }).hosting!;
    expect(plus.zahlweise).toBe('jaehrlich');
    expect(plus.jeZahlung).toBe(590);
    expect(plus.jeMonat).toBe(59);
    expect(plus.provision).toBe(206.5);
    expect(plus.hinweise[0]).toMatch(/Jahresvertrag/);
    // Ohne Hosting kein Ergebnis.
    expect(berechne(leereAuswahl('gross')).hosting).toBeNull();
  });

  it('liest die Auswahl aus Formularfeldern und ignoriert Unsinn', () => {
    const params = new URLSearchParams(
      'paket=mittel&b_unterseite=2&b_texte=abc&b_team=on&b_unbekannt=on&z_gbp-komplett=on&z_x=on&hosting=basis&zahlweise=jaehrlich&gratisquartal=on',
    );
    const a = auswahlAusFeldern(params);
    expect(a.paket).toBe('mittel');
    expect(a.bausteine).toEqual({ unterseite: 2, team: true });
    expect(a.zusatzleistungen).toEqual(['gbp-komplett']);
    expect(a.hosting).toEqual({ tarif: 'basis', zahlweise: 'jaehrlich', gratisquartal: true });
    expect(auswahlAusFeldern({ paket: 'nix', hosting: 'keins' }).paket).toBe('gross');
    expect(auswahlAusFeldern({ paket: 'klein', b_unterseite: '-4' }).bausteine).toEqual({});
  });

  it('formatiert Euro wie die Website', () => {
    expect(euro(1600)).toBe('1.600 €');
    expect(euro(647.5)).toBe('647,50 €');
    expect(paketInhalte(findePaket('mittel')!)).toEqual([
      'Startseite und 4 Unterseiten',
      'Bildergalerie',
      'Leistungs- oder Speisekarte',
      'Referenzen und Bewertungen',
      'Texte von mir, 2 Seiten',
      'Suchmaschinen-Grundlagen',
    ]);
  });
});
