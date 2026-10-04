// SMTP-Versand ueber nodemailer gegen einen lokalen Fake-Server. STARTTLS mit
// einem selbstsignierten Zertifikat, das openssl beim Testlauf erzeugt; der
// Client bekommt es als ca, die Pruefung des Zertifikats bleibt an. Der Aufbau
// der Mail wird zusaetzlich mit dem Stream-Transport von nodemailer geprueft.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { mailDaten, sendeSmtp, smtpAusUmgebung, fehlendeSmtpVariablen, transportOptionen, type SmtpEinstellungen } from '../src/lib/smtp.ts';

interface Protokoll {
  befehle: string[];
  daten: string;
  tlsAktiv: boolean;
}

/** Minimaler SMTP-Server: 220, EHLO, optional STARTTLS, AUTH, MAIL, RCPT, DATA. */
function fakeServer(opt: { starttls: boolean; key?: string; cert?: string; authAnkuendigen?: boolean }) {
  const protokolle: Protokoll[] = [];
  const server = net.createServer((roh) => {
    const p: Protokoll = { befehle: [], daten: '', tlsAktiv: false };
    protokolle.push(p);
    let sock: net.Socket = roh;
    let puffer = '';
    let inData = false;
    const schreibe = (z: string) => sock.write(`${z}\r\n`);
    const zeile = (z: string) => {
      if (inData) {
        if (z === '.') {
          inData = false;
          schreibe('250 OK queued');
        } else p.daten += `${z}\n`;
        return;
      }
      p.befehle.push(z.startsWith('AUTH PLAIN') ? 'AUTH PLAIN ***' : z);
      const cmd = z.split(' ')[0].toUpperCase();
      if (cmd === 'EHLO') {
        const zeilen = ['250-fake.test'];
        if (opt.starttls && !p.tlsAktiv) zeilen.push('250-STARTTLS');
        if (opt.authAnkuendigen !== false) zeilen.push('250-AUTH PLAIN LOGIN');
        zeilen.push('250 8BITMIME');
        sock.write(zeilen.join('\r\n') + '\r\n');
      } else if (cmd === 'STARTTLS' && !opt.starttls) {
        schreibe('502 STARTTLS nicht verfuegbar');
      } else if (cmd === 'STARTTLS') {
        schreibe('220 Go ahead');
        sock.removeAllListeners('data');
        const sicher = new tls.TLSSocket(roh, { isServer: true, key: opt.key, cert: opt.cert });
        sicher.on('data', daten);
        sicher.on('error', () => {});
        sock = sicher;
        p.tlsAktiv = true;
      } else if (cmd === 'AUTH') {
        const dekodiert = Buffer.from(z.split(' ')[2] ?? '', 'base64').toString('utf8');
        schreibe(dekodiert === '\u0000relay@dekaru.de\u0000geheim' ? '235 OK' : '535 nein');
      } else if (cmd === 'MAIL' || cmd === 'RCPT') schreibe('250 OK');
      else if (cmd === 'DATA') {
        inData = true;
        schreibe('354 weiter');
      } else if (cmd === 'QUIT') {
        schreibe('221 Tschuess');
        sock.end();
      } else schreibe('500 unbekannt');
    };
    function daten(d: Buffer) {
      puffer += d.toString('utf8');
      let i: number;
      while ((i = puffer.indexOf('\r\n')) >= 0) {
        const z = puffer.slice(0, i);
        puffer = puffer.slice(i + 2);
        zeile(z);
      }
    }
    roh.on('data', daten);
    roh.on('error', () => {});
    schreibe('220 fake.test ESMTP');
  });
  return new Promise<{ port: number; protokolle: Protokoll[]; schliessen: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, protokolle, schliessen: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

const BASIS: Omit<SmtpEinstellungen, 'port'> = {
  host: 'localhost',
  secure: false,
  user: 'relay@dekaru.de',
  pass: 'geheim',
  from: 'dekaru Partner-Portal <partner@dekaru.de>',
};
const NACHRICHT = { to: 'Anna <anna@example.test>', subject: 'Ihre Provisionsabrechnung für März 2027 ist im Portal', text: 'Guten Tag,\n.Punkt am Anfang\nEnde' };

let ordner = '';
let key = '';
let cert = '';
let opensslDa = true;

beforeAll(() => {
  ordner = mkdtempSync(join(tmpdir(), 'smtp-test-'));
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost',
      '-keyout', join(ordner, 'key.pem'), '-out', join(ordner, 'cert.pem'),
    ], { stdio: 'ignore' });
    key = readFileSync(join(ordner, 'key.pem'), 'utf8');
    cert = readFileSync(join(ordner, 'cert.pem'), 'utf8');
  } catch {
    opensslDa = false;
  }
});
afterAll(() => rmSync(ordner, { recursive: true, force: true }));

describe('SMTP', () => {
  it('sendet nichts ohne STARTTLS (requireTLS)', async () => {
    const s = await fakeServer({ starttls: false });
    await expect(sendeSmtp({ ...BASIS, port: s.port }, NACHRICHT, { timeoutMs: 3000 })).rejects.toThrow();
    const befehle = s.protokolle[0].befehle;
    expect(s.protokolle[0].tlsAktiv).toBe(false);
    expect(befehle.some((b) => b.startsWith('AUTH'))).toBe(false);
    expect(befehle.some((b) => b.startsWith('MAIL'))).toBe(false);
    await s.schliessen();
  });

  it('STARTTLS, zweites EHLO, Anmeldung auch ohne AUTH-Ankuendigung, Zustellung', async (ctx) => {
    if (!opensslDa) ctx.skip();
    const s = await fakeServer({ starttls: true, key, cert, authAnkuendigen: false });
    await sendeSmtp({ ...BASIS, port: s.port }, NACHRICHT, { ca: cert, timeoutMs: 5000 });
    const p = s.protokolle[0];
    expect(p.befehle).toEqual([
      'EHLO dekaru.de',
      'STARTTLS',
      'EHLO dekaru.de',
      'AUTH PLAIN ***',
      'MAIL FROM:<partner@dekaru.de>',
      'RCPT TO:<anna@example.test>',
      'DATA',
    ]);
    expect(p.tlsAktiv).toBe(true);
    expect(p.daten).toMatch(/^Subject: =\?UTF-8\?[BQ]\?/m);
    expect(p.daten).toContain('To: anna@example.test');
    // Punkt am Zeilenanfang wird beim Senden verdoppelt (RFC 5321, Abschnitt 4.5.2).
    expect(p.daten).toContain('\n..Punkt am Anfang');
    expect(p.daten).toMatch(/^Content-Type: text\/plain; charset=utf-8$/m);
    await s.schliessen();
  });

  it('lehnt ein Zertifikat ab, dem nicht vertraut wird', async (ctx) => {
    if (!opensslDa) ctx.skip();
    const s = await fakeServer({ starttls: true, key, cert });
    await expect(sendeSmtp({ ...BASIS, port: s.port }, NACHRICHT, { timeoutMs: 3000 })).rejects.toThrow();
    expect(s.protokolle[0].befehle).not.toContain('AUTH PLAIN ***');
    await s.schliessen();
  });

  it('meldet falsche Zugangsdaten', async (ctx) => {
    if (!opensslDa) ctx.skip();
    const s = await fakeServer({ starttls: true, key, cert });
    await expect(sendeSmtp({ ...BASIS, pass: 'falsch', port: s.port }, NACHRICHT, { ca: cert, timeoutMs: 3000 })).rejects.toThrow(/Invalid login|535/);
    expect(s.protokolle[0].befehle.some((b) => b.startsWith('MAIL'))).toBe(false);
    await s.schliessen();
  });
});

describe('Mail und Einstellungen', () => {
  it('kodiert den Betreff, entfernt Zeilenumbrueche aus Kopfzeilen (Stream-Transport)', async () => {
    const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    // Eine untergeschobene Kopfzeile in der Adresse wird abgelehnt, nicht umgedeutet.
    expect(() => mailDaten('partner@dekaru.de', { to: 'a@b.de\r\nBcc: x@y.de', subject: 'x', text: 'x' })).toThrow(/Empfängeradresse/);
    const info = await t.sendMail(mailDaten('dekaru Partner-Portal <partner@dekaru.de>', {
      to: 'Anna <a@b.de>',
      subject: 'Abrechnung für März\r\nBcc: x@y.de',
      text: 'Guten Tag,\n.Punkt am Anfang',
    }));
    const roh = (info.message as Buffer).toString('utf8');
    const kopf = roh.split('\n\n')[0];
    expect(kopf).not.toMatch(/^Bcc:/m);
    expect(kopf).toMatch(/^Subject: =\?UTF-8\?[BQ]\?/m);
    expect(kopf).toMatch(/^Auto-Submitted: auto-generated$/m);
    expect(kopf).toMatch(/^Content-Type: text\/plain; charset=utf-8$/m);
    expect(info.envelope).toEqual({ from: 'partner@dekaru.de', to: ['a@b.de'] });
  });

  it('Transport: secure bei 465, sonst requireTLS, immer Anmeldung und Zertifikatspruefung', () => {
    const basis = { ...BASIS, port: 587 };
    const t587 = transportOptionen(basis);
    expect(t587).toMatchObject({ secure: false, requireTLS: true, ignoreTLS: false, forceAuth: true });
    expect(t587.auth).toMatchObject({ user: 'relay@dekaru.de', pass: 'geheim' });
    expect(t587.tls).toMatchObject({ rejectUnauthorized: true, servername: 'localhost' });
    expect(transportOptionen({ ...basis, port: 465 })).toMatchObject({ secure: true, forceAuth: true });
    // Auch ein anderer Port als 587 bekommt keinen Klartext.
    expect(transportOptionen({ ...basis, port: 25 })).toMatchObject({ secure: false, requireTLS: true });
    expect(smtpAusUmgebung({
      PORTAL_SMTP_HOST: 'h', PORTAL_SMTP_PORT: '465', PORTAL_SMTP_SECURE: 'false', PORTAL_SMTP_USER: 'u', PORTAL_SMTP_PASS: 'p', PORTAL_SMTP_FROM: 'f',
    })?.secure).toBe(true);
  });

  it('liest nur PORTAL_SMTP_*, ohne Werte kein Versand', () => {
    expect(smtpAusUmgebung({})).toBeNull();
    expect(fehlendeSmtpVariablen({ PORTAL_SMTP_HOST: 'h' })).toEqual(['PORTAL_SMTP_PORT', 'PORTAL_SMTP_USER', 'PORTAL_SMTP_PASS', 'PORTAL_SMTP_FROM']);
    const e = smtpAusUmgebung({
      PORTAL_SMTP_HOST: 'smtp-relay.gmail.com', PORTAL_SMTP_PORT: '587', PORTAL_SMTP_SECURE: 'false',
      PORTAL_SMTP_USER: 'u@dekaru.de', PORTAL_SMTP_PASS: 'p', PORTAL_SMTP_FROM: 'partner@dekaru.de',
    });
    expect(e).toMatchObject({ port: 587, secure: false });
    expect(smtpAusUmgebung({ PORTAL_SMTP_HOST: 'h', PORTAL_SMTP_PORT: 'x', PORTAL_SMTP_USER: 'u', PORTAL_SMTP_PASS: 'p', PORTAL_SMTP_FROM: 'f' })).toBeNull();
  });
});
