// Mailversand ueber nodemailer, mit denselben Regeln wie der Formulardienst
// (dekaru-formular):
//   - Port 465: TLS von Anfang an (secure).
//   - jeder andere Port: STARTTLS ist Pflicht (requireTLS). Bietet der Server
//     es nicht an, geht nichts raus. Das gilt bewusst nicht nur fuer 587,
//     sonst liesse ein Eintrag wie 25 oder 2525 Klartext zu.
//   - Anmeldung immer (forceAuth), auch wenn der Server AUTH nicht ankuendigt.
//     Ein Relay, das per IP durchlaesst, wuerde sonst ohne Anmeldung senden,
//     und Vercel hat keine festen IPs. Scheitert die Anmeldung, scheitert der
//     Versand; es gibt keinen Rueckfall auf "ohne Anmeldung".
//   - Zertifikat wird immer geprueft, servername ist gesetzt, ignoreTLS nie.
//   - Feste Zeitlimits, damit ein haengendes Relay nicht die Laufzeit der
//     Vercel-Funktion aufbraucht.
// Der Rest des Portals spricht nur gegen die Schnittstelle Versender.

import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

export interface SmtpEinstellungen {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface Nachricht {
  to: string;
  subject: string;
  text: string;
}

export interface Versender {
  senden(nachricht: Nachricht): Promise<void>;
}

const PFLICHT = ['PORTAL_SMTP_HOST', 'PORTAL_SMTP_PORT', 'PORTAL_SMTP_USER', 'PORTAL_SMTP_PASS', 'PORTAL_SMTP_FROM'] as const;

/**
 * Liest die SMTP-Einstellungen aus der Umgebung, zur Laufzeit. Fehlt etwas,
 * kommt null: dann wird nicht versendet und der Admin sieht einen Hinweis.
 * Port 465 ist immer secure, egal was PORTAL_SMTP_SECURE sagt.
 */
export function smtpAusUmgebung(env: Record<string, string | undefined> = process.env): SmtpEinstellungen | null {
  if (PFLICHT.some((n) => !env[n])) return null;
  const port = Number(env.PORTAL_SMTP_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return {
    host: String(env.PORTAL_SMTP_HOST),
    port,
    secure: port === 465 || env.PORTAL_SMTP_SECURE === 'true',
    user: String(env.PORTAL_SMTP_USER),
    pass: String(env.PORTAL_SMTP_PASS),
    from: String(env.PORTAL_SMTP_FROM),
  };
}

/** Welche Variablen fehlen, nur die Namen, fuer den Hinweis im Admin. */
export function fehlendeSmtpVariablen(env: Record<string, string | undefined> = process.env): string[] {
  return PFLICHT.filter((n) => !env[n]);
}

function einzeilig(s: string): string {
  return String(s).replace(/[\r\n]+/g, ' ').trim();
}

/** Nur die Adresse aus "Name <adresse>" oder die Adresse selbst. */
export function nurAdresse(wert: string): string {
  const t = /<([^<>\s]+@[^<>\s]+)>/.exec(wert);
  return einzeilig(t ? t[1] : wert);
}

/** Genau eine nackte Adresse, sonst Fehler. nodemailer liest sonst aus "a@b.de Bcc: x@y.de" eine andere Adresse heraus. */
function eineAdresse(wert: string): string {
  const a = nurAdresse(wert);
  if (!/^[^\s@<>",;:]+@[^\s@<>",;:]+\.[^\s@<>",;:]+$/.test(a)) throw new Error('Ungültige Empfängeradresse.');
  return a;
}

export interface SmtpOptionen {
  /** Nur fuer Tests: eigene Zertifizierungsstelle. Pruefung bleibt an. */
  ca?: string | Buffer;
  timeoutMs?: number;
}

/** Die Transport-Optionen fuer nodemailer. Eigene Funktion, damit Tests die Regeln direkt pruefen. */
export function transportOptionen(e: SmtpEinstellungen, optionen: SmtpOptionen = {}): SMTPTransport.Options {
  const timeout = optionen.timeoutMs ?? 10000;
  const secure = e.secure || e.port === 465;
  return {
    host: e.host,
    port: e.port,
    secure,
    requireTLS: !secure,
    ignoreTLS: false,
    forceAuth: true,
    auth: { type: 'login', user: e.user, pass: e.pass },
    name: nurAdresse(e.from).split('@')[1] || 'localhost',
    tls: {
      rejectUnauthorized: true,
      servername: e.host,
      minVersion: 'TLSv1.2',
      ...(optionen.ca ? { ca: optionen.ca } : {}),
    },
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

/** Die Mail fuer nodemailer: nur Text, Kopfzeilen einzeilig, Umschlag nur mit nackten Adressen. */
export function mailDaten(from: string, nachricht: Nachricht) {
  const to = eineAdresse(nachricht.to);
  return {
    from: einzeilig(from),
    to,
    subject: einzeilig(nachricht.subject),
    text: nachricht.text,
    headers: { 'Auto-Submitted': 'auto-generated' },
    envelope: { from: eineAdresse(from), to },
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

/** Ein Versand, eine Verbindung. Wirft bei jedem Fehler. */
export async function sendeSmtp(e: SmtpEinstellungen, nachricht: Nachricht, optionen: SmtpOptionen = {}): Promise<void> {
  const transport = nodemailer.createTransport(transportOptionen(e, optionen));
  try {
    await transport.sendMail(mailDaten(e.from, nachricht));
  } finally {
    transport.close();
  }
}

export function smtpVersender(e: SmtpEinstellungen, optionen: SmtpOptionen = {}): Versender {
  return { senden: (n) => sendeSmtp(e, n, optionen) };
}
