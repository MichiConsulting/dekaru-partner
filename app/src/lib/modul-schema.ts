// Welche Software-Module ein Mini-Schema haben (components/ModulSchema.astro).
// tests/modul-schema.test.ts verlangt eins fuer jedes verkaufbare Modul.
// Schluessel ohne "modul-", wie in der Adresse.
export const MINI_SCHEMATA = ['kostenrechner', 'anfrage-fotos', 'lagerliste', 'bewertungs-assistent', 'beitrags-schreiber', 'speisekarte', 'angebots-assistent'] as const;

export function hatMiniSchema(kurz: string): boolean {
  return (MINI_SCHEMATA as readonly string[]).includes(kurz);
}
