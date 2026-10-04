// Alle schreibenden Admin-Aktionen an einer Stelle. Jede Funktion erledigt
// die Aktion und schreibt danach den Eintrag ins Protokoll. Admin-Seiten und
// Skripte rufen nur diese Funktionen auf, nie die Bausteine darunter direkt;
// tests/admin-protokoll.test.ts prueft das fuer src/pages/admin.
//
// Protokolliert wird nach dem Erfolg. Schlaegt die Aktion fehl, entsteht kein
// Eintrag, der etwas behauptet, das nicht passiert ist.

import type { Db } from './db.ts';
import { erstelleBenutzer, holeBenutzer, setzeAktiv, setzePasswort, beendeAlleSitzungen, type Benutzer, type Rolle } from './auth.ts';
import { erzeugeEinmalPasswort } from './passwort.ts';
import { importiereAbrechnung, markiereAusgezahlt, type Abrechnung } from './provision.ts';
import { istUuid } from './kunden.ts';
import { protokolliere, type Akteur } from './admin-protokoll.ts';
import { importiereUndBenachrichtige, protokolliereProvisionsImport, type ImportErgebnis } from './provision-import.ts';
import type { Versender } from './smtp.ts';

export function akteurAus(benutzer: Pick<Benutzer, 'id' | 'name'>): Akteur {
  return { id: benutzer.id, name: benutzer.name };
}

export class AdminFehler extends Error {}

async function zielBenutzer(db: Db, id: string): Promise<Benutzer> {
  const b = istUuid(id) ? await holeBenutzer(db, id) : null;
  if (!b) throw new AdminFehler('Diesen Zugang gibt es nicht.');
  return b;
}

// ---------------------------------------------------------------------------
// Zugaenge

export async function zugangAnlegen(
  db: Db,
  akteur: Akteur,
  daten: { name: string; email: string; slug?: string | null; rolle: Rolle },
): Promise<{ benutzer: Benutzer; passwort: string }> {
  const passwort = erzeugeEinmalPasswort();
  let benutzer: Benutzer;
  try {
    benutzer = await erstelleBenutzer(db, {
      name: daten.name,
      email: daten.email,
      rolle: daten.rolle,
      vertrieblerSlug: daten.slug || null,
      passwort,
      wechselNoetig: true,
    });
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    throw new AdminFehler(/unique|duplicate|doppelt/i.test(text) ? 'E-Mail-Adresse oder Slug sind schon vergeben.' : text);
  }
  await protokolliere(db, akteur, {
    aktion: 'zugang_angelegt',
    zielTyp: 'benutzer',
    zielId: benutzer.id,
    zielText: benutzer.name,
    details: { rolle: benutzer.rolle, slug: benutzer.vertrieblerSlug ?? '' },
  });
  return { benutzer, passwort };
}

export async function zugangDeaktivieren(db: Db, akteur: Akteur, id: string): Promise<void> {
  const b = await zielBenutzer(db, id);
  if (akteur.id && b.id === akteur.id) throw new AdminFehler('Den eigenen Zugang können Sie nicht deaktivieren.');
  await setzeAktiv(db, b.id, false);
  await protokolliere(db, akteur, { aktion: 'zugang_deaktiviert', zielTyp: 'benutzer', zielId: b.id, zielText: b.name });
}

export async function zugangAktivieren(db: Db, akteur: Akteur, id: string): Promise<void> {
  const b = await zielBenutzer(db, id);
  await setzeAktiv(db, b.id, true);
  await protokolliere(db, akteur, { aktion: 'zugang_aktiviert', zielTyp: 'benutzer', zielId: b.id, zielText: b.name });
}

/** Neues Einmal-Passwort, beendet alle Sitzungen. Das Passwort geht nur an den Aufrufer, nie ins Protokoll. */
export async function einmalPasswortNeu(db: Db, akteur: Akteur, id: string): Promise<string> {
  const b = await zielBenutzer(db, id);
  const passwort = erzeugeEinmalPasswort();
  await setzePasswort(db, b.id, passwort, true);
  await beendeAlleSitzungen(db, b.id);
  await protokolliere(db, akteur, { aktion: 'einmal_passwort_neu', zielTyp: 'benutzer', zielId: b.id, zielText: b.name });
  return passwort;
}

export async function slugAendern(db: Db, akteur: Akteur, id: string, slugEingabe: string): Promise<void> {
  const b = await zielBenutzer(db, id);
  const slug = String(slugEingabe ?? '').trim();
  if (slug && !/^[a-z0-9-]+$/.test(slug)) throw new AdminFehler('Der Slug darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.');
  const alt = b.vertrieblerSlug ?? '';
  if (alt === slug) return;
  try {
    await db.query('UPDATE benutzer SET vertriebler_slug = $2 WHERE id = $1', [b.id, slug || null]);
  } catch {
    throw new AdminFehler('Dieser Slug ist schon vergeben.');
  }
  await protokolliere(db, akteur, {
    aktion: 'slug_geaendert',
    zielTyp: 'benutzer',
    zielId: b.id,
    zielText: b.name,
    details: { alt, neu: slug },
  });
}

// ---------------------------------------------------------------------------
// Provision

export async function provisionImportieren(
  db: Db,
  akteur: Akteur,
  abrechnung: Abrechnung,
  datei?: string,
): Promise<{ id: string; ersetzt: boolean }> {
  const e = await importiereAbrechnung(db, abrechnung, akteur.id);
  await protokolliere(db, akteur, {
    aktion: 'provision_importiert',
    zielTyp: 'abrechnung',
    zielId: e.id,
    zielText: `${abrechnung.vertriebler} ${abrechnung.monat}`,
    details: { ersetzt: e.ersetzt, summeCent: abrechnung.summeCent, auszahlungCent: abrechnung.auszahlungCent, ...(datei ? { datei } : {}) },
  });
  return e;
}

/**
 * Upload im Admin: derselbe Weg wie der Import per Token. Neu oder ersetzt
 * wird abgelegt und der Vertriebler benachrichtigt; unveraendert holt nur eine
 * gescheiterte Mail nach. Beides landet im Protokoll.
 */
export async function provisionImportierenMitMail(
  db: Db,
  akteur: Akteur,
  abrechnung: Abrechnung,
  optionen: { versender: Versender | null; portalUrl: string; datei?: string },
): Promise<ImportErgebnis> {
  const e = await importiereUndBenachrichtige(db, abrechnung, {
    importiertVon: akteur.id,
    versender: optionen.versender,
    portalUrl: optionen.portalUrl,
  });
  await protokolliereProvisionsImport(db, akteur, abrechnung, e, optionen.datei);
  return e;
}

/** Datum JJJJ-MM-TT setzt "ausgezahlt", null setzt zurueck. */
export async function auszahlungMarkieren(db: Db, akteur: Akteur, id: string, datum: string | null): Promise<void> {
  if (!istUuid(id)) throw new AdminFehler('Diese Abrechnung gibt es nicht.');
  if (datum !== null && !/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw new AdminFehler('Datum fehlt oder ist ungültig.');
  const zeilen = await db.query<{ vertriebler_slug: string; monat: string }>(
    'SELECT vertriebler_slug, monat FROM provision_abrechnungen WHERE id = $1',
    [id],
  );
  if (!zeilen[0]) throw new AdminFehler('Diese Abrechnung gibt es nicht.');
  await markiereAusgezahlt(db, id, datum);
  await protokolliere(db, akteur, {
    aktion: datum ? 'provision_ausgezahlt' : 'provision_auszahlung_zurueck',
    zielTyp: 'abrechnung',
    zielId: id,
    zielText: `${zeilen[0].vertriebler_slug} ${zeilen[0].monat}`,
    details: datum ? { datum } : {},
  });
}

// ---------------------------------------------------------------------------
// Dubletten

export type DublettenEntscheidung = 'freigeben' | 'zuordnen' | 'ablehnen';

/**
 * Entscheidet eine offene Dublettenmeldung.
 * freigeben: der Anfragende darf den Betrieb zusaetzlich eintragen.
 * zuordnen: der Anfragende bekommt den Betrieb, die bestehenden Eintraege
 *   der anderen Vertriebler werden geloescht. Es wandern keine Daten (Notiz,
 *   Ansprechpartner) von einem Vertriebler zum anderen.
 * ablehnen: der Betrieb bleibt beim Bisherigen.
 */
export async function dubletteEntscheiden(db: Db, akteur: Akteur, meldungId: string, entscheidung: DublettenEntscheidung): Promise<void> {
  if (!istUuid(meldungId)) throw new AdminFehler('Diese Meldung gibt es nicht.');
  const zeilen = await db.query<{ id: string; benutzer_id: string; name: string; treffer: string[]; status: string }>(
    'SELECT id, benutzer_id, name, treffer, status FROM dubletten_meldungen WHERE id = $1',
    [meldungId],
  );
  const m = zeilen[0];
  if (!m) throw new AdminFehler('Diese Meldung gibt es nicht.');
  if (m.status !== 'offen') throw new AdminFehler('Diese Meldung ist schon entschieden.');
  const status = entscheidung === 'freigeben' ? 'freigegeben' : entscheidung === 'zuordnen' ? 'zugeordnet' : 'abgelehnt';

  let geloescht = 0;
  if (entscheidung === 'zuordnen') {
    const weg = await db.query<{ id: string }>(
      'DELETE FROM kunden WHERE id = ANY($1::uuid[]) AND benutzer_id <> $2 RETURNING id',
      [m.treffer, m.benutzer_id],
    );
    geloescht = weg.length;
  }
  await db.query(
    "UPDATE dubletten_meldungen SET status = $2, entschieden_am = now(), entschieden_von = $3 WHERE id = $1 AND status = 'offen'",
    [m.id, status, akteur.id],
  );
  const anfragender = await holeBenutzer(db, m.benutzer_id);
  await protokolliere(db, akteur, {
    aktion: entscheidung === 'freigeben' ? 'dublette_freigegeben' : entscheidung === 'zuordnen' ? 'dublette_zugeordnet' : 'dublette_abgelehnt',
    zielTyp: 'dublette',
    zielId: m.id,
    zielText: `${m.name} (Anfrage ${anfragender?.name ?? 'unbekannt'})`,
    details: entscheidung === 'zuordnen' ? { geloeschteEintraege: geloescht } : {},
  });
}

/** Der Admin speichert einen eigenen Kunden trotz Treffer. */
export async function protokolliereAdminDublette(
  db: Db,
  akteur: Akteur,
  kunde: { id: string; name: string },
  trefferIds: string[],
): Promise<void> {
  await protokolliere(db, akteur, {
    aktion: 'dublette_admin_gespeichert',
    zielTyp: 'kunde',
    zielId: kunde.id,
    zielText: kunde.name,
    details: { treffer: trefferIds.length },
  });
}
