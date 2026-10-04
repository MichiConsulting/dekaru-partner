-- dekaru Partner-Portal, Schema Version 7: Admin-Ausbau.
-- Protokoll der Admin-Aktionen, Statusverlauf der Kunden fuer die
-- Monatszahlen, Dublettenmeldungen. Wiederholbar wie die vorigen Versionen.
-- Haengt nur von 001 ab, nicht von 005, 006 oder 008.
--
-- Anwenden mit: cd app && export DATABASE_URL='...' && npm run db:migrate && unset DATABASE_URL

-- ---------------------------------------------------------------------------
-- 1. Protokoll der Admin-Aktionen
--
-- Jede schreibende Admin-Aktion landet hier (src/lib/admin-protokoll.ts,
-- protokolliere()). Keine Passwoerter, keine Tokens. Bewusst ohne
-- Fremdschluessel: ein spaeter geloeschter Benutzer darf weder Zeilen
-- mitnehmen noch per SET NULL veraendern. Wer und Ziel stehen zusaetzlich
-- als Text, damit ein Eintrag auch spaeter lesbar bleibt.
--
-- Aufbewahrung 24 Monate. Aendern laesst sich keine Zeile, loeschen nur
-- Zeilen, die aelter als 24 Monate sind (Trigger unten). Das Aufraeumen ist
-- ein Handgriff von Michi, siehe README.

CREATE TABLE IF NOT EXISTS admin_protokoll (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  zeitpunkt timestamptz NOT NULL DEFAULT now(),
  -- NULL bei Skripten (provision-import, admin-anlegen)
  admin_id uuid,
  admin_name text NOT NULL,
  aktion text NOT NULL,
  ziel_typ text NOT NULL DEFAULT '',
  ziel_id text,
  ziel_text text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS admin_protokoll_zeitpunkt ON admin_protokoll(zeitpunkt DESC);
CREATE INDEX IF NOT EXISTS admin_protokoll_aktion ON admin_protokoll(aktion);

CREATE OR REPLACE FUNCTION admin_protokoll_schutz() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.zeitpunkt < now() - interval '24 months' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'admin_protokoll ist unveraenderlich (%)', TG_OP;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION admin_protokoll_kein_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_protokoll ist unveraenderlich (TRUNCATE)';
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_protokoll_schutz ON admin_protokoll;
CREATE TRIGGER admin_protokoll_schutz
  BEFORE UPDATE OR DELETE ON admin_protokoll
  FOR EACH ROW EXECUTE FUNCTION admin_protokoll_schutz();

DROP TRIGGER IF EXISTS admin_protokoll_kein_truncate ON admin_protokoll;
CREATE TRIGGER admin_protokoll_kein_truncate
  BEFORE TRUNCATE ON admin_protokoll
  FOR EACH STATEMENT EXECUTE FUNCTION admin_protokoll_kein_truncate();

-- ---------------------------------------------------------------------------
-- 2. Statusverlauf der Kunden
--
-- kunden kennt nur den aktuellen Status. Fuer "Ersttermine, Zweittermine,
-- Abschluesse, Absagen im Monat" braucht die Admin-Uebersicht jeden Wechsel.
-- Ein Trigger schreibt ihn mit, der Code in kunden.ts bleibt unberuehrt.
-- Datensparsam: nur Kunde, Vertriebler, Status, Tag. Kein Name, keine Notiz.
-- Wird ein Kunde geloescht, bleibt der Wechsel als anonyme Zaehlung stehen.

CREATE TABLE IF NOT EXISTS kunden_statuswechsel (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kunde_id uuid REFERENCES kunden(id) ON DELETE SET NULL,
  benutzer_id uuid NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  status text NOT NULL,
  am date NOT NULL
);
CREATE INDEX IF NOT EXISTS kunden_statuswechsel_benutzer_am ON kunden_statuswechsel(benutzer_id, am);

CREATE OR REPLACE FUNCTION kunden_statuswechsel_merken() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO kunden_statuswechsel (kunde_id, benutzer_id, status, am)
    VALUES (NEW.id, NEW.benutzer_id, NEW.status, NEW.status_seit);
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kunden_statuswechsel_merken ON kunden;
CREATE TRIGGER kunden_statuswechsel_merken
  AFTER INSERT OR UPDATE OF status ON kunden
  FOR EACH ROW EXECUTE FUNCTION kunden_statuswechsel_merken();

-- Bestand nachziehen: je Kunde der aktuelle Status zum Tag status_seit.
-- Fruehere Wechsel kennt die Datenbank nicht, die Zahlen vor Version 7 sind
-- deshalb nur so genau wie der heutige Stand.
INSERT INTO kunden_statuswechsel (kunde_id, benutzer_id, status, am)
SELECT k.id, k.benutzer_id, k.status, k.status_seit
FROM kunden k
WHERE NOT EXISTS (SELECT 1 FROM kunden_statuswechsel w WHERE w.kunde_id = k.id);

-- ---------------------------------------------------------------------------
-- 3. Dublettenmeldungen
--
-- Will ein Vertriebler einen Betrieb speichern, den schon jemand anderes
-- betreut, wird das Speichern blockiert und hier eine Meldung abgelegt. Der
-- Admin entscheidet: freigeben, dem Anfragenden zuordnen oder beim
-- Bisherigen belassen. Gespeichert werden nur Name, Ort und Telefon des
-- Versuchs, keine Notiz und kein Ansprechpartner.

CREATE TABLE IF NOT EXISTS dubletten_meldungen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gemeldet_am timestamptz NOT NULL DEFAULT now(),
  benutzer_id uuid NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  -- eigener Eintrag des Anfragenden, wenn er einen bestehenden geaendert hat
  eigener_kunde_id uuid REFERENCES kunden(id) ON DELETE SET NULL,
  name text NOT NULL,
  ort text NOT NULL DEFAULT '',
  telefon text NOT NULL DEFAULT '',
  treffer uuid[] NOT NULL,
  status text NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'freigegeben', 'zugeordnet', 'abgelehnt')),
  entschieden_am timestamptz,
  entschieden_von uuid REFERENCES benutzer(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS dubletten_meldungen_status ON dubletten_meldungen(status, gemeldet_am DESC);
CREATE INDEX IF NOT EXISTS dubletten_meldungen_benutzer ON dubletten_meldungen(benutzer_id);

INSERT INTO schema_version (version) VALUES (7) ON CONFLICT DO NOTHING;
