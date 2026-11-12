# Handykamera-Erkennung

## Einrichtung

1. In Supabase nach Migration 025 die Datei `supabase/migrations/026_camera_devices.sql` vollständig im SQL Editor ausführen. Die Migration ist wiederholbar. Vorher bleiben Autodarts/manuelle Eingabe nutzbar; die Kameraseite meldet die fehlende Einrichtung.
2. Als globaler Admin in Spielerverwaltung bei ausgewählten Konten **Handykamera → Freischalten**. Alle bestehenden Spielerkonten starten ohne Freigabe. Der globale Admin darf selbst testen. Zugriff entziehen löscht die zugehörigen Kamerageräte und sperrt weitere Anfragen sofort.
3. Auf dem Handy mit diesem Konto `/camera-device` öffnen, Gerätenamen setzen und **Kamera starten**. Beim ersten Mal Kamerazugriff erlauben. Einmal pro Kamera, Browser und Modell läuft die Geräteoptimierung des gepinnten Originals: CPU-/GPU-Bewegungserkennung, Vorverarbeitung und Inferenz werden gemessen und mit zwei Referenzbildern geprüft. Das dauert beim ersten Start länger; das Ergebnis wird lokal gespeichert. „Gerätetest wiederholen“ startet diese Messung vom Spielgerät erneut. Kamera/Zoom werden lokal und Einrichtung serverseitig gespeichert. Bildschirm entsperrt und Seite im Vordergrund lassen.
4. Handy stabil und außerhalb der Wurfbahn montieren. Der InstaDarts-Erkenner benötigt einen schrägen Blick auf die Scheibe: seitlich und ober-/unterhalb des Bulls. Die komplette Trefferfläche muss scharf sichtbar sein.
Die Einrichtung ist auf dem Kamera-Handy ausgeblendet.
5. Auf dem Spielgerät mit demselben Konto **Kamera → Andere Kamera einrichten** öffnen. Vorschau, Zoom, Kamera, Modellauflösung und Linsenkorrektur von dort bedienen. Die grünen Ringe der Vorschau müssen auf den echten Ringen liegen. **Ausrichtung bestätigen**. Änderungen an Zoom, Linse, Modell oder Kamera erfordern eine erneute Bestätigung. Zoom ist bis 5× möglich. Hardware-Zoom wird verwendet, wenn verfügbar; oberhalb seiner Grenze ergänzt digitaler Zoom denselben zentralen Ausschnitt in Vorschau, Bewegungserkennung und Modell.
6. Im Match unter Einstellungen → Wurfeingabe **Handykamera** und das Kameragerät wählen. Je Spielergerät sind weiterhin Autodarts oder manuelle Eingabe möglich; eine automatische Quelle läuft pro Eingabekomponente. Bei lokalen Spielern wird die Kamera entsprechend dem aktiven Spieler verwendet. Die kompakte Toolbar-Anzeige öffnet bei Klick die Einstellungen. Am Handy ist kein Verbindungscode erforderlich.

Gespeicherte Geräte können auf der Kameraseite gelöscht werden. Dafür ist keine weitere Migration erforderlich.

Der **Kameramanager** öffnet sich über die Kamera- oder Match-Einstellungen als separates Fenster ohne Seitenmenü. Er zeigt Live-Vorschau, Status, Zoom, Linsenkorrektur, Modell und die gemessene Inferenzzeit (CPU/GPU). Er beansprucht keine zusätzliche Match-Lease und startet keine zweite Handykamera. Das Kamera-Handy muss weiterhin entsperrt im Vordergrund bleiben; der Manager darf neben dem Match offen bleiben.

## Verarbeitung und Sicherheit

- Modelle/Inferenz/Geometrie: separates, gepinntes InstaDarts-Kameraprogramm in `packages/camera-engine`, als gleichursprüngliches eigenständiges iframe geladen. Kein externer KI-Server, Laptop oder ngrok nötig. Modell-/WASM-Downloads verbleiben auf unserer Domain. Das Modell wird nicht neu trainiert.
- Host/Engine-Grenze: dokumentierte JSON-Nachrichten per `postMessage`; beide Seiten prüfen Origin und Fenster. Die Engine importiert weder App-Code noch Supabase-Zugangsdaten. Authentifizierung und Spiele werden separat von Dartbracket verarbeitet.
- Private, RLS-gesperrte `camera_devices`-Tabelle; ausschließlich Service-Role-RPC, jede Operation mit gültiger App-Sitzung und Freigabe. Kontoübergreifender Zugriff ist gesperrt. Ein Gerät besitzt eine Producer-Generation, monotone Berichte und eine zeitlich begrenzte Spielgerät-Lease. Maximal vier Geräte pro Konto, Größen-/Schema- und Ratenlimits. Kamerageräte erhalten keine allgemeinen Datenbankschlüssel.
- Das Spielgerät muss die bestehende Berechtigung zum Spieler besitzen. Seine normalen `/api/game`- oder `/api/dartdeck`-Aktionen bleiben für Regeln, Versionierung, Eigentum und Reihenfolge maßgeblich. Kameradaten sind keine Sonderberechtigung zum Schreiben von Ergebnissen.
- Koordinaten sind gemessene Spitzenpositionen. Umrechnung: InstaDarts [0..1000000], y nach oben, 451mm Gesamtbreite → Dartbracket äußeres Doppel = 1, y nach unten. Scores werden aus den Koordinaten berechnet; Marker werden nicht auf Segmentmitten verschoben.
- Auswertung läuft auf dem Kamera-Handy, nicht in Supabase und nicht auf dem Spielgerät. Bewegung löst die Inferenz nach der originalen Ruhephase aus. Ein verworfener Frame löst nach Beruhigung eine neue Auswertung aus; ein während einer laufenden Inferenz ankommender Trigger bleibt erhalten. Der Bestätigungslauf folgt gezielt auf Änderungen, statt das Modell im 250ms-Takt ständig auszuführen.
- Der Cursor startet erst nach sicher leerer Scheibe, stabilisiert neue Punkte und behält bekannte Darts auch bei kurz verdeckten Spitzen. Eine nicht lokalisierte Scheibe ist niemals ein Takeout. Ein stabiler Leer-Epoch bleibt durch kurze Verbindungsunterbrechungen erhalten; ein längerer Ausfall verlangt erneut eine leere Scheibe. Mehrere unbekannte Darts ohne gesicherte Reihenfolge werden als manuell zu prüfen gemeldet.
- Bei schlechtem Bild, offline/gesperrtem Handy oder Fehler pausiert die automatische Eingabe; manuelle Korrektur bleibt möglich. Misses außerhalb der sichtbaren Scheibe müssen manuell eingetragen werden. Manuelle Korrekturen werden nicht vom selben beobachteten Dart überschrieben.
- JPEGs: kleine Vorschau ungefähr 1/s; Bilder werden projektiv auf das vorhandene 510mm-Bildformat entzerrt, damit Kamerabild und Marker dieselbe Geometrie benutzen. Nur das letzte Bild wird gespeichert, keine Videoaufzeichnung/Matchhistorie von Kamerabildern. Berichte und Match-Abfragen laufen mit maximal 2 Hz, ohne überlappende Anfragen; bis zu 16 Beobachtungen bleiben für die Reihenfolge erhalten. Unveränderte Vorschaubilder werden nicht erneut hochgeladen; Match-Bilder unterstützen ETags. Spiel-/Zuschauerzugriff wird durch die vorhandene Bildroute geprüft; die ursprünglichen Raw-Frames sind nur dem eigenen Konto zugänglich.
- Das Matchbild ändert sich ausschließlich nach zweimal bestätigter Änderung der Anzahl erkannter Pfeile (einschließlich Teilentnahme und leerer Scheibe). Die Entzerrung benutzt den zur Erkennung gehörenden Frame. Die Einrichtungsvorschau bleibt mit ungefähr 1 fps live. Bei kurzem Bildausfall bleibt das letzte Bild erhalten. Kein Anspruch auf 30fps-Livevideo.
- Nur `/camera-device` und das Kameramodul erlauben Kamera-Zugriff. Der Menülink lädt deshalb ein neues Dokument mit der passenden Permissions-Policy. Sonstige Seiten behalten die restriktive Richtlinie. Das Modul erhält WASM/Worker-Berechtigungen und Cross-Origin-Isolation; der Rest der Anwendung benötigt diese Ausnahmen nicht.

## Lizenz und Build

Die eigenständige Kamera-Engine mit Adapter und Modellen ist AGPL-3.0-only; Copyright/Lizenz und gepinnter Stand stehen in `packages/camera-engine/README.md` und `upstream.json`. Nutzer erhalten im Kamera-Footer Lizenz und vollständigen zugehörigen Quellcode inklusive Modelle als `source.tar.gz`. Die bestehende Anwendung kommuniziert über das dokumentierte Datenprotokoll mit dem separaten Programm. Ein zukünftiger engerer Zusammenschluss muss erneut auf Lizenzverträglichkeit geprüft werden.

`npm run build` baut zuerst das getrennte Modul. Es installiert dessen gesperrte npm-Abhängigkeiten. Die beiden KI-Modelle (`packages/camera-engine/models/*.tflite`, zusammen etwa 4,6 MB) und zwei Referenzbilder (`packages/camera-engine/reference/*.jpg`, zusammen etwa 0,6 MB) liegen im eigenen Git-Repository und werden mit den SHA-256-Werten aus `upstream.json` geprüft. Der Build lädt keine Modelle oder Testbilder mehr vom Originalprojekt herunter. Dessen Löschung oder Updates beeinflussen diese Dateien nicht. Für eine frische Installation der npm-Abhängigkeiten bleibt der Zugriff auf die npm-Registry erforderlich; die Paketversionen sind gesperrt. Generierte WASM-/Bundle-/Quellcodearchive sind unter `public/camera-engine` und nicht im Git-Quellbaum. `npm run build:camera` baut nur die Engine. Ein alternativer Next-Build mit `npx next build --webpack` ist für Umgebungen möglich, in denen Turbopack keine internen Ports öffnen darf.

## Verifikation und Grenzen

Automatisierte Tests prüfen Datenbankfreigabe/Entzug, Mandantentrennung, Leases, Replay-Schutz, Koordinaten, Takeout, Kamera-API, Fernbedienung, Inferenz der echten Modelle mit Referenzbildern sowie Match-Eingabe im Chromium-Browser. Testkamera ersetzt nur den Hardware-Stream, nicht das Modell. Hardware-Genauigkeit, Hitze/Akku, Kamera-Linsen und Safari/GPU-Pfade müssen mit tatsächlichen Geräten geprüft werden. Insbesondere ist Kompatibilität mit einer beliebigen E-Dart-Scheibe nicht nachgewiesen; vor Turniereinsatz auf der konkreten Scheibe prüfen. Autodarts/Manuell bleiben Rückfalloptionen.


## Schnellere Zustellung und Messwerte (Migration 027)

Nach 026 einmal `supabase/migrations/027_camera_delivery.sql` vollständig im Supabase SQL Editor ausführen. Die Migration ist wiederholbar und ändert keine Autodarts- oder Spielregeln. Anschließend Kamera- und Spielseite neu laden, Kamera neu starten. Keine neuen Umgebungsvariablen erforderlich. Vor der Migration bleibt der bisherige Transport verwendbar; die getrennte Bildstrecke und der schnelle Abruf benötigen 027.

- Koordinaten gehen beim Erkennungsereignis sofort an den Host und von dort ohne festen 500ms-Sendetakt zum Server. Neue Darts werden nach 80ms gezielt erneut ausgewertet; eine leere Scheibe behält die längere Bestätigung und die originalen Ruhe-/Handschutzregeln. Der Wiederholungs-Watchdog wartet bei fehlgeschlagener Auswertung nur noch etwa 1–2 statt 3–4 Sekunden und läuft weiterhin durch die Bewegungssperre.
- Bildentzerrung und JPEG-Erzeugung folgen nach der Treffer-Nachricht in kurzen Arbeitsabschnitten. Bilder haben eine eigene Übertragung, eigene monotone Revisionen und Producer-/Generationssperren. Eine langsame oder überholte Bildanfrage kann weder neue Koordinaten überschreiben noch deren Versand blockieren. Foto-ETags ändern sich erst, wenn das passende Bild gespeichert wurde.
- Supabase Broadcast schickt ausschließlich eine leere Benachrichtigung auf einen kurzlebigen, per Server-HMAC unvorhersagbaren Kanal. Das ist ein Capability-Kanal, kein öffentliches Kanalverzeichnis und kein Broadcast von Kameradaten. Die Topic-Ausgabe erfolgt erst nach der vorhandenen Kamera-Berechtigungsprüfung. Jede Abholung prüft weiterhin die aktuelle Sitzung, Freigabe, Eigentum und aktive Controller-Lease in einer Service-Role-RPC. Auch gefälschte Benachrichtigungen können keine Treffer schreiben. Es werden weder Bilder, Spitzen, Sitzungstoken noch Spielstände im Broadcast verschickt. Tabellen bleiben für anon/authenticated gesperrt; es ist keine öffentliche RLS-Freigabe nötig.
- Das Spielgerät wird sofort zur Abholung geweckt und hat zusätzlich eine 500ms-Ersatzabfrage für verpasste Meldungen oder gesperrte WebSockets. Die aufwendige Match-Zuordnung erneuert es beim Spielerwechsel und etwa alle vier Sekunden im Hintergrund; die normale Spieleingabe prüft jeden Wurf weiterhin separat. Die 12s-Lease bleibt exklusiv. Falls öffentliche Broadcast-Kanäle im Supabase-Projekt deaktiviert sind, funktioniert die Ersatzabfrage; die Diagnose zeigt den tatsächlich verwendeten Weg.

Im Kameramanager unter **Zeitmessung** erscheinen nach einem automatisch gespeicherten Dart:

| Wert | Bedeutung |
| --- | --- |
| Gesamt ca. | Ab der erkannten Kamerabewegung bis zur bestätigten Spieleingabe, mit Uhrabgleich geschätzt; Unsicherheit steht daneben. Keine direkte Messung des physischen Auftreffens. |
| Handy bis bestätigt | Ruhephase, Auswertungen und Bestätigung auf dem Handy; enthält die KI-Zeit bereits. |
| KI-Auswertung | Einzelner Modell-/Geometriedurchlauf. |
| Abholen | Gesamte HTTP-Rundreise zum Abholen der Kameradaten einschließlich Serverarbeit. |
| Spiel speichern | Rundreise der normalen Spieleingabe bis zur Bestätigung. |
| Auf dem Server gewartet | Alter des zuletzt eingegangenen Koordinatenframes beim Abruf. |

Die Werte sind teilweise ineinander enthalten und dürfen nicht einfach addiert werden. Der Uhrabgleich verwendet Client-Sende-/Empfangszeit und Server-Empfangs-/Sendezeit; Serverarbeit wird aus der Netzwerkmessung herausgerechnet. Die geschätzte Unsicherheit berücksichtigt beide Geräte. Fehlt der Uhrabgleich, bleibt die Gesamtzeit leer, statt eine falsche Zahl auszugeben.

**Messwerte kopieren** enthält zusätzlich den letzten Kamera-Upload, die Bildaufbereitung und den Zeitpunkt der Messung, aber keine Zugangsdaten, Bilder oder Koordinaten. Zum Prüfen fünf Darts in normalem Tempo werfen und herausziehen; einmal die Werte eines normalen Wurfs und einmal eines langsamen Wurfs kopieren. Etwa 1–2 Sekunden sind ein Ziel, keine auf echten iPhones gemessene Zusage.


## Hintergrund-Erneuerung und kürzere Speicherwege

Die regelmäßige vollständige Prüfung der Match-Zuordnung läuft während einer noch gültigen Kamera-Lease im Hintergrund. Treffer dürfen währenddessen über den bereits autorisierten Snapshot-Abruf weiterkommen. Beim ersten Verbinden, beim Spielerwechsel, nach einer ungültigen Verbindung oder spätestens nach neun Sekunden ohne bestätigte Erneuerung wird zuerst vollständig autorisiert. Ein alter Erneuerungsaufruf muss vor einer neuen Spielerbindung fertig werden. Beim Trennen wird eine laufende Claim-Anfrage zuerst abgewartet und anschließend mit einer eigenen Controller-ID freigegeben, damit keine verspätete Anfrage die Verbindung wieder belegt.

DartDeck liest Lobby und Mitglieder parallel, nachdem das Konto geprüft wurde. Die Match-API lädt Turnier und Matchzustand parallel; sie gibt den Spielzustand erst nach erfolgreicher Turnierprüfung frei und behält die bestehenden Versionierungs- und Schreibprüfungen. Kamera-Claims verwenden die bereits in derselben Anfrage geladene Sitzung weiter. Es werden keine Zugriffsprüfungen zwischen Anfragen gecacht.

In **Messwerte kopieren** stehen zusätzlich **Abrufart** (`claim` oder `snapshot`), **Abruf-Serverzeit** (Serverarbeit innerhalb der Abruf-Rundreise) und **Lease zuletzt** (Dauer der letzten vollständigen Verbindungsprüfung). Die Hintergrund-Erneuerung kann länger dauern, ohne dass diese Zeit den Trefferabruf blockiert. Diese Änderung benötigt keine weitere SQL-Migration nach 027 und keine neuen Umgebungsvariablen.

## Eindeutige Kameranamen und Sitzungen (Migration 028)

Nach 027 die Datei `supabase/migrations/028_camera_names_sessions.sql` vollständig im Supabase SQL Editor ausführen. Namen sind pro Konto eindeutig; Groß-/Kleinschreibung, zusätzliche Leerzeichen und Unicode-Schreibvarianten unterscheiden keine Kameras. Andere Konten dürfen dieselben Namen verwenden. Bestehende doppelte Namen erhalten einen freien Zusatz wie „(2)“, ohne IDs, Einstellungen oder Bilder zu löschen. Dieselbe gespeicherte Kamera kann weiterhin unter ihrem Namen neu gestartet werden. Die Migration kann erneut ausgeführt werden.

Spielerkonten erhalten danach keine feste serverseitige Ablaufzeit mehr. Noch gültige bestehende Spielersitzungen werden übernommen, abgelaufene oder abgemeldete Zugänge nicht reaktiviert. Browser-Cookies werden bei gültigem Kontozugriff erneuert; Browsereinstellungen, Privatmodus oder gelöschte Cookies können trotzdem eine neue Anmeldung erfordern. Zusätzliche Konten auf demselben Gerät bleiben an die konkrete Hauptanmeldung gebunden. Abmelden, Deaktivieren und Passwortzurücksetzung können Sitzungen weiterhin beenden.

Neue Admin-Anmeldungen über das besondere Passwort gelten sieben Tage. Bereits bestehende Admin-Sitzungen behalten ihre bisherige Frist: nach dem Deployment einmal erneut anmelden, damit die sieben Tage gelten. Für diese Änderung sind keine neuen Schlüssel erforderlich.

Neue Kameras mit bereits belegtem Namen bekommen automatisch einen freien Zusatz: `Handykamera`, `Handykamera-2`, `Handykamera-3`. Der freie Name wird beim Öffnen und nach dem Eingeben automatisch ins Namensfeld übernommen; beim Registrieren prüft der Server die aktuelle Liste erneut und übernimmt den endgültig vergebenen Namen ins Eingabefeld. Die eigene bereits gespeicherte Kamera behält beim Neustart ihren Namen. Dafür ist keine weitere Migration nach 028 nötig.
