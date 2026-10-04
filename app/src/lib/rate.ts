// Allgemeine Ratenbegrenzung auf der Tabelle login_versuche, mit frei
// waehlbaren Grenzen. Dieselbe Idee wie registriereVersuch in auth.ts: der
// Versuch wird in einem einzigen Upsert gezaehlt und bewertet, damit viele
// gleichzeitige Anfragen die Sperre nicht unterlaufen. Die Schluessel tragen
// ein Praefix (zum Beispiel "ics:"), damit sie den Login nicht beruehren.
// Aufgeraeumt wird mit den Login-Zeilen (raeumeAbgelaufenesAuf in auth.ts).

import type { Db } from './db.ts';

export interface Grenzen {
  /** So viele Versuche im Fenster sind erlaubt, der naechste sperrt. */
  max: number;
  fensterMinuten: number;
  sperreMinuten: number;
}

export interface Begrenzung {
  gesperrt: boolean;
  wartenSekunden: number;
}

export async function begrenze(db: Db, schluessel: string, grenzen: Grenzen, jetzt = new Date()): Promise<Begrenzung> {
  const fensterCutoff = new Date(jetzt.getTime() - grenzen.fensterMinuten * 60 * 1000);
  const sperreBis = new Date(jetzt.getTime() + grenzen.sperreMinuten * 60 * 1000);
  const zeilen = await db.query<{ gesperrt_bis: Date | string | null }>(
    `INSERT INTO login_versuche (schluessel, fehlversuche, fenster_start, gesperrt_bis)
     VALUES ($1, 1, $2, NULL)
     ON CONFLICT (schluessel) DO UPDATE SET
       fehlversuche = CASE
         WHEN login_versuche.gesperrt_bis IS NOT NULL AND login_versuche.gesperrt_bis > $2 THEN login_versuche.fehlversuche
         WHEN login_versuche.fenster_start < $3 THEN 1
         ELSE login_versuche.fehlversuche + 1
       END,
       fenster_start = CASE
         WHEN login_versuche.gesperrt_bis IS NOT NULL AND login_versuche.gesperrt_bis > $2 THEN login_versuche.fenster_start
         WHEN login_versuche.fenster_start < $3 THEN $2
         ELSE login_versuche.fenster_start
       END,
       gesperrt_bis = CASE
         WHEN login_versuche.gesperrt_bis IS NOT NULL AND login_versuche.gesperrt_bis > $2 THEN login_versuche.gesperrt_bis
         WHEN (CASE WHEN login_versuche.fenster_start < $3 THEN 1 ELSE login_versuche.fehlversuche + 1 END) > $4 THEN $5
         ELSE NULL
       END
     RETURNING gesperrt_bis`,
    [schluessel, jetzt, fensterCutoff, grenzen.max, sperreBis],
  );
  const bis = zeilen[0]?.gesperrt_bis ? new Date(zeilen[0].gesperrt_bis) : null;
  if (bis && bis.getTime() > jetzt.getTime()) {
    return { gesperrt: true, wartenSekunden: Math.ceil((bis.getTime() - jetzt.getTime()) / 1000) };
  }
  return { gesperrt: false, wartenSekunden: 0 };
}
