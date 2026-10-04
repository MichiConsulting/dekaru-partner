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
 * Jeder Client kann "x-forwarded-for" selbst mitschicken, die alte Fassung
 * dieser Funktion nahm davon ungeprueft den ersten Eintrag. Ob Vercel einen
 * vom Client vorgegebenen Wert ueberschreibt oder nur ergaenzt, ist hier
 * nicht gegen die echte Plattform verifiziert (das haette einen Test gegen
 * partner.dekaru.de gebraucht, der bewusst unterblieben ist). Verlaesslich
 * ist dagegen: @astrojs/vercel vertraut in seiner eigenen Edge-Middleware
 * fuer denselben Zweck "x-real-ip" und nicht "x-forwarded-for" (Quelle:
 * node_modules/@astrojs/vercel/dist/serverless/middleware.js). Dieser
 * Funktion folgt hier.
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
