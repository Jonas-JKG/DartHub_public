# DartDeck

DartDeck ist eine eigene Registerkarte unter `/dartdeck`, mit eigenen privaten Lobbys.
Es verwendet dieselben bestätigten Konten, die bestehende Spielersuche/Freundesliste und
gespeicherte Autodarts-Verknüpfungen. Es gibt keine zusätzlichen Anmeldecodes und keine
Spieler-Einladungslinks. Lokale Spieler gehören zum Konto des Lobby-Erstellers. Die
Teilnehmerzahl ist nicht auf zwei oder sechs begrenzt; praktische Hosting-/Antwortgrößen
bleiben wie bei jeder Online-Lobby begrenzt.

## Einrichtung

Nach Migration 023 die Dateien `supabase/migrations/024_dartdeck.sql` und anschließend
`supabase/migrations/025_dartdeck_images.sql` im SQL Editor des
bestehenden Supabase-Projekts vollständig ausführen. Beide sind wiederholbar und erhalten
bestehende Turniere und Trainingslobbys. Keine neuen Umgebungsvariablen erforderlich.
Ohne die Migration zeigt nur DartDeck einen Einrichtungshinweis; die bisherigen Spiele
verwenden unverändert ihre bestehenden Tabellen und Routen.

024 legt `dartdeck_rooms` und `dartdeck_members` an. Anonyme/öffentlich angemeldete
Supabase-Clients erhalten darauf keine direkten Rechte. Die serverseitige App-Sitzung
wird für jede Aktion geprüft. Lobby-Änderungen und Spielaktionen werden mit Zeilensperre
und Versionsvergleich gespeichert. Die vorhandenen Friends-Funktionen werden um
DartDeck-Einladungen ergänzt; die bisherigen Einladungen werden weiter verarbeitet.

Während einer Partie gibt es eine eigene Spielansicht ohne App-Seitenmenü und Kopfzeile.
Nur der aktive Spieler wird mit Karte, Punkten und Eingabe hervorgehoben; rechts stehen
die übrigen Mitspieler mit ihrem Punktestand und ggf. Skip-Stimme. Zusätzliche
Konten/Autodarts und Regeln sind über das kleine Einstellungsrad erreichbar.

DartDeck fordert beim Starten direkt im Klickereignis Vollbild an. Bei einem bereits
laufenden Spiel wird es beim Öffnen versucht; blockiert der Browser den automatischen
Aufruf, versucht die nächste Interaktion es erneut und der Vollbild-Knopf im oberen Match-Balken bleibt
verfügbar. Eine bewusst verlassene Vollbildansicht wird nicht bei jedem Wurf erneut geöffnet.

Kurze, selbst erzeugte Sounds begleiten passende Treffer, Fehlwürfe, erfüllte Aufgaben,
Spielerwechsel, Skip und Spielende. Es gibt keine Zahlenansagen und keinen Caller.
Die Sounds und ihre Lautstärke werden pro Gerät im Einstellungsrad gespeichert.
Safari aktiviert Audio beim ersten Klick oder Tastendruck; Standabfragen spielen
keine Effekte erneut ab. Die Gewinneranimation verwendet zusätzlich die bereits vorhandene Siegesmusik;
„Ergebnis ansehen“, das Schließen oder der Ablauf der Animation öffnet die bereits
gespeicherte Ergebnissicht, ohne eine weitere Score-Aktion. Ein Skip wird 1,8 Sekunden
lang sichtbar bestätigt; derselbe Spieler und seine neue Karte bleiben bedienbar.

## Ablauf

1. Ein Spieler oder der besondere Admin eröffnet eine Lobby und wählt Aufnahmen pro
   Spieler (1–50, Standard 10) und Schwierigkeit.
2. Über die Kontosuche können beliebig weitere Spieler eingeladen werden. Einladungen
   erscheinen im Freunde-Tab samt Benachrichtigung und auf der DartDeck-Übersicht.
   Zusätzlich können lokale Namen für Spieler am selben Gerät hinzugefügt werden.
3. Eingeladene Konten müssen selbst annehmen. Vor dem Start müssen offene Einladungen
   angenommen oder vom Ersteller entfernt werden. Die Teilnehmerliste bleibt während
   der Partie fest. Nur der Ersteller bzw. Admin verwaltet die Lobby.
4. Alle spielen nacheinander auf eine gemeinsame Aufgabenkarte, mit bis zu drei Darts.
   Bei Erfolg gibt es die Kartenpunkte plus Bonus und der Nächste zieht eine neue Karte.
   Bei Misserfolg versucht der Nächste dieselbe Karte. Nach einem vollständigen
   erfolglosen Umlauf steigt der Wert um einen Bonuspunkt; nach zwei Umläufen wird
   die Karte ersetzt.
5. Vote Skip ist pro Teilnehmer, nicht pro Gerät. Erst bei Einstimmigkeit wird neu
   gezogen: gleicher Spieler, drei neue Darts, keine verbrauchte Aufnahme. Stimmen
   können zurückgezogen werden. Sie gelten nur für diese konkrete gezogene Karte.
   Auch offline befindliche Mitspieler gehören weiter zum Quorum. Lokale Mitspieler
   stimmen auf dem Gerät ihres Erstellers über ihren jeweiligen eigenen Knopf ab.
6. Jeder erhält gleich viele Aufnahmen. Höchste Punktzahl gewinnt; Gleichstände werden
   als gemeinsame Gewinner angezeigt. Danach bleiben Ergebnis und Statistik erhalten.
   Eine Revanche führt zurück in dieselbe Lobby, wo Teilnehmer und Regeln wieder
   bearbeitet werden können. Die Lobby kann endgültig gelöscht werden.

Der vollständige Originalstapel enthält 223 verschiedene, in höchstens drei Darts
lösbare Aufgaben: einzelne Zahlenfelder, wiederholte Treffer, bestimmte Singles/Doubles/
Triples, Zahlenkombinationen, genaue bzw. minimale Punktsummen, Bull und gerade/ungerade
Zahlenfelder. Die Spielstärken lauten Leicht, Mittel und Schwer. Leicht enthält einfache
Zahlentreffer, Mindestwerte bis 60 und exakte Summen bis 20. Mittel ergänzt
zwei Zahlentreffer, Zahlenpaare, gerade/ungerade Felder, einen Bull, ein frei
gewähltes Doppel, Mindestwerte bis 100 und exakte Summen bis 60. Schwer enthält
auch feste Doppel/Triple, mehrere Bulls und exakte Summen über 60. Die Stufen
überschneiden sich. Intern bleibt `mixed` für Mittel kompatibel mit alten Lobbys;
laufende Partien behalten ihren bereits gespeicherten Kartenstapel. Vor dem
Start wird auf dem Server mit `crypto.randomInt` gemischt. Bis zum Ende des gewählten
Stapels wiederholt sich keine gezogene Karte; danach beginnt der Stapel erneut.
Die restliche Ziehreihenfolge wird nicht an die Clients ausgegeben.

Bei Trefferaufgaben zählt ein Double/Triple als ein Treffer. Bei Summenaufgaben gilt
sein normaler Punktwert. Es gibt keine X01-Bust- oder Double-Out-Regel. Exakte Summen
können bereits vor dem dritten Dart bestätigt werden. Korrekturen sind bis zur
Bestätigung möglich; herausgezogene oder manuell bestätigte Aufnahmen werden nicht
noch einmal weitergeschaltet.

## Geräte, Rechte und Autodarts

Ein Konto darf ausschließlich für seine eigenen Teilnehmer sowie für die ihm gehörenden
lokalen Namen Würfe eintragen und abstimmen. Zusätzlich angemeldete echte Konten unter
„Spieler an diesem Gerät“ können dieselbe Scheibe nutzen. Der besondere Admin kann
Lobbys verwalten, aber keine Skip-Stimmen fremder Konten fingieren.

DartDeck verwendet `AutodartsPanel` mit einem eigenen authentifizierten Lobby-Kontext.
Cloud-Endpunkte, gespeicherte Provider-Tokens, Parser, Cursor und das serielle Verarbeiten
von Würfen werden wiederverwendet. Ein frei behaupteter Lobby-Header erteilt keine
Berechtigung; er wird gegen bestätigte Teilnahme geprüft. Nur eigene Anbieter-Boards
können verbunden werden. Die Verbindung bleibt bei Spielerwechseln bestehen.
DartDeck verwendet denselben `MatchBoard`, denselben Kamerakanal und dieselben
Kameraeinstellungen wie X01. Die Bilder werden über `/api/dartdeck-image` in der
privaten Tabelle `dartdeck_board_images` geteilt. Nur akzeptierte Teilnehmer bzw.
der Admin dürfen lesen; schreiben darf ausschließlich der Controller des eigenen
Spielers. Partie, Aufnahme, aktive Seite und Upload-Reihenfolge werden serverseitig
und in der SQL-Transaktion geprüft. Die Bilddaten verändern keine Spielversion.
Der gemeinsame Downloader erlaubt nur die bisherige Anbieteradresse, Rasterformate
mit passender Dateisignatur und maximal 1 MB; keine Redirects oder Anbieter-URLs
werden an Mitspieler weitergegeben. Normale Turnier-/Trainingsbilder bleiben erhalten.
Beim Spielerwechsel wird wie in X01 zuerst das leere Bild dieses Spielers angezeigt.
Die Tastaturansicht blendet das Bild wie im normalen Match aus.

Takeout-Schlüssel bestehen aus einer eindeutigen Partie-ID, bestätigten Aufnahmen und einer Kartengeneration.
Ein Skip mit bereits steckenden Darts ersetzt die Generation. Das spätere Herausziehen
bestätigt daher niemals versehentlich die neue Karte oder schaltet den Spieler weiter.
Bereits geworfene Darts übersprungener Versuche bleiben in der Dart-Statistik enthalten.
Skip-Stimmen sind ebenfalls an Partie-ID und Kartenziehung gebunden. Simultane Stimmen verwenden explizite Zustimmung/Ablehnung und werden bei
Versionskonflikten auf derselben Karte erneut berechnet; sie können keine andere Karte
überspringen. Die Standversion wird in jeder Schreibtransaktion erneut geprüft.

Automatisierte Prüfungen decken Kartenlösbarkeit, Kartenvielfalt, Zug-/Skip-Regeln,
Rollen, zusätzliche Gerätekonten, echte SQL-Schreibwege, zeitgleiche Stimmen,
Migration-Wiederholung und alte Trainingseinladungen ab. Browsertests prüfen Lobby und
Spiel über getrennte Geräte. Ein echter Hardwaretest mit Autodarts bleibt erforderlich.

## Tempo-Wertung für neue Partien

Die bisherigen Grundwerte werden mit vier multipliziert: **4, 8 oder 12 Punkte**.
Der Bonus nach einer erfolglosen Runde entspricht ebenfalls vier Punkten. Zusätzlich
gibt es beim ersten erfolgreichen Abschluss mit Dart 1 **2 Punkte**, mit Dart 2
**1 Punkt**, mit Dart 3 keinen Tempo-Bonus. „Triff die 20“ ergibt 6 / 5 / 4 Punkte.
Zwei erforderliche Treffer bringen bei zwei Darts 9, bei drei Darts 8 Punkte;
drei nötige Treffer bleiben bei 12 Punkten. Damit bleibt die Gewichtung der
vorherigen Viertelpunkt-Wertung erhalten, während neue Partien nur ganze Punkte zählen.

Es zählt der früheste erfolgreiche Präfix der endgültig korrigierten Aufnahme.
Weitere Darts nach Erfolg löschen den Bonus nicht und geben keine zusätzlichen
Kartenpunkte. Ein exaktes Punkteziel muss am Ende weiterhin stimmen. Korrekturen
und Undo berechnen den Abschluss neu. Vorschau und serverseitige Bestätigung
verwenden dieselbe Funktion.

Neue Partien tragen `scoringVersion: 3`. Partien mit Version 2 werden vollständig auf die
vierfache Ganzzahlskala umgerechnet: alle bereits gewonnenen Punkte und Tempo-
Boni sowie die folgenden Aufnahmen. Das ändert keine relativen Punktabstände.
Die Projektion gilt auch für die Ergebnisanzeige; die nächste Spielaktion speichert
die Umrechnung. Wiederholtes Lesen/Schreiben vervierfacht nicht erneut.
Sehr alte Partien ohne Version behalten ihre ursprünglichen ganzen Punkte;
eine Revanche verwendet immer die neue Ganzzahlwertung. Gewonnene Karten speichern
`tempoBonus` und `completedWith` neben dem maßgeblichen `won`-Wert. Keine neue
SQL-Migration oder Umgebungsvariable erforderlich.
