# Autodarts-Scheibenbild in Dartbracket V2

Technischer Leitfaden für Entwickler und KI-Assistenten: [Autodarts-Schnittstelle](AUTODARTS_SCHNITTSTELLE.md).

## Einmal einrichten

1. In der **bestehenden Version-2-Datenbank** im Supabase SQL Editor die gesamte Datei [010_device_settings.sql](../supabase/migrations/010_device_settings.sql) ausführen. Sie ergänzt eine Tabelle und eine Funktion; bestehende Turniere bleiben erhalten.
2. Die neue Version auf Vercel bereitstellen lassen und die Matchseite neu laden.
3. Vor dem Match in der Übersicht **Meine Einstellungen → Deine Scheibe · Autodarts** öffnen, mit deinem eigenen Autodarts-Konto anmelden, deine Scheibe auswählen und verbinden.
4. **Kamerabild für beide Spieler** eingeschaltet lassen. Kamera 1, 2 oder 3 wählen; verwendet wird das entzerrte Bild dieser Kamera.

Dein Gegner braucht keinen Autodarts-Zugang, wenn er manuell spielt. Wenn er ebenfalls ein Board hat, verbindet er es mit seinem eigenen Konto auf seinem Gerät.

## Verhalten im Match

- Beide Spieler und Zuschauer sehen bei gewählter Scheibenansicht das aktuelle Scheibenbild des Spielers am Zug.
- Die ausgewählte Scheibe verbindet sich beim nächsten Match automatisch. Mehrere reservierte Spieler können ein Gerät und Board gemeinsam nutzen.
- Hat dieser Spieler kein verfügbares Kamerabild, erscheint die gezeichnete Scheibe. Auf Handys wird ausschließlich die gewählte Eingabe angezeigt: Tastatur oder Scheibe mit Kamerabild.
- Das Bild wird nach Bildmeldungen von Autodarts aktualisiert, normalerweise nach einem Wurf. Es ist kein dauerhafter Videostream.
- Manuelles Klicken und Korrigieren funktioniert weiter, auch auf dem entzerrten Bild. Trefferpunkte werden darüber angezeigt.
- Beim Ausbullen können alle über die beiden Schaltflächen auswählen, welche Spielerscheibe sie sehen möchten. Beide Spieler können gleichzeitig ausbullen; deshalb gibt es dort keine gemeinsame aktive Spielerscheibe.
- Bildfehler stoppen die automatische Punkteingabe nicht. Nach 45 Sekunden ohne Aktualisierung wird das gespeicherte Bild der leeren Scheibe verwendet, sofern vorhanden; sonst die gezeichnete Scheibe.

## Was bereits geprüft ist

Bildkanal, Thema und Snapshot-Anfrage wurden im öffentlich ausgelieferten Code der offiziellen Webseite [play.autodarts.com](https://play.autodarts.com/) nachvollzogen. Browser-Tests mit Ersatzbildern prüfen beide Spieler, Zuschauer, Handyansicht, manuelle Eingabe, Spielerwechsel und zwei getrennte Boards. Ein echtes Kamerabild aus deinem Konto muss noch mit angeschlossenem Board getestet werden. Anbieteränderungen oder Bildberechtigungen können weiterhin Einfluss haben.

Verwendet werden der vorhandene Cloud-WebSocket und das Thema `autodarts.boards.images / BOARD-ID.live?cam=0&warp=true`. Einmal pro Bildverbindung wird auf einer leeren Scheibe außerdem über `/bs/v0/boards/BOARD-ID/img/live?cam=0&warp=true` ein aktuelles Bild angefragt. Die drei Kameras werden weiterhin ausschließlich von Autodarts geöffnet.

Dartbracket übernimmt das aktuelle Bild über seinen Server und speichert pro Spieler und Match die letzte Aufnahme und ein Bild der leeren Scheibe. Dieses Startbild steht beim Zugwechsel sofort zur Verfügung. Zugangstokens und kurzlebige Autodarts-Bildlinks werden nicht an Zuschauer weitergegeben. Die Bildtabelle ist für direkte öffentliche Datenbankzugriffe gesperrt; der Leseweg prüft Turniersichtbarkeit, Aufnahme, Spielerzuordnung und Sitzungsalter. Unveränderte Bilder werden nicht bei jedem Spielstandabruf neu übertragen.

## Wenn kein Bild erscheint

Zuerst auf der offiziellen Autodarts-Seite prüfen, ob dieselbe Scheibe ein entzerrtes Bild zeigt. Dann in Dartbracket einen Dart werfen und im Seitenmenü den Bildstatus und eine mögliche Fehlermeldung prüfen. Gegebenenfalls eine andere der drei Kameras auswählen.

Das Diagnoseprogramm ist jetzt unter [tools/autodarts/Autodarts-Diagnose.cmd](../tools/autodarts/Autodarts-Diagnose.cmd). Es zeichnet echte Wurf- und Bildmeldungen auf. Bildadressen und Zugangsdaten werden entfernt; gespeichert werden nur Übertragungsstatus und Metadaten. Die Aufzeichnungen bleiben lokal unter `tools/autodarts/recordings/` und werden nicht auf GitHub hochgeladen.
