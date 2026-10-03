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

import { erfuellteRegeln, MINDESTLAENGE, PASSWORT_REGELN } from './passwort-regeln.ts';

export { erfuellteRegeln, MINDESTLAENGE, PASSWORT_REGELN };

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

// Teile, die in keinem Passwort vorkommen duerfen. Kleingeschrieben verglichen.
const VERBOTENE_TEILE = [
  'passwort', 'password', 'kennwort', 'dekaru', 'qwertz', 'qwerty', 'asdf', 'yxcv',
  'hallo', 'admin', 'login', 'willkommen', 'welcome', 'geheim', 'sommer', 'winter',
];

const REIHEN = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertzuiopü', 'asdfghjklöä', 'yxcvbnm'];

/** Vier oder mehr Zeichen in Folge, vorwaerts oder rueckwaerts, z.B. 1234, dcba, qwer. */
function hatFolge(kleingeschrieben: string): boolean {
  for (const reihe of REIHEN) {
    const beide = [reihe, [...reihe].reverse().join('')];
    for (const r of beide) {
      for (let i = 0; i + 4 <= r.length; i++) {
        if (kleingeschrieben.includes(r.slice(i, i + 4))) return true;
      }
    }
  }
  return false;
}

/**
 * Prueft ein neues Passwort. Gibt eine Fehlermeldung zurueck oder null.
 * Mit `person` werden E-Mail-Name und Namensteile gesperrt.
 */
export function pruefeNeuesPasswort(
  passwort: string,
  person: { email?: string; name?: string } = {},
): string | null {
  if (typeof passwort !== 'string' || passwort.length === 0) return 'Bitte ein Passwort eingeben.';
  if (passwort.length > 200) return 'Das Passwort ist zu lang.';

  const regeln = erfuellteRegeln(passwort);
  const fehlend = PASSWORT_REGELN.filter((r) => !regeln[r.schluessel]).map((r) => r.text);
  if (fehlend.length > 0) return `Dem Passwort fehlt noch: ${fehlend.join(', ')}.`;

  const klein = passwort.toLowerCase();
  if (/(.)\1{3,}/u.test(passwort)) return 'Das Passwort darf kein Zeichen viermal hintereinander enthalten.';
  if (hatFolge(klein)) return 'Das Passwort darf keine Folge wie 1234, abcd oder qwer enthalten.';
  if (VERBOTENE_TEILE.some((teil) => klein.includes(teil))) {
    return 'Das Passwort enthält ein zu häufiges Wort wie "Passwort", "Hallo" oder "dekaru".';
  }

  const eigene = [
    ...String(person.email ?? '').toLowerCase().split('@')[0].split(/[^\p{L}\p{Nd}]+/u),
    ...String(person.name ?? '').toLowerCase().split(/[^\p{L}\p{Nd}]+/u),
  ].filter((teil) => teil.length >= 4);
  if (eigene.some((teil) => klein.includes(teil))) {
    return 'Das Passwort darf nicht Ihren Namen oder Ihre E-Mail-Adresse enthalten.';
  }
  return null;
}

// Ohne 0, O, 1, l, I, damit sich das Passwort am Telefon durchsagen laesst.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
// 256 ist kein Vielfaches von ALPHABET.length (54): ohne diese Grenze waeren
// die ersten 40 Zeichen des Alphabets geringfuegig wahrscheinlicher als die
// uebrigen. Bytes ab der Grenze werden verworfen (Rejection-Sampling).
const BYTE_GRENZE = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

/** Einmal-Passwort fuer die Einladung, drei Bloecke zu vier Zeichen. */
export function erzeugeEinmalPasswort(): string {
  const zeichen: string[] = [];
  while (zeichen.length < 12) {
    for (const b of randomBytes(16)) {
      if (zeichen.length >= 12) break;
      if (b < BYTE_GRENZE) zeichen.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return `${zeichen.slice(0, 4).join('')}-${zeichen.slice(4, 8).join('')}-${zeichen.slice(8, 12).join('')}`;
}
