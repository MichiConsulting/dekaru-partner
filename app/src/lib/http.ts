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

export function clientIp(astro: Pick<AstroGlobal, 'request' | 'clientAddress'>): string {
  const weitergeleitet = astro.request.headers.get('x-forwarded-for');
  if (weitergeleitet) return weitergeleitet.split(',')[0].trim().slice(0, 64);
  try {
    return astro.clientAddress;
  } catch {
    return 'unbekannt';
  }
}

export function istPost(request: Request): boolean {
  return request.method === 'POST';
}
