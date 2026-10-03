// Kleine Helfer fuer Seiten: Formulardaten lesen, IP-Adresse bestimmen.

import type { AstroGlobal } from 'astro';

export type Formular = Record<string, string>;

/** Alle Textfelder eines Formulars als einfaches Objekt. Dateien bleiben aussen vor. */
export async function formular(request: Request): Promise<Formular> {
  const daten: Formular = {};
  try {
    const form = await request.formData();
    for (const [name, wert] of form.entries()) {
      if (typeof wert === 'string') daten[name] = wert;
    }
  } catch {
    // Kein Formular, dann bleibt das Objekt leer.
  }
  return daten;
}

/**
 * Ermittelt die Adresse fuer Ratenbegrenzung und Protokoll.
 *
 * Hinter dem Vercel-Proxy ist "x-forwarded-for" kein verlaesslicher Wert:
 * Vercel haengt die echte Adresse nur an einen vorhandenen Header an, ersetzt
 * ihn aber nicht. Schickt der Client selbst "x-forwarded-for" mit, steht sein
 * frei gewaehlter Wert vorne, und genau den lieferte die alte Fassung dieser
 * Funktion zurueck. Eine Sperre nach fuenf Fehlversuchen liesse sich damit
 * aushebeln, indem jede Anfrage eine andere erfundene Adresse vorgibt.
 * "x-real-ip" setzt Vercel dagegen immer selbst auf die tatsaechliche
 * Verbindung, ein Client kann ihn nicht ueberschreiben.
 */
export function clientIp(astro: Pick<AstroGlobal, 'request' | 'clientAddress'>): string {
  if (process.env.VERCEL) {
    const echt = astro.request.headers.get('x-real-ip');
    if (echt) return echt.trim().slice(0, 64);
  }
  try {
    return astro.clientAddress;
  } catch {
    return 'unbekannt';
  }
}

export function istPost(request: Request): boolean {
  return request.method === 'POST';
}
