// Passwoerter mit scrypt aus node:crypto. Keine Abhaengigkeit, kein Klartext.
//
// Format des gespeicherten Werts:
//   scrypt$N$r$p$<salt base64url>$<hash base64url>
// Die Parameter stehen im Wert, damit sie spaeter erhoeht werden koennen,
// ohne alte Hashes ungueltig zu machen.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

function scrypt(passwort: string, salt: Buffer, laenge: number, optionen: ScryptOptions): Promise<Buffer> {
  return new Promise((erfuellen, ablehnen) => {
    scryptCallback(passwort, salt, laenge, optionen, (fehler, schluessel) => {
      if (fehler) ablehnen(fehler);
      else erfuellen(schluessel);
    });
  });
}

const N = 32768; // 2^15, Speicherbedarf 128 * N * r = 32 MiB
const R = 8;
const P = 1;
const LAENGE = 64;
const MAXMEM = 128 * N * R * 2;

export const MINDESTLAENGE = 10;

export async function hashPasswort(passwort: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(passwort.normalize('NFKC'), salt, LAENGE, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function pruefePasswort(passwort: string, gespeichert: string): Promise<boolean> {
  const teile = String(gespeichert ?? '').split('$');
  if (teile.length !== 6 || teile[0] !== 'scrypt') return false;
  const n = Number(teile[1]);
  const r = Number(teile[2]);
  const p = Number(teile[3]);
  const salt = Buffer.from(teile[4], 'base64url');
  const erwartet = Buffer.from(teile[5], 'base64url');
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || erwartet.length === 0) return false;
  const hash = await scrypt(passwort.normalize('NFKC'), salt, erwartet.length, {
    N: n,
    r,
    p,
    maxmem: 128 * n * r * 2,
  });
  return hash.length === erwartet.length && timingSafeEqual(hash, erwartet);
}

/** Prueft ein neues Passwort. Gibt eine Fehlermeldung zurueck oder null. */
export function pruefeNeuesPasswort(passwort: string): string | null {
  if (typeof passwort !== 'string' || passwort.length < MINDESTLAENGE) {
    return `Das Passwort braucht mindestens ${MINDESTLAENGE} Zeichen.`;
  }
  if (passwort.length > 200) return 'Das Passwort ist zu lang.';
  if (/^(.)\1+$/.test(passwort)) return 'Das Passwort darf nicht aus einem einzigen Zeichen bestehen.';
  return null;
}

// Ohne 0, O, 1, l, I, damit sich das Passwort am Telefon durchsagen laesst.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Einmal-Passwort fuer die Einladung, drei Bloecke zu vier Zeichen. */
export function erzeugeEinmalPasswort(): string {
  const bytes = randomBytes(12);
  const zeichen = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return `${zeichen.slice(0, 4).join('')}-${zeichen.slice(4, 8).join('')}-${zeichen.slice(8, 12).join('')}`;
}
