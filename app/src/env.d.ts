import type { Db } from './lib/db.ts';
import type { Benutzer } from './lib/auth.ts';

declare global {
  namespace App {
    interface Locals {
      db: Db;
      benutzer: Benutzer | null;
      csrf: string | null;
      sitzungId: string | null;
    }
  }
}

export {};
