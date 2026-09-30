// Gemeinsame Helfer: eine frische PGlite-Datenbank im Speicher je Testdatei.
import { pgliteDb, type Db } from '../src/lib/db.ts';
import { erstelleBenutzer, type Benutzer } from '../src/lib/auth.ts';

export async function neueDb(): Promise<Db> {
  return pgliteDb();
}

export async function vertriebler(db: Db, name: string, slug?: string): Promise<Benutzer> {
  return erstelleBenutzer(db, {
    email: `${name.toLowerCase()}@example.test`,
    name,
    rolle: 'vertriebler',
    passwort: 'geheim-passwort-1',
    vertrieblerSlug: slug ?? null,
  });
}
