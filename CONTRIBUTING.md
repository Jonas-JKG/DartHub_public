# Entwicklung

Zuerst [Setup](docs/SETUP.md) lesen. Änderungen an Spielregeln gehören in die Domänenlogik; Berechtigungsprüfungen nicht nur in der Oberfläche umsetzen. Datenbankänderungen als nächste nummerierte Migration hinzufügen, bestehende Migrationen nicht nachträglich umschreiben.

```bash
npm ci
npm test
npm run build
npm run typecheck
```

Der Build erzeugt die für manche TypeScript-Prüfungen benötigten Next.js-Typen. Für Kameraänderungen zusätzlich die entsprechenden Hardware-Grenzen in der Dokumentation beachten. Vor Änderungen am Autodarts-Protokoll den [Schnittstellenleitfaden](docs/AUTODARTS_SCHNITTSTELLE.md) lesen.

`npm run test:e2e` verwendet Playwright. Die vorhandene Konfiguration erwartet Microsoft Edge für Desktop und Chromium für die mobile Ansicht; benötigte Browser installieren oder die Konfiguration an die lokale Umgebung anpassen. Tests für ein aufgenommenes Caller-Paket benötigen dessen getrennte Installation und ein damit gebautes Frontend; sie werden ohne aktivierte Paket-Variable übersprungen. Keine lizenzierten Aufnahmen als Testfixtures einchecken.

Vor einem Push `git diff --cached` kontrollieren: keine `.env`, Schlüssel, Diagnoseaufzeichnungen, Datenbank-Dumps oder fremden Audio-Pakete hinzufügen. Für öffentliche Commits eine GitHub-Noreply-Adresse verwenden. Tests enthalten absichtlich künstliche Zugangsdaten und Beispielkonten; niemals durch echte Werte ersetzen.
