# Installation

## Neue Supabase-Datenbank

1. Ein eigenes Supabase-Projekt erstellen.
2. Im SQL Editor auf einer **leeren neuen Datenbank** alle Dateien in `supabase/migrations/` von `001_initial.sql` bis `027_camera_delivery.sql` in aufsteigender Reihenfolge ausführen. Jede Datei vollständig ausführen. Die vollständige Nummernfolge zählt; nicht nur die letzte Migration installieren.
3. Bei bestehenden Installationen zuerst ein Backup erstellen und nur fehlende Migrationen in Reihenfolge ergänzen. Alte Einrichtungsskripte danach nicht erneut über den aktuellen Stand laufen lassen. Die ältere Sammeldatei `DATENBANK_EINRICHTEN.sql` ersetzt die nachfolgenden Migrationen nicht.
4. Erst nach erfolgreicher Migration `MANAGER_AUTH_ENABLED=true` setzen. Der historische Variablenname schaltet heute Spielerkonten frei.

## Lokale Konfiguration

`.env.example` nach `.env.local` kopieren. Die Datei niemals einchecken.

| Variable | Inhalt |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL des eigenen Supabase-Projekts |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Öffentlicher Publishable Key |
| `SUPABASE_SECRET_KEY` | Geheimer Supabase-Server-Schlüssel; niemals mit `NEXT_PUBLIC_` benennen |
| `OWNER_PASSWORD_HASH` | Vollständiger scrypt-Hash, erzeugt durch `npm run owner-password` |
| `ACCESS_ENCRYPTION_KEY` | Separater zufälliger Server-Schlüssel aus dem Passwortwerkzeug |
| `RATE_LIMIT_HMAC_KEY` | Separater zufälliger Server-Schlüssel aus dem Passwortwerkzeug |
| `APP_ORIGIN` | Exakter Ursprung der Website, lokal `http://localhost:3000`, ohne Pfad |
| `MANAGER_AUTH_ENABLED` | Nach vollständiger Datenbankeinrichtung `true` |
| `NEXT_PUBLIC_CALLER_PACK_ENABLED` | Nur mit separat installiertem, rechtmäßig verwendetem Aufnahme-Paket `true`; siehe [Audio](AUDIO.md) |

`npm run owner-password` interaktiv ausführen; keine Passwörter als Befehlsargumente angeben. Server-Schlüssel bei bestehenden Installationen nicht grundlos ersetzen, weil verschlüsselte gespeicherte Verknüpfungen davon abhängen.

## E-Mail und Konten

In Supabase Authentication den Email-Provider und „Confirm email“ aktivieren. Site URL und erlaubte Redirect-URLs müssen zur tatsächlichen Website passen. Lokal die verwendete localhost-URL ergänzen; für Produktion die konkrete HTTPS-Domain. Weiterleitungspfade ergeben sich aus dem Anmeldeablauf und müssen von den erlaubten Mustern abgedeckt sein.

Für echte Nutzer eigenes SMTP in Supabase konfigurieren. Zugangsdaten ausschließlich dort speichern. Limits, erlaubte Empfänger und Absenderverifizierung hängen vom Anbieter ab. Ein erfolgreicher SMTP-Versand garantiert keine Zustellung: Ein Konto mit einer tatsächlich erreichbaren Adresse registrieren, die Bestätigung im privaten Browserfenster testen und vor Bestätigung eine vollständige Anmeldung ausschließen. Anschließend Passwortzurücksetzung ebenfalls testen. Keine Bestätigungslinks oder Mail-Header mit Zugangstoken öffentlich teilen.

## Lokal starten

```bash
npm ci
npm run build:camera
npm run dev
```

`npm run check:connection` prüft die konfigurierte Verbindung. Die Kamera benötigt eine Admin-Freigabe für das betreffende Konto; siehe [HANDYKAMERA.md](HANDYKAMERA.md). Autodarts bleibt unabhängig davon verfügbar.

## Vercel

1. Das gewünschte Repository in ein Vercel-Projekt importieren.
2. Umgebungsvariablen in Vercel eintragen und auf die vorgesehenen Deployment-Umgebungen beschränken. Keine echten `.env`-Dateien hochladen.
3. `APP_ORIGIN` auf die endgültige HTTPS-Adresse setzen; Supabase Site URL und Redirects entsprechend anpassen.
4. Standard-Build `npm run build` verwenden. Nach Änderungen an Build-Variablen neu deployen.
5. Registrierung, E-Mail-Bestätigung, Anmeldung, Passwortzurücksetzung, Turnier, Training und Zuschauerlink auf der neuen Installation prüfen.

Die Veröffentlichung des Quellcodes verlangt keine Änderung am bestehenden privaten Deployment. Eine separate Installation sollte eine eigene Datenbank und eigene Server-Schlüssel verwenden.

## Fehler eingrenzen

- „Anfrage stammt nicht von der Anwendung“: `APP_ORIGIN` mit der aufgerufenen Domain einschließlich Protokoll vergleichen und neu deployen.
- Datenbank-/RPC-Fehler: Migrationen und tatsächlich verwendetes Supabase-Projekt prüfen.
- Fehlende Mail: Supabase-Auth-Logs, SMTP-Anbieter und Rückläufer prüfen; Versand und Zustellung getrennt betrachten.
- Kein Ton: Audio durch Klick/Berührung freigeben; ohne separat installiertes Aufnahme-Paket bleibt der Caller aus.
- Fehlendes Board: In Autodarts die tatsächlich gewünschte Scheibe auswählen; Kamera-Freigaben sind separat.
- Falls Turbopack in einer eingeschränkten Entwicklungsumgebung scheitert: erst `npm run build:camera`, anschließend `npx next build --webpack` ausführen.
