# Autodarts V2: Schnittstelle und Implementierung

Stand: 14. Oktober 2026. Dieser Leitfaden beschreibt die **in Dartbracket V2 implementierte Cloud-Anbindung**. Er richtet sich an Entwickler und KI-Assistenten. Bei Änderungen zuerst diese Datei und die verlinkten Module lesen. Die Anwendung verwendet keine lokale V1-API und öffnet keine Kameras selbst.

## Das entscheidende Ergebnis der Untersuchung

**Board-State allein reicht nicht.** In den aufgezeichneten V2-Nachrichten enthält das State-Thema insbesondere `numThrows`, aber keine vollständige Liste der Treffer. Die einzelnen Darts kommen als **`Throw detected` auf dem Events-Thema**, mit `throwNumber` und `throw`. Beide Themen abonnieren. Board-Liste, offener WebSocket und State-Meldungen sind noch kein Nachweis einer funktionierenden Wurfübertragung.

Die Aufnahme wird aus diesen einzelnen Ereignissen aufgebaut. Dazu wird **kein Autodarts-Match-Spielstand** in Dartbracket importiert. In den bisherigen Aufzeichnungen wurden Board-Würfe auch ohne zusätzliches offizielles Match empfangen. Das ist beobachtetes Verhalten, keine Garantie für jede zukünftige Client-Version.

## Belege und Grenzen

| Bereich | Grundlage / Stand |
| --- | --- |
| V2 State, Throw detected, Takeout und Koordinaten | Echte Aufzeichnungen; in der bisherigen Untersuchung Client 2.0.2. Bereinigte Nachrichten liegen in [autodarts-v2-board.json](../tests/fixtures/autodarts-v2-board.json). |
| Login, Refresh, Board-Liste und Tickets | Implementierter Cloud-Weg; HTTP-Verträge zusätzlich mit Ersatzantworten getestet. Alternative Anmeldung und 2FA sind nicht generell zugesichert. |
| Bildkanal und Snapshot-Endpunkt | In der bisherigen Untersuchung aus dem ausgelieferten Code von play.autodarts.com nachvollzogen; Weitergabe und Anzeige mit Ersatzbildern getestet. Echte entzerrte Kamerabilder und deren Ausrichtung müssen am angeschlossenen Board geprüft werden. |
| Automatisches Weiter und Ausbullen | Im Code umgesetzt und automatisiert geprüft. Hardware-Ablauf einschließlich Verzögerungen erneut an einer realen Scheibe abnehmen, wenn daran geändert wird. |

Es handelt sich um beobachtete Anbieter-Schnittstellen, nicht um einen zugesicherten öffentlichen API-Vertrag. Die unten genannten URLs sind der Stand unseres Codes; sie wurden für dieses Dokument nicht erneut beim Anbieter überprüft. Die frühen Community-Recherchen orientierten sich unter anderem an [ioBroker.autodarts/lib/cloud.js](https://github.com/inventwo/ioBroker.autodarts/blob/main/lib/cloud.js). Für Dartbracket ist der aktuelle Projektcode maßgeblich.

## Datenfluss und Zuständigkeit

1. Der Spieler wählt seine Dartbracket-Identität und verbindet in **Meine Einstellungen** sein Autodarts-Konto und Board. Der Gegner kann manuell spielen oder sein eigenes Board verbinden.
2. Dartbrackets Server übernimmt Login, Refresh und die Ausgabe eines kurzlebigen WebSocket-Tickets.
3. Der **Browser des verbundenen Spielers** hält den WebSocket zum Autodarts-Broker offen und empfängt Würfe. Auf Vercel läuft kein dauerhafter WebSocket-Worker.
4. BoardStream setzt die Ereignisse zu Slots zusammen. BoardCursor filtert neue, zulässige Darts. GameScreen sendet sie als normale Spielaktionen an `/api/game`.
5. Der serverseitig gespeicherte Dartbracket-Spielstand synchronisiert Gegner und Zuschauer. Diese brauchen keine fremden Autodarts-Tokens.
6. Scheibenbilder nehmen einen eigenen Weg über `/api/game-image`; die Punkteingabe funktioniert auch ohne Bild.

Die Board-Konfiguration gehört zum Spieler bzw. zur Geräteauswahl, nicht dauerhaft zum Match. Auf einem gemeinsamen Gerät können mehrere reservierte Spieler dasselbe Board nutzen; GameScreen bestimmt den aktuellen Akteur. Zwei getrennte Boards laufen über die jeweiligen Spielergeräte.

## HTTP-Anmeldung und Broker-Verbindung

Implementierung: [src/server/autodarts.ts](../src/server/autodarts.ts) und [API-Route](../src/app/api/autodarts/route.ts).

| Aufruf durch Dartbrackets Server | Inhalt / Antwort |
| --- | --- |
| POST https://api.autodarts.com/auth/v1/login | JSON: username, password, client_id: autodarts-play. Antwort: access_token und refresh_token. |
| POST https://api.autodarts.com/auth/v1/refresh | JSON: refresh_token, client_id: autodarts-play. Antwort: erneuerte Tokens. |
| GET https://api.autodarts.com/bs/v0/boards | Bearer-Access-Token. Akzeptiert wird eine Liste oder ein Objekt mit boards-Liste; nach außen nur id und name. |
| POST https://play.ws.autodarts.com/ms/v0/tickets | Bearer-Access-Token, leerer JSON-Body. Antwort: code. |
| WebSocket wss://play.ws.autodarts.com/ms/v0/subscribe?code=… | URL-codiertes Ticket; danach Abonnements senden. |

Die eigenen POST-Operationen von `/api/autodarts` sind `login`, `boards`, `connect`, `pause`, `ticket`, `image`, `disconnect`. GET liefert nur den Anmeldestatus. Der Browser erhält weder das Access-Token noch das Refresh-Token als JSON. Verbindungstickets und kurzlebige Bildadressen sind ebenfalls vertraulich.

Das Passwort wird nach der Anmeldung aus dem Eingabefeld gelöscht und nicht gespeichert. Bei aktivierter Kontoverknüpfung liegt das Refresh-Token AES-GCM-verschlüsselt in der privaten Tabelle `saved_autodarts` (Migration 012 nach 011). Der Zugriffsschlüssel entsteht ausschließlich aus `read_session`: Manager-ID für Manager/Owner (Owner-Sentinel bei globalem Owner), persönliche `player_access_id` für Spieler. Auch der verschlüsselte Inhalt ist an diesen Schlüssel gebunden. Zuschauer können keine Verknüpfung lesen oder erstellen. Ein 60-Sekunden-Lease serialisiert Refresh-Anfragen über Geräte und Vercel-Instanzen; jede Rotation wird gespeichert, auch bei abgewiesenen Boards. Eine zwischenzeitlich gelöschte/ersetzte Verknüpfung kann durch alte Refresh-Antworten nicht wieder entstehen. Browserantworten enthalten nur Status, Boardliste und bevorzugte Board-ID. Spieler-Verknüpfungen werden beim Ersetzen/Löschen ihres Codes mitgelöscht.

Unter **Meine Einstellungen** können Manager und Owner bereits ohne Spielerzuordnung verknüpfen. Einmal anmelden und **Meine Scheibe verbinden** speichert die bevorzugte Scheibe und die automatische Wiederverbindung. Spieler können dies direkt nach der Namenswahl tun. Beim nächsten Aufruf wird die Anmeldung aus dem gespeicherten Token erneuert und das Board automatisch gewählt; Wurftickets und Bilder erfordern weiterhin eine aktuelle Spieler-/Turnierzuordnung. Die Spielerauswahl schlägt bei gespeicherter automatischer Verbindung Autodarts vor. Eine ausdrücklich manuelle Auswahl auf diesem Gerät verhindert die automatische Wurfeingabe. **Automatische Eingabe ausschalten** pausiert die Wiederverbindung; **Autodarts abmelden** löscht die Verknüpfung. Abmelden aus Dartbracket erhält sie. Widerrufene/abgelaufene Anbieter-Tokens erfordern erneute Anmeldung; Netzwerkfehler löschen keine Verknüpfung.

Ohne Kontoverknüpfung bleibt der bisherige Weg bestehen: Das Refresh-Token liegt verschlüsselt im HttpOnly-Cookie `dartbracket_autodarts`, gebunden an Sitzung, ausgewählten Spieler und Turnier, mit 24 Stunden Gültigkeit. Bei Spieler-/Turnierwechsel kann deshalb eine neue Anmeldung nötig sein. Die Route prüft Origin, Spielerberechtigung, Rate-Limit und Board-Zugehörigkeit. Refresh-Anfragen werden im Browser serialisiert; diese Warteschlange nicht entfernen.

## WebSocket-Themen und Payloads

Nach dem Öffnen senden, BOARD-ID durch die ausgewählte ID ersetzen:

~~~json
{"type":"subscribe","channel":"autodarts.boards","topic":"BOARD-ID.state"}
{"type":"subscribe","channel":"autodarts.boards","topic":"BOARD-ID.events"}
~~~

Die Verbindung schickt anschließend Ereignisse; es wird nicht für jeden Dart erneut per HTTP abgefragt. Beim Schließen enden die Abonnements. Für Bilder gibt es zusätzlich ein unsubscribe. Die Produktionsoberfläche hält die Verbindung bis zum tatsächlichen Abbruch offen. Es gibt keine geplante Unterbrechung nach zehn Minuten mehr. Nach einem Abbruch folgt der erste Versuch nach 250 ms, danach mit steigender Wartezeit bis maximal 30 Sekunden. Nach jedem Neuverbinden werden Stream und Cursor zurückgesetzt. Beim Ticket-Aufruf wird einmalig der bereits im Diagnosewerkzeug verwendete HTTP-Board-State (`/bs/v0/boards/BOARD-ID/state`) gelesen. Nur `numThrows: 0`, ohne widersprechende throws-Liste oder `connected: false`, bestätigt eine leere Scheibe und schaltet den Cursor beim Socket-Start scharf. Es werden keine Punkte aus diesem State übernommen. Bei unklarem Zustand oder HTTP-Fehler bleibt die nächste leere WebSocket-Meldung erforderlich. Eine schon leere Scheibe braucht dadurch keinen Probe-Wurf mehr. Spielstandänderungen dürfen den Socket nicht neu verbinden.

Gekürztes State-Beispiel (Struktur aus den Aufzeichnungen):

~~~json
{"channel":"autodarts.boards","topic":"BOARD-ID.state","data":{"event":"Throw detected","numThrows":1,"status":"Throw"}}
~~~

Gekürztes tatsächliches Wurfbeispiel aus der bereinigten Fixture:

~~~json
{
  "channel":"autodarts.boards",
  "topic":"BOARD-ID.events",
  "data":{
    "boardId":"BOARD-ID",
    "event":"Throw detected",
    "throwNumber":1,
    "throw":{
      "coords":{"x":0.3055217153158699,"y":-0.06434386204181908},
      "segment":{"bed":"SingleInner","multiplier":1,"name":"S10","number":10}
    }
  }
}
~~~

`throwNumber` ist 1–3, der interne Slot-Index 0–2. Gewertet werden `segment.number` und `segment.multiplier`: Single 1, Double 2, Triple 3; Bull: number 25 mit 1 bzw. 2; Fehlwurf: multiplier 0. Namen wie S10 oder bed sind keine notwendige Rechengrundlage. Nicht jedes Event mit einem throw-Objekt ist ein Wurf: Takeout- und Kalibrierungsereignisse können ein Dummy-Objekt mit Miss enthalten.

## Schutz vor falschen und doppelten Würfen

Implementierung: [src/domain/autodarts.ts](../src/domain/autodarts.ts), [AutodartsPanel](../src/components/AutodartsPanel.tsx), [GameScreen](../src/components/GameScreen.tsx).

- Nur das richtige Board, der richtige Kanal und das richtige Thema werden verarbeitet. Autodarts-Match-Scores werden ignoriert.
- BoardStream akzeptiert Throw detected nur mit gültiger throwNumber. Bereits vorhandene Slots werden nicht nochmals übernommen, auch wenn Autodarts später eine Korrektur dafür sendet.
- BoardCursor wird erst nach einem leeren Snapshot scharf (initial einmalig per HTTP-State bestätigt oder über den WebSocket). Bereits steckende Darts beim Verbinden werden nicht rückwirkend importiert.
- Würfe außerhalb des eigenen Zugs werden konsumiert, aber nicht eingetragen. Sie dürfen später nicht in den nächsten Zug rutschen.
- Fehlt ein früheres Event, wird die Aufnahme blockiert, statt den fehlenden Dart zu erfinden. Auch ungültige Treffer oder schrumpfende Aufnahmen ohne vollständiges Leeren blockieren bis zum nächsten leeren Snapshot.
- Manuell belegte Slots werden nicht überschrieben. Manuelle Korrekturen bleiben maßgeblich; neue zulässige Darts werden bei lokalen Indexlücken in den nächsten freien Platz übernommen.
- Eine Promise-Warteschlange hält die Reihenfolge der Spielaktionen ein. Generation-Zähler verhindern verspätete Aktionen aus einer alten Verbindung.
- API-Fehler pausieren die automatische Eingabe. Manuelles Spiel bleibt verfügbar. Die serverseitigen Spielrechte und Versionsprüfungen dürfen nicht umgangen werden.

## Takeout: wann automatisch Weiter gedrückt wird

Im durchgehenden Ereignisstrom bestätigt nur **Takeout finished** die übernommene Aufnahme. **Takeout started**, `numThrows: 0`, Manual reset oder Kalibrierung dürfen nicht allein zum Zugwechsel führen. Das frühe Nullsetzen von numThrows ist in den Aufzeichnungen zu sehen und war eine wichtige Fehlerquelle.

Ein erfolgreich übernommener automatischer Dart aktiviert `armedVisit`. Der gespeicherte Schlüssel lautet beim Spielen `playing:ANZAHL_BESTÄTIGTER_AUFNAHMEN`, beim Ausbullen `bull:BULL_RUNDE`. Takeout finished löst nur bei aktivierter Option und passender aktueller Aufnahme ein next aus. Danach wird die Aktivierung gelöscht. Doppelte Meldungen auf State und Events, manuelles Weiter oder verspätete Meldungen eines früheren Zugs dürfen keinen zweiten Wechsel bewirken.

Beim Ausbullen wird nur der erste automatische Dart übernommen und eine echte Position verlangt. Beim Herausziehen wird der gesetzte Bull-Treffer bestätigt. Beide Bulls oder beide 25 bedeuten eine Wiederholung; außerhalb zählt der Abstand. Für die nächste Bull-Runde die Scheibe leeren. Bei parallelen Bestätigungen kann GameScreen nach einem Versionskonflikt den aktuellen Stand lesen und gezielt erneut bestätigen.

## Genaue Trefferposition und Millimeter

Autodarts-Koordinaten werden getrennt von der Wertung gespeichert:

~~~text
hit.position.x = coords.x
hit.position.y = -coords.y
Abstand in mm = hypot(coords.x, coords.y) * 170
~~~

Der verwendete Maßstab ist äußerer Double-Radius 1 = 170 mm. Autodarts-Y zeigt nach oben, SVG-Y nach unten. Die Umrechnung erfolgt einmal in autodartsHit. Nicht nochmals spiegeln und nicht die Feldmitte als Messposition einsetzen. Am Draht kann das erkannte Feld von idealer mathematischer Geometrie abweichen: **Feldwertung aus segment, Markerposition aus coords**.

Akzeptiert werden endliche Koordinaten mit jeweils Betrag höchstens 2. Ohne Koordinaten ist normales Scoring möglich, automatisches Ausbullen dagegen nicht. Die Anzeige auf eine Nachkommastelle ist keine Zusicherung einer Messgenauigkeit von 0,1 mm. Physische Genauigkeit hängt von Autodarts und der Kalibrierung ab. Die optionale Position wird im vorhandenen Spiel-JSON gespeichert.

## Entzerrte Bilder: separater Weg

Implementierung: [useAutodartsImages](../src/components/useAutodartsImages.ts), [board-image](../src/domain/board-image.ts), [game-image-Route](../src/app/api/game-image/route.ts), [MatchBoard](../src/components/MatchBoard.tsx). Einrichtung: [AUTODARTS_BILDER.md](AUTODARTS_BILDER.md).

Auf demselben Broker-Socket wird genau die ausgewählte Kamera abonniert (Kamera 1 in der Oberfläche = cam 0):

~~~json
{"type":"subscribe","channel":"autodarts.boards.images","topic":"BOARD-ID.live?cam=0&warp=true"}
~~~

Eine passende Nachricht enthält eine URL in `data.url`, keine Bildbytes. Relative Bildpfade werden gegen https://boards.ws.autodarts.com aufgelöst. Ein zusätzlicher Snapshot wird pro Bildverbindung und zugeordnetem Spieler auf der leeren Scheibe über den Server angefragt. Wird die Scheibe währenddessen belegt, kann die Startbild-Anfrage beim nächsten Leeren erneut versucht werden:

~~~text
GET https://api.autodarts.com/bs/v0/boards/BOARD-ID/img/live?cam=0&warp=true
Authorization: Bearer ACCESS_TOKEN
Antwort: {"url":"…"}
~~~

Es ist kein Videostream und kein zweiter Zugriff auf die USB-Kameras. Die Bildereignisse liefern Aktualisierungen; die Snapshot-Anfrage beschafft zusätzlich ein Startbild. Die Produktionsoberfläche fragt den Autodarts-Snapshot nicht vor jedem Dart oder Zug neu ab.

Der Spielerbrowser übermittelt Bild-URL, Akteur, Verbindung und Aufnahme an `/api/game-image` (frame). Der Server prüft Sitzungs-/Matchrechte und Aufnahme, akzeptiert ausschließlich HTTPS-Adressen auf boards.ws.autodarts.com ohne fremde Ports oder Credentials, folgt keinen Redirects und prüft JPEG/PNG/WebP samt Dateisignatur und 1-MB-Grenze. Anschließend wird das Bild als Data-URL in `match_board_images` gespeichert. Gegner und Zuschauer erhalten **Bilddaten, keine Anbieter-Tokens oder signierten URLs**.

Zusätzlich existieren heartbeat (alle 15 Sekunden während aktiver Bildanzeige) und clear. Pro Match/Spieler werden aktuelles Bild und leeres Startbild geführt. Für einen anderen visit oder nach 45 Sekunden ohne Aktualisierung wird das leere Bild verwendet, wenn vorhanden. MatchBoard liest den eigenen Bildendpunkt alle 400 ms; ETag/304 vermeidet wiederholte Bildübertragung. Ein kleiner Browser-Cache hält leere Bilder beim Spielerwechsel sofort verfügbar. Das ist Dartbracket-Polling, kein Autodarts-Polling für Wurfdaten.

Im normalen Spiel wird auf beiden Geräten das Bild des aktiven Spielers angezeigt. Beim Ausbullen lässt sich die Spielerscheibe auswählen. In der Handy-Tastaturansicht wird kein zusätzliches Bild über der Eingabe angezeigt. Neue Bilder werden vor dem sichtbaren Wechsel im Browser dekodiert. Vorübergehende HTTP-, Download- und Dekodierfehler sowie ein gleichzeitiger Bildwechsel zwischen Metadaten- und Bildabfrage lassen das letzte gültige Bild stehen. Eine ausdrückliche Löschung, fehlende Berechtigung oder abgeschaltete Kamera verwendet weiterhin die gezeichnete Scheibe. Spielerwechsel zeigen ausschließlich das leere Cache-Bild des ausgewählten Spielers, niemals das Dartbild des Gegners. Bildfehler dürfen die Punkteingabe nicht stoppen.

Datenbank: Neuinstallation mit [DATENBANK_EINRICHTEN.sql](../supabase/DATENBANK_EINRICHTEN.sql); für bestehende Installationen ist der aktuelle Bild-/Geräteeinstellungsweg in [010_device_settings.sql](../supabase/migrations/010_device_settings.sql) enthalten. Die frühere 009 ist nicht der vollständige aktuelle Stand. Keine Migration nur wegen dieser Dokumentation ausführen.

## Fehler gezielt eingrenzen

| Beobachtung | Nächster Prüfschritt |
| --- | --- |
| Board-Namen sichtbar, keine Würfe | Das bestätigt nur den HTTP-Login. Socket, beide Board-Themen und Throw detected auf events prüfen. |
| Cloud verbunden, State zählt Darts, keine Treffer | Events-Abonnement und throwNumber/throw-Payload prüfen. Aus numThrows keine Treffer ableiten. |
| Treffer kommen, werden aber nicht eingetragen | Board nach Verbindung leeren; Spieler am Zug, Cursor-Lücken, Slotbelegung und API-Fehler prüfen. |
| Weiter passiert nicht | Takeout finished und armedVisit prüfen; bei rein manuellen Würfen ist automatisches Weiter nicht aktiviert. |
| Board nach Neuverbinden scheinbar stumm | Ohne bestätigten leeren HTTP-Startzustand bleibt Leeren erforderlich. Es gibt keinen garantierten Replay aller alten Wurfevents. |
| Punkte funktionieren, Bild fehlt | Separates images-Abonnement, Kameraindex, data.url, Snapshot-Antwort, Bildberechtigungen und 010-Migration prüfen. |
| Bild erscheint verzögert | Cloud-Bildereignis, Download auf dem Server und Bild-Polling getrennt betrachten. Neue Authentifizierung pro Dart ist keine Lösung. |
| 401/403 oder Origin-Fehler | Dartbracket-Spieleridentität, Cookie-Bindung und APP_ORIGIN prüfen; Board muss in der Board-Liste dieses Kontos stehen. |

## Vorhandene Diagnose statt neuer Testprogramme

Im Projektterminal `npm run autodarts:diagnose` oder [Autodarts-Diagnose.cmd](../tools/autodarts/Autodarts-Diagnose.cmd) starten. Node 22 oder neuer, Autodarts-Konto mit Zugang zur Scheibe, eingeschalteter verbundener Client und echte Würfe werden benötigt. Die Kameras können auf einem anderen PC angeschlossen sein; der Diagnose-PC empfängt die Cloud-Daten des berechtigten Kontos.

Die Diagnose zeichnet fünf Minuten auf (Strg+C beendet früher): State/Events, Board-Match-Zuordnung, HTTP-State alle fünf Sekunden, Bildmeldungen und Bild-HTTP-Metadaten. Sie abonniert alle drei Kameras und fragt deren Snapshot an. Ein nach Start neu begonnenes offizielles Match kann zusätzlich verfolgt werden. Ein bereits laufendes Match wird nicht automatisch gefunden. Diese Match-Themen und das HTTP-State-Polling dienen der Diagnose, nicht dem produktiven Scoring.

Testablauf: zunächst Scheibe leeren, zweimal drei Darts werfen und jeweils vollständig herausziehen. Falls nur State kommt, mit einem danach gestarteten offiziellen Match vergleichen. Für Bilder zuerst prüfen, ob die offizielle Seite ein entzerrtes Bild derselben Kamera zeigt.

Aufzeichnungen liegen unter tools/autodarts/recordings/ und bleiben von Git ausgeschlossen. Das Programm entfernt Zugangsdaten, Tokens und Bildadressen; Boardnamen, IDs oder Spielstände können trotzdem enthalten sein. Keine Rohaufzeichnungen unbesehen veröffentlichen. Die bereinigte Fixture ist der teilbare Ausgangspunkt; vorhandene Diagnose erweitern, statt erneut Endpunkte zu erraten.

## Einstieg für Entwickler und KI-Assistenten

| Datei | Aufgabe |
| --- | --- |
| src/server/autodarts.ts | Feste Cloud-Endpunkte und Antwortvalidierung |
| src/app/api/autodarts/route.ts | Sitzung, verschlüsselte Authentifizierung, Boardrechte |
| src/server/saved-autodarts.ts | Kontogebundene Verknüpfung, verschlüsselte Tokens und serialisierte Erneuerung |
| src/domain/autodarts.ts | BoardStream, BoardCursor, Treffer, Takeout-Erkennung |
| src/components/AutodartsPanel.tsx | Socket, Reconnect, Reihenfolge, Gerätewahl |
| src/components/GameScreen.tsx | Zuordnung zum Spieler, Spielaktionen, Bull und Weiter |
| src/components/useAutodartsImages.ts | Bildabonnement, Startbild, Weitergabe |
| src/app/api/game-image/route.ts | Sicherer Bilddownload und Zugriff |
| src/components/MatchBoard.tsx | Bildabruf, Cache, Wechsel und Ersatzdarstellung |
| tools/autodarts/diagnose.mjs | Vorhandenes Cloud-Diagnosewerkzeug |

Passende Prüfungen im Projektterminal:

~~~powershell
npx vitest run tests/autodarts.test.ts tests/autodarts-cloud.test.ts tests/autodarts-api.test.ts tests/board-image.test.ts tests/game-image-api.test.ts
npx playwright test tests/e2e/scoring.spec.ts
npm run typecheck
npm run build
~~~

Automatische Tests verwenden bereinigte Aufzeichnungen bzw. Ersatzantworten und ersetzen keinen Hardwaretest. Bei Anpassungen insbesondere doppelte Events, fehlende Slots, manuelle Korrektur, fremde Züge, Reconnect, Takeout-Duplikate, Ausbullen und zwei Boards erhalten. Keine Tokens loggen, keine Wurfdaten aus Autodarts-Match-Scores ableiten und keine zusätzliche lokale Kamerasoftware einführen. Wenn sich ein Anbieter-Payload ändert, eine bereinigte neue Fixture und diesen Leitfaden zusammen mit dem Parser aktualisieren.

## Manager-/Spielerzugänge ab Migration 011

Die Autodarts-Anbindung selbst bleibt unverändert. Bei der Spielerauswahl wird
nach der bestätigten Zuordnung direkt AutodartsPanel ohne Match-ID eingeblendet,
wenn „Mit meiner Autodarts-Scheibe“ gewählt wurde. Konto und Board können dort
vor dem Match verbunden werden. Persönliche Spieler-Codes sind an genau einen
Teilnehmer gebunden; Provider-Cookie, Sitzung und Boardrechte behalten dieselben
Bindungen. Die Auswahl-/Kamera-Einstellungen werden unter demselben Spieler-Scope
wie in GameScreen gespeichert. Zuschauer sehen nur Bilder innerhalb ihres
freigegebenen Manager-Bereichs, weil alle Bild-Lesezugriffe zuerst die neue
Repository-Zugriffskontrolle durchlaufen. [Einrichtung](MANAGER_KONTEN.md).

## Gemeinsame persönliche Spieler-Codes (Migration 013)

Mehrere persönliche Codes desselben Turniers können auf einem Gerät freigeschaltet
werden. Die SQL-Sitzung prüft jeden Code und dessen Version; ohne Code kann kein
weiterer Name gewählt werden. `participant_ids` enthält die aktuell übernommenen
Spieler, `authorized_participant_ids` die über Codes freigeschalteten Namen.
Der vorhandene Geräte-/Akteurweg übernimmt Punkte und Bilder nur für diese Spieler.
Die Autodarts-Verknüpfung bleibt am zuerst angemeldeten persönlichen Code verankert;
ein gemeinsames Board wird wie bisher für die auf diesem Gerät gewählten Spieler
verwendet. Die Cloud-Endpunkte, Wurfparser und Socket-Themen bleiben unverändert.
Manager-Spielerzuordnungen werden pro Konto und Turnier gespeichert, aber ein
erneuter Login übernimmt keine bereits auf einem anderen Gerät belegten Spieler
stillschweigend. Manager-Kontolöschung widerruft auch gespeicherte Autodarts-Tokens.

## Training und gebundene Kontositzungen (Migration 014)

Trainingsräume verwenden dieselben `GameScreen`-, Scoring-, Bild- und Autodarts-Routen wie Turniermatches.
Es gibt keinen zweiten Eventparser und keine abweichende Punkteberechnung. Ein angemeldeter Manager/Owner
behält beim Mitspielen einen primären Kontozugang; ein zusätzliches HttpOnly-Cookie `dartbracket_player`
bezeichnet den auf das Turnier/Training beschränkten Editorzugang. `playSession` akzeptiert diesen nur bei
passender `account_session_hash`-Bindung und angefragtem Turnier. Die Datenbank prüft zusätzlich Parent-Sitzung
und gültige Code-Verknüpfungen. Ein zurückgebliebenes Cookie eines anderen Kontos wird ignoriert.

Für solche gebundenen Editorzugänge leitet `read_session` die vertrauenswürdige `account_manager_id` ab.
`autodarts_profile` und `autodartsAccountKey` verwenden dann das eigene Managerprofil; Gastzugänge verwenden
weiterhin das Profil ihres persönlichen Spielercodes. Der fremde Turniermanager erhält dadurch keinen Zugriff
auf Autodarts-Tokens. Revanchen erhalten neue Match-IDs, damit Versionszähler und Bildcache kein altes Spiel
übernehmen. Echte Hardwareprüfung bleibt erforderlich; siehe [Training und Freunde](TRAINING_UND_FREUNDE.md).

## Dauerhafte Gäste und Owner-Vertretung (Migration 015)

Neue Gastzugänge besitzen eine dauerhafte `guest_id`; `autodartsAccountKey` und `autodarts_profile`
verwenden `guest:<id>` für Primär- und gebundene Spielersitzungen. Das gespeicherte Token bleibt damit bei
wechselnden Lobby-/Turnierzuordnungen erhalten. Bestehende anonyme Codeprofile bleiben lesbar; beim Umstieg
auf einen benannten Gast muss die Scheibe gegebenenfalls einmal erneut verknüpft werden.
Der Eventparser, Board-Bootstrap und Takeout-Ablauf bleiben unverändert.

Owner können freie Matchseiten vertreten, ohne eine Spielerzuordnung zu überschreiben. Spielpräsenz und
Schreibprüfung sperren die Seite, sobald der echte Spieler dort aktiv ist. `write_owner_board_image` prüft die
Vertretungsberechtigung beim Schreiben; der Bildabruf prüft sie erneut. Hintergrund-Heartbeats und erfolgreiche
Spielaktionen erhalten die Präsenz, damit ein Autodarts-Tab auch im Hintergrund seinen Spieler schützt.

Der globale Owner darf die eigene dauerhaft verknüpfte Scheibe auch ohne feste Spielerzuordnung verbinden
(Ticket/Bild vom Anbieter lesen). Die Zuordnung der Scheibe zum eigenen Autodarts-Konto wird weiterhin geprüft.
Das gewährt keine Eingabe- oder Bildschreibrechte: Diese prüfen separat die aktuelle freie Matchseite.
Für Manager und Gäste bleibt zum Lesen des laufenden Board-Streams eine Spielerzuordnung erforderlich.

## Einheitliche Spielerkonten (Migration 016)

Gast- und anonyme Code-Sitzungen werden nicht mehr akzeptiert. Bestehende Konten und ihr `manager:<id>`-Autodarts-Profil bleiben erhalten. `playSession` löst bei angegebenem Turnier die serverseitig zugeordnete Spieleridentität über `account_play_session` auf; dafür ist kein Code oder zusätzliches Browser-Cookie nötig.

AutodartsPanel sendet den Turnierkontext als `X-Dartbracket-Tournament` bei den bestehenden Status- und POST-Aufrufen. Die Route validiert die UUID und ermittelt den Spieler ausschließlich aus der authentifizierten Kontozuordnung. Ein frei behaupteter Turnierkontext oder eine Board-ID verleiht keine Rechte. Der ursprüngliche Kontoschlüssel für gespeicherte Anbieter-Tokens wird durch die gebundene Sitzung weiterverwendet. Ohne Turnierkontext bleibt das Verknüpfen in den Kontoeinstellungen möglich; Tickets/Bilder erfordern beim normalen Spielerkonto weiterhin eine echte Zuordnung. Owner-Vertretung bleibt erhalten.

Anbieter-Endpunkte, Socket-Themen, Parser, Takeout-Schutz, Bildtransport und Refresh-Warteschlange werden dabei nicht verändert. Die älteren Abschnitte zu Gast- und Code-Anmeldung dokumentieren die vorherigen Migrationen.

## Kontoeinrichtung und Lobby-Zuordnung (Migration 017)

Nach der ersten Anmeldung erscheint die Kontoeinrichtung mit aufgeklapptem Autodarts-Formular. „Manuell spielen / später verbinden“ schließt den einmaligen Schritt ebenfalls ab; die Scheibe lässt sich jederzeit in den Einstellungen verbinden. Der gespeicherte `manager:<id>`-Kontoschlüssel bleibt erhalten. Auch der Owner löst eine eigene Kontozuordnung serverseitig auf und behält daneben die bestehende Vertretung freier Matchseiten. Code- und Gastanmeldungen sowie Spieler-Einladungslinks entfallen. Protokoll, Token-Erneuerung, Wurfparser und Bildtransport sind unverändert.

## Gemeinsames Ausbullen und Sprache (020)

GameScreen wechselt nach einem erfolgreichen Bull-`next` den lokalen Akteur und die angezeigte Spielerscheibe gemeinsam auf den nächsten noch unbestätigten, auf diesem Gerät gesteuerten Spieler. Eine neue Bull-Runde nach Gleichstand wählt wieder den ersten Spieler. Eine bereits bestätigte Seite kann bis zur Korrektur keinen neuen Dart eingeben. Der Tastatur-/Scheibenschalter ist auch in der Bull-Phase sichtbar. Takeout verwendet denselben bestehenden `send`-Weg; Parser, Anbieterprotokoll, `armedVisit` und Versionsprüfung bleiben erhalten. Die Spracheinstellung übersetzt Statusanzeigen bei der Darstellung und verbindet deshalb den Socket nicht neu. Automatisierte Prüfungen ergänzen die bisherigen Zwei-Geräte- und Takeout-Fälle; der Ablauf an echter Hardware bleibt zu prüfen.

## Lokale Trainingsspieler und Solomodi (021)

X01-Lobbys erlauben einen lokalen zweiten Teilnehmer ohne eigenes Konto. Seine interne Teilnehmerberechtigung gehört ausschließlich zum Lobby-Ersteller in dieser Lobby. `account_play_session` liefert beide Teilnehmer für dessen gebundene Sitzung; die lokale Seite wird in der Lobby mit `local: true`, ohne fremde accountId dargestellt. Entfernen rotiert die bestehende Teilnehmerberechtigung und entzieht die zweite Seite. Fremde Konten können sie nicht wählen. Es wird kein neues Autodarts-Profil angelegt.

`Game.sharedDevice` aktiviert beide berechtigten Seiten im Match. Der bestehende GameScreen-Akteurwechsel und dieselbe stabile AutodartsPanel-Instanz übernehmen Treffer und Takeout für den jeweils aktuellen Spieler. Solo-X01 und Around the Clock verwenden denselben Stream und dieselben `dart`/`next`-Aktionen mit einem aktiven Spieler, ohne Ausbullen. Die Solo-Spielerseite wird aus dem tatsächlichen Ersteller-Teilnehmer abgeleitet; ältere ausgeloste Lobbys können ihn auf Seite zwei haben. Anbieter-Endpunkte, Parser, Bootstrap, Ereignisfilter, Takeout-Schutz und Bildtransport sind unverändert.

Datenbank-, Domain- und Browserprüfungen umfassen lokale Berechtigungen, Widerruf, beide Solo-Spielerseiten, Zielwechsel/Korrektur und automatisches Zählen beider lokaler Seiten über denselben simulierten Broker-Socket. Physische Würfe und das Kamera-Verhalten bleiben nach dem Update am eigenen Board zu prüfen.

## Around the Clock mit bis zu sechs Spielern (022)

Around the Clock verwendet einen eigenen Fortschritt pro Spieler und eine geordnete `Game.players`-Liste mit maximal sechs Einträgen. `Turn.player` und `starter` sind deshalb numerische Indizes; X01 bleibt auf zwei Spieler beschränkt. `aroundClockActive` bestimmt die aktive Seite nach jeder bestätigten Aufnahme, `aroundClockView(game,index)` berechnet deren Ziel, Darts und Trefferquote. Der erste vollständig bestätigte Durchgang beendet das Spiel. Eine Korrektur ändert nur die aktive Seite. Ältere Solo-Spiele mit zwei gespeicherten IDs und `solo: true` bleiben kompatibel.

`GameScreen` zeigt nur die aktive Clock-Spielerseite. Bei lokalen Teilnehmern liefert die vorhandene, kontogebundene Sitzung die entsprechenden Spielerrechte; `sharedDevice` hält alle eigenen lokalen Seiten verfügbar. Der aktive Akteur und die Bildzuordnung wechseln über denselben bestehenden Weg. Ein fremder Kontospieler wird nicht mitgesteuert. Der gespeicherte Autodarts-Socket bleibt bei Zugwechseln bestehen, und `playing:turns.length` trennt Aufnahmen weiterhin eindeutig. Protokoll, Bootstrap, Parser und Takeout-Schutz sind unverändert.

Migration 022 erweitert ausschließlich Clock-Sitzplätze auf sechs. Authentifizierte Kontoeinladungen reservieren beim Annehmen einen freien Platz und löschen nur ihre eigene Einladung. Lokale Plätze und gezieltes Entfernen bleiben beim Ersteller/Admin; die interne Spielerberechtigung wird dabei rotiert. Es gibt keine neue Gastanmeldung oder öffentliche Spielercodes. `clock_multiplayer_ready` sperrt die zusätzliche Oberfläche bis zur Migration.

Der vollständige Match-Roster und tatsächliche Gewinner stehen im gespeicherten Turnier-/Spiel-JSON. Die älteren relationalen Matchtabellen besitzen zwei Spielerspalten. `sync_tournament` erstellt für Clock einen Index mit zwei Teilnehmern (nach Abschluss mit dem echten Sieger an erster Stelle); danach wird der öffentliche Snapshot ausdrücklich auf das vollständige Original-JSON zurückgesetzt. API, Spielrechte, Präsenz und Statistiken verwenden das Original mit allen Teilnehmern. X01 wird unverändert an die bisherige Synchronisierung übergeben.

Automatisierte Prüfungen umfassen sechs Plätze, individuelles Entfernen/Nachbesetzen, mehrere parallele Einladungen, Sieg auf Platz drei, vollständigen öffentlichen Snapshot, Ergebnisse/Revanche und Autodarts-Ereignisse über eine stabile simulierte Verbindung. Den Ablauf mit echten Würfen und Kamera nach dem Update am Board prüfen.

## Trainingsabschluss und Zielmodi (023)

Segmenttraining und zufällige Checkouts verwenden dieselbe gespeicherte Scheibe, denselben
GameScreen und dieselben `dart`/`next`-Aktionen. Segmenttraining zählt 30 Darts und wechselt
nach dem Bestätigen zwischen den ausgewählten Segmenten. Checkout-Training speichert zehn
vom Server gezogene, in höchstens drei Darts lösbare Aufgaben im Spiel-JSON. Beide sind solo;
Around the Clock behält bis zu sechs Spieler. Protokoll, Cursor, Takeout-Schlüssel und Socket
bleiben unverändert.

Eine siegreiche Aufnahme wird durch Takeout nicht automatisch bestätigt. Sie bleibt zur
Korrektur offen, bis Ergebnisbestätigung, „Nächstes Leg“, das Kreuz oder der Ablauf der
Gewinneranzeige denselben asynchronen Speicherweg auslösen. Normale Aufnahmen wechseln
weiterhin automatisch beim Herausziehen. Die Gewinneranzeige schließt erst nach bestätigtem
Speichererfolg; ein Fehler bleibt direkt in der Anzeige sichtbar und kann erneut bestätigt werden.
Die API liefert für ein doppeltes finales `next` eines weiterhin berechtigten Teilnehmers den
Endstand zurück. Sitzungs-, Teilnehmer- und Origin-Prüfungen erfolgen davor.

Solo-Clock und Clock mit zwei Spielern schreiben ein reguläres eindeutiges Leg-Ergebnis.
Das funktioniert auch mit dem Trainingsstand 021, der Endergebnisse ohne Leg-Werte ablehnt.
Nur mehr als zwei Clock-Spieler verwenden die Roster-Projektion aus 022. Der gemeinsame
Domain-Helfer `completedGameTournament` wird von der API und den echten SQL-Tests verwendet.

Browsertests senden den letzten Bull, zwei Takeout-Ereignisse und bestätigen dann das Ergebnis.
Zusätzliche Fälle prüfen abgewiesenes Speichern, eine verlorene Antwort nach erfolgreichem
Speichern und erneutes Bestätigen über das Kreuz. Am realen Board weiterhin das schnelle
Herausziehen und anschließende Bestätigen prüfen.

Im Around the Clock und Segmenttraining entfallen Double-/Triple-/Bull-Treffereffekte. Der
Caller nennt das erforderliche Ziel beim Öffnen, beim Zielwechsel und beim Beginn eines neuen
Zugs; reine Polling-Antworten und Fehlwürfe erzeugen keine zusätzlichen X01-Punkteansagen.

Am Matchende heißt die Aktion in der Gewinneranzeige ebenfalls „Weiter“. Jeder erfolgreich
bestätigte finale `next` navigiert unmittelbar zur Trainingsstatistik. Meldet die Schreibantwort
einen Fehler, wird der Spielstand zuvor frisch über die berechtigte GET-Route gelesen: Ein dort
bereits gespeicherter Abschluss führt ebenfalls zur Statistik, ohne eine weitere Schreibaktion.
Ein tatsächlich fehlgeschlagenes Speichern oder eine ungültige Anmeldung wird weiterhin angezeigt.
Ein SQL-Test prüft zusätzlich den vollständigen Solo-Clock-Abschluss des globalen Admins über
`write_owner_game`; das Schließen der Animation ändert weder Cookies noch Kontositzungen.

## Persistierter Turnierstand und Anzeigedaten

`SupabaseRepository.get` ergänzt für die Darstellung den aktuellen `managerName` und
`managerId`. Diese Ergänzungen gehören nicht automatisch zum gespeicherten `state`-JSON.
Die SQL-Score-Prüfung vergleicht die Turnierstruktur vor und nach dem Spielabschluss;
ein neu hinzugefügter Anzeigename wird deshalb mit SQLSTATE 42501 („Strukturelle Änderung
nicht erlaubt“) abgelehnt. Die pauschale API-Meldung dazu wirkte zuvor wie eine abgelaufene
Sitzung, obwohl das Konto gültig blieb.

Die Scoring-API liest für Start, Reset und Abschluss ausdrücklich `get(...,{stateOnly:true})`
unter denselben Zugriffskontrollen und prüft die Turnierversion erneut. Ergebnisänderungen
werden ausschließlich auf diesem unveränderten gespeicherten JSON aufgebaut. Bereits
historisch gespeicherte Felder bleiben erhalten; aktuelle Anzeigezusätze werden nicht
hineinkopiert. Die Oberfläche erhält weiterhin den aktuellen Erstellernamen.

Der Datenbanktest reproduziert die ursprüngliche Ablehnung mit ergänztem Anzeigenamen
bei einer gültigen Kontositzung. Ein weiterer Test führt den tatsächlichen Scoring-POST
mit bestätigtem Konto, angereichertem Lesestand, realem `account_play_session` und realem
`write_game` durch bis zum gespeicherten Clock-Abschluss. Repository- und API-Tests prüfen
zusätzlich Rohstand, Bereichsschutz und Versionskonflikte. Keine SQL-Migration notwendig.

## Mehrere Spielerkonten an einer Scheibe

„Spieler an diesem Gerät“ meldet bis zu fünf weitere bestätigte, vollständig eingerichtete
E-Mail-Konten zusätzlich zum Hauptkonto an. Die zusätzlichen App-Sitzungstokens liegen
AES-GCM-verschlüsselt im HttpOnly-/SameSite-Strict-Cookie `dartbracket_device_accounts`.
Der Cookie ist an den Hash genau dieser Hauptanmeldung gebunden; Kontowechsel und
Abmeldung löschen ihn. Passwörter und Sitzungstokens werden nicht an Browser-JavaScript
zurückgegeben oder im Local Storage gespeichert. Entfernen widerruft nur die zusätzliche
Sitzung dieses Geräts, nicht Anmeldungen desselben Spielers an anderen Geräten.

Für die Anzeige werden die vorhandenen, vom SQL abgeleiteten `account_play_session`-
Spielerzuordnungen zusammengeführt. Jede Schreibaktion und jedes Scheibenbild wird anhand
des handelnden Spielers an dessen eigene abgeleitete Sitzung weitergeleitet. Die SQL-
Schreibrechte werden nicht zusammengeführt. Anwesenheit wird getrennt je Sitzung gemeldet.
Die vorhandenen Admin-Beschränkungen für belegte Seiten gelten weiterhin.

Die Autodarts-Verbindung und der Panel-Scope bleiben beim Hauptkonto. Lediglich der aktive
`actor` wechselt zur nächsten an diesem Gerät angemeldeten Seite, einschließlich Ausbullen
und Bestätigung. Dadurch kann dieselbe Scheibe für beide Konten zählen, ohne bei jedem
Spielerwechsel erneut verbunden zu werden. Die Konten müssen dem Turnier bzw. der Lobby
bereits als Teilnehmer zugeordnet sein. Zusätzliche Anmeldungen übertragen keine
Verwaltungsrechte an das Hauptkonto. Ein SQL-Integrationstest führt beide verifizierten
Konten über den realen Scoring-POST bis zum gespeicherten Ergebnis und prüft die getrennten
Kontostatistiken. Geräte-/Hardwareprüfung mit echter Scheibe bleibt erforderlich.

## Gewinnlegs pro Turnierphase

`scoring.groupLegsToWin` überschreibt ausschließlich für neue Gruppenmatches das gemeinsame
`scoring.legsToWin`; letzteres bleibt das Ziel für K.-o.-Matches. Ohne das optionale Feld
behalten bestehende Turniere in beiden Phasen das bisherige Ziel. `rulesForMatch` wählt beim
Spielstart die Regeln; bereits gestartete `match_games.state.rules` bleiben unverändert.
Die Turniereinstellungen können Gewinnlegs ohne Neuauslosung speichern. Keine neue
SQL-Migration erforderlich.

## DartDeck (024)

DartDeck nutzt denselben `AutodartsPanel`-, Stream- und Cursor-Weg mit
`X-Dartbracket-Dartdeck: LOBBY-ID`. Die API prüft echte, angenommene Lobby-Teilnahme
und löst weiter nur das eigene kontogebundene Autodarts-Profil auf. Der Header ist
kein Zugangsschlüssel. Die Turnier-Kontextprüfung bleibt unverändert.

Der Panel-Scope bleibt pro DartDeck-Lobby stabil; `playerId`, Eingabeberechtigung und
Visit-Key wechseln über die vorhandenen Refs, ohne den Socket pro Zug neu zu verbinden.
Ab Migration 025 verwendet DartDeck ebenfalls `MatchBoard` und den vorhandenen
`useAutodartsImages`-Kamerakanal. Der optionale Kontext wählt ausschließlich den
privaten Bildspeicher `/api/dartdeck-image` statt `/api/game-image`. Der Browser
abonniert dieselben beobachteten Bild-Themen und verwendet denselben Snapshot.
Authentifizierte, angenommene Teilnehmer können die Bilder ihrer Lobby lesen.
Eigene Akteure, Partie-ID, Visit-Key und aktive Seite werden bei jedem Upload
geprüft und unter einer SQL-Zeilensperre erneut bestätigt. Fremde Akteure und alte
Partien dürfen weder Bilder ersetzen noch löschen. Die gemeinsame Downloadfunktion
`server/board-frame.ts` erhält die bisherigen Host-, Größen- und Dateiprüfungen.
Bildfehler blockieren weiterhin keine Würfe. Die X01-Bildroute und ihre Tests
verwenden dieselbe Downloadfunktion; gespeicherte Bilder und Protokoll bleiben erhalten.
Ein Visit-Key enthält Partie-ID, Aufnahmenzahl und Kartengeneration. Ein einstimmiger Skip
ändert die Generation, damit verspätetes Takeout der alten Karte keinen weiteren
Spielerwechsel auslöst. Nach dem Skip müssen eventuell steckende Pfeile regulär
herausgezogen werden. Parser, gemessene Koordinaten und Anbieter-Endpunkte werden
nicht geändert. Siehe [DARTDECK.md](DARTDECK.md) für Einrichtung, Regeln und Grenzen.

## Mobile Safari und mehrere Geräte

Der Server liest den leeren Bootstrap-Stand vor der Ticketausgabe. Das kurzlebige
Ticket wird zuletzt erstellt und danach unmittelbar an den Browser zurückgegeben;
eine langsame State-Anfrage verbraucht damit nicht mehr dessen Gültigkeitszeit.
Ein gespeichertes Token bleibt weiterhin mit dem SQL-Lease geschützt. Eine belegte
Lease liefert HTTP 409 samt `retryAfter`; ausschließlich dieser vorübergehende
Konflikt wird im Browser bis zu viermal wiederholt. Falsche Zugangsdaten, andere
Konflikte und Logins werden nicht automatisch wiederholt.

Nach Rückkehr aus einem verborgenen Safari-Tab, einer wiederhergestellten Seite
(`pageshow.persisted`) oder wieder verfügbarem Netz wird ein frisches Ticket geholt
und genau eine neue Verbindung aufgebaut. Alte Socket-Handler und verspätet
dekodierte Frames werden durch eine Verbindungsgeneration verworfen. Score-Updates
verbinden weiterhin nicht neu. Text-, Blob- und ArrayBuffer-Frames werden größenbegrenzt
und in Empfangsreihenfolge als dasselbe JSON gelesen; Feldparser und Takeout-Regeln
bleiben unverändert. Ein CONNECTING-Socket wartet höchstens zwölf Sekunden.

„Verbindung neu aufbauen“ benötigt weder Abmelden noch Entfernen des gespeicherten
Kontos. „Verbindungsdiagnose kopieren“ enthält nur Verbindungszustand, Öffnungs-/
Nachrichtenzähler, Close-Code, Sichtbarkeit und Eingabestatus, keine Konto-/Board-IDs,
URLs, Cookies oder Tokens. `bootstrapEmpty` ist ausdrücklich vom Empfang echter
Socket-Board-Nachrichten getrennt. Ein physischer iPad-/iPhone-Test bleibt nötig;
Cloud-Verbindungsabbrüche können auch durch Netzwerk oder Inhaltsblocker entstehen.

## Minigames und Dart Bingo

Der sichtbare Bereich heißt Minigames; alte DartDeck-Routen werden weitergeleitet.
Bingo verwendet unverändert den Lobby-Kontext `X-Dartbracket-Dartdeck`, die
vorhandene Kamera-Route und dieselbe stabile AutodartsPanel-Instanz. Nur der
Spielmodus der serverseitigen Spielaktion unterscheidet sich: `dart` und `undo`
verwenden die vorhandene Trefferprüfung, `next` bestätigt die Bingo-Aufnahme und
wechselt den aktiven Spieler. Visit-Key, SQL-Version und eigene Akteurrechte bleiben
maßgeblich. Kein zusätzlicher Socket, keine neuen Provider-Endpunkte, keine
Punkteableitung aus Board-Zählern. Siehe [MINIGAMES.md](MINIGAMES.md).

## Übersprungene lokale Slots nach Fehl-Erkennung

`throwNumber` zählt auch Erkennungen, die außerhalb des eigenen Zugs liegen oder
anschließend manuell zurückgenommen wurden. Deshalb können neue zulässige Board-Slots
1/2 auf eine noch leere lokale Aufnahme treffen. `autodartsSlot` übernimmt solche
Würfe in den nächsten freien lokalen Platz, statt eine Reihenfolge-Ablehnung auszulösen.
GameScreen (einschließlich Ausbullen) und beide Minigames verwenden diese Zuordnung.
Es werden keine fehlenden Würfe oder Miss-Werte ergänzt. Bereits belegte lokale Plätze
werden nicht überschrieben, und volle/beendete Aufnahmen bleiben gesperrt. Ein echter
Miss während der eigenen aktiven Aufnahme zählt weiterhin als Dart und ist korrigierbar.
Stream/Cursor behalten Slot-Deduplizierung, Off-turn-Verbrauch, Empty-/Takeout-Schutz
und die Sperre bei tatsächlich fehlenden oder ungültigen Provider-Nachrichten bei.

## Kurze Verbindungsabbrüche und nachgeholtes Herausziehen

Ein Transportabbruch verwirft keine bereits erfolgreich übernommene `armedVisit` mehr.
Beim Wiederverbinden bestätigt ausschließlich ein authentifizierter HTTP-Board-State
mit `boardEmpty: true` das während der Unterbrechung verlorene Leeren für diese
Aufnahme. Bei einem noch unklaren Ticket-Bootstrap erfolgt nach dem Abonnieren einmalig
`/api/autodarts` operation `state`, mit denselben Kontext-, Boardbesitz-, Origin-,
Sitzungs-, Rate-Limit- und Refresh-Lease-Prüfungen wie ein Ticket. Dabei wird kein
neues Ticket ausgestellt. Die Antwort gilt nur bei unveränderter Aufnahme und wenn
zwischenzeitlich keine neuen Boarddaten ankamen. Die normalen durchgehenden
WebSocket-Nullzähler lösen weiterhin keinen Zugwechsel aus. Ein explizites
Takeout-Ereignis und die Wiederherstellung verbrauchen dieselbe Aktivierung genau
einmal; Match-ID und Akteur müssen weiterhin zur Aktivierung passen; die Match-Handler prüfen den aktuellen Visit-Key erneut. Manuelle Resets und
Kalibrierungsereignisse löschen die Aktivierung weiterhin.

Der Kamerakanal sendet bei einem geschlossenen Transport keinen ausdrücklichen
`clear` mehr. Das letzte autorisierte Bild bleibt dadurch bei kurzen Unterbrechungen
bis zum Ersatz sichtbar; explizites Ausschalten und Berechtigungsentzug löschen es
weiterhin. Vorübergehende Ticket-/Netzwerkfehler verbinden mit Backoff erneut;
eindeutige 400/401/403/404-Ablehnungen stoppen die Verbindung. Echte während eines
Abbruchs nicht übertragene Würfe werden niemals aus Zählern rekonstruiert und müssen
bei Bedarf manuell korrigiert werden. Hardwareprüfung bleibt erforderlich.

## Zusätzliche Eingabequelle Handykamera

Mit Migration 026 gibt es eine separat freigeschaltete Handykamera-Erkennung auf Basis von InstaDarts. `ScoringSource` wählt pro Spielgerät zwischen Manuell, bestehendem AutodartsPanel und Handykamera. Der Autodarts-Parser, Broker, Tickets und Bilddownload bleiben erhalten. Die vorhandenen Bildrouten können nach ihrer unveränderten Zuschauer-/Matchberechtigung alternativ ein gespeichertes Handykamerabild liefern. Details zu Scope, Koordinaten, Lizenz und Hardwareprüfung: [HANDYKAMERA.md](HANDYKAMERA.md).
