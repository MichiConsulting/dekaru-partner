// Kleiner SMTP-Versand ohne Fremdpaket, nur node:net und node:tls.
//
// Warum kein nodemailer: das Paket ist im Portal nicht installiert. Der
// Formulardienst (dekaru-formular) nutzt es mit denselben Regeln, die hier
// nachgebaut sind:
//   - Port 465 (secure): TLS von Anfang an.
//   - sonst STARTTLS ist Pflicht (requireTLS). Bietet der Server es nicht an,
//     geht nichts raus. Nach dem Wechsel kommt ein zweites EHLO.
//   - Anmeldung immer (forceAuth), auch wenn der Server AUTH nicht ankuendigt.
//     Ein Relay, das per IP durchlaesst, wuerde sonst ohne Anmeldung senden,
//     und Vercel hat keine festen IPs.
//   - Zertifikat wird immer geprueft, servername ist gesetzt.
// Wer spaeter doch nodemailer will, ersetzt nur smtpVersender(); der Rest
// spricht gegen die Schnittstelle Versender.

import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

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
 */
export function smtpAusUmgebung(env: Record<string, string | undefined> = process.env): SmtpEinstellungen | null {
  if (PFLICHT.some((n) => !env[n])) return null;
  const port = Number(env.PORTAL_SMTP_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return {
    host: String(env.PORTAL_SMTP_HOST),
    port,
    secure: env.PORTAL_SMTP_SECURE === 'true',
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

/** RFC 2047, damit Umlaute im Betreff ankommen. */
function kodiereKopf(text: string): string {
  const t = einzeilig(text);
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(t)) return t;
  return `=?UTF-8?B?${Buffer.from(t, 'utf8').toString('base64')}?=`;
}

function base64Zeilen(text: string): string {
  const b = Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64');
  return (b.match(/.{1,76}/g) ?? ['']).join('\r\n');
}

/** Baut die komplette Mail als Text, CRLF, Inhalt base64. */
export function baueMail(from: string, nachricht: Nachricht, jetzt = new Date()): string {
  const domain = nurAdresse(from).split('@')[1] || 'localhost';
  const kopf = [
    `From: ${einzeilig(from)}`,
    `To: ${nurAdresse(nachricht.to)}`,
    `Subject: ${kodiereKopf(nachricht.subject)}`,
    `Date: ${jetzt.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    'Auto-Submitted: auto-generated',
  ];
  return `${kopf.join('\r\n')}\r\n\r\n${base64Zeilen(nachricht.text)}\r\n`;
}

interface Antwort {
  code: number;
  zeilen: string[];
}

/** Liest SMTP-Antworten zeilenweise, auch mehrzeilige ("250-..."). */
class Leser {
  private puffer = '';
  private warten: ((a: Antwort) => void) | null = null;
  private fehler: ((e: Error) => void) | null = null;
  private gesammelt: string[] = [];
  private fertige: Antwort[] = [];
  private kaputt: Error | null = null;

  constructor(private socket: net.Socket | tls.TLSSocket) {
    this.anhaengen(socket);
  }

  anhaengen(socket: net.Socket | tls.TLSSocket) {
    this.socket = socket;
    socket.on('data', (d: Buffer) => this.daten(d.toString('utf8')));
    socket.on('error', (e: Error) => this.abbruch(e));
    socket.on('close', () => this.abbruch(new Error('SMTP-Verbindung unerwartet geschlossen.')));
  }

  private abbruch(e: Error) {
    if (this.kaputt) return;
    this.kaputt = e;
    const f = this.fehler;
    this.warten = null;
    this.fehler = null;
    f?.(e);
  }

  private daten(text: string) {
    this.puffer += text;
    let i: number;
    while ((i = this.puffer.indexOf('\n')) >= 0) {
      const zeile = this.puffer.slice(0, i).replace(/\r$/, '');
      this.puffer = this.puffer.slice(i + 1);
      this.gesammelt.push(zeile);
      if (/^\d{3}(\s|$)/.test(zeile)) {
        const antwort = { code: Number(zeile.slice(0, 3)), zeilen: this.gesammelt };
        this.gesammelt = [];
        if (this.warten) {
          const w = this.warten;
          this.warten = null;
          this.fehler = null;
          w(antwort);
        } else {
          this.fertige.push(antwort);
        }
      }
    }
  }

  naechste(): Promise<Antwort> {
    const vorhanden = this.fertige.shift();
    if (vorhanden) return Promise.resolve(vorhanden);
    if (this.kaputt) return Promise.reject(this.kaputt);
    return new Promise((resolve, reject) => {
      this.warten = resolve;
      this.fehler = reject;
    });
  }

  /** Nach STARTTLS: alter Socket ist abgeloest, sein close darf nicht mehr abbrechen. */
  loesen(socket: net.Socket) {
    socket.removeAllListeners('data');
    socket.removeAllListeners('error');
    socket.removeAllListeners('close');
    // Fehler des rohen Sockets meldet ab jetzt der TLS-Socket. Ohne Zuhoerer
    // wuerde ein 'error' hier den ganzen Prozess beenden.
    socket.on('error', () => {});
  }
}

export interface SmtpOptionen {
  /** Nur fuer Tests: eigene Zertifizierungsstelle. Pruefung bleibt an. */
  ca?: string | Buffer;
  timeoutMs?: number;
}

function warteAufVerbindung(socket: net.Socket | tls.TLSSocket, ereignis: 'connect' | 'secureConnect'): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once(ereignis, () => resolve());
    socket.once('error', reject);
  });
}

/** Ein Versand, eine Verbindung. Wirft bei jedem Fehler. */
export async function sendeSmtp(e: SmtpEinstellungen, nachricht: Nachricht, optionen: SmtpOptionen = {}): Promise<void> {
  const timeout = optionen.timeoutMs ?? 10000;
  const ehloName = nurAdresse(e.from).split('@')[1] || 'localhost';
  let socket: net.Socket | tls.TLSSocket = e.secure
    ? tls.connect({ host: e.host, port: e.port, servername: e.host, ca: optionen.ca })
    : net.connect({ host: e.host, port: e.port });
  socket.setTimeout(timeout, () => socket.destroy(new Error('SMTP-Zeitueberschreitung.')));
  try {
    await warteAufVerbindung(socket, e.secure ? 'secureConnect' : 'connect');
    const leser = new Leser(socket);

    const befehl = async (zeile: string | null, erwartet: number[], was: string): Promise<Antwort> => {
      if (zeile !== null) socket.write(`${zeile}\r\n`);
      const a = await leser.naechste();
      if (!erwartet.includes(a.code)) throw new Error(`SMTP ${was} abgelehnt (${a.code}).`);
      return a;
    };

    await befehl(null, [220], 'Begruessung');
    let ehlo = await befehl(`EHLO ${ehloName}`, [250], 'EHLO');

    if (!e.secure) {
      const kannTls = ehlo.zeilen.some((z) => /^250[ -]STARTTLS\b/i.test(z));
      if (!kannTls) throw new Error('Der SMTP-Server bietet kein STARTTLS an. Unverschluesselt wird nicht gesendet.');
      await befehl('STARTTLS', [220], 'STARTTLS');
      const roh = socket as net.Socket;
      leser.loesen(roh);
      const sicher = tls.connect({ socket: roh, servername: e.host, ca: optionen.ca });
      sicher.setTimeout(timeout, () => sicher.destroy(new Error('SMTP-Zeitueberschreitung.')));
      await warteAufVerbindung(sicher, 'secureConnect');
      socket = sicher;
      leser.anhaengen(sicher);
      ehlo = await befehl(`EHLO ${ehloName}`, [250], 'EHLO nach STARTTLS');
    }

    // Immer anmelden, auch ohne AUTH in der EHLO-Antwort (forceAuth).
    const plain = Buffer.from(`\u0000${e.user}\u0000${e.pass}`, 'utf8').toString('base64');
    await befehl(`AUTH PLAIN ${plain}`, [235], 'Anmeldung');

    await befehl(`MAIL FROM:<${nurAdresse(e.from)}>`, [250], 'MAIL FROM');
    await befehl(`RCPT TO:<${nurAdresse(nachricht.to)}>`, [250, 251], 'RCPT TO');
    await befehl('DATA', [354], 'DATA');
    const inhalt = baueMail(e.from, nachricht)
      .split('\r\n')
      .map((z) => (z.startsWith('.') ? `.${z}` : z))
      .join('\r\n');
    await befehl(`${inhalt}\r\n.`, [250], 'Zustellung');
    // Zugestellt ist ab hier. Ein Fehler beim Verabschieden aendert daran nichts.
    await befehl('QUIT', [221], 'QUIT').catch(() => undefined);
  } finally {
    socket.end();
    socket.destroy();
  }
}

export function smtpVersender(e: SmtpEinstellungen, optionen: SmtpOptionen = {}): Versender {
  return { senden: (n) => sendeSmtp(e, n, optionen) };
}
