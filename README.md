# LMA Coop – Publikationen gemeinsam schreiben

[![Lizenz: AGPL-3.0-or-later](https://img.shields.io/badge/Lizenz-AGPL--3.0--or--later-blue.svg)](LICENSE)

Freie Open-Source-Software von Janne Cadamuro / [LabMed Alliance](https://labmedalliance.com), lizenziert unter der
GNU Affero General Public License v3.0 or later mit Zusatzbedingungen in [NOTICE](NOTICE). Details im Abschnitt
[Lizenz](#lizenz).

Selbst gehosteter Editor im Stil von Google Docs für wissenschaftliche Publikationen. Mehrere Personen bearbeiten
dasselbe Dokument gleichzeitig und sehen die Cursor der anderen.

Zusatzfunktion für Publikationen: eine **Literaturliste pro Dokument**. Du fügst Quellen per DOI oder PMID ein
(Crossref bzw. PubMed). Zitate im Text nummerieren sich automatisch nach der Reihenfolge des ersten Auftretens
(`[1–3, 5]`). Am Ende des Dokuments entsteht das Literaturverzeichnis im Vancouver-Stil. Der Export nach Word
(`.docx`) übernimmt Zitate und Literaturverzeichnis.

## Funktionen

- Echtzeit-Kollaboration (Yjs-CRDT über Hocuspocus), Cursor mit Namen, Anwesenheitsanzeige
- Offline-fest: Änderungen ohne Verbindung werden beim Wiederverbinden nachgereicht
- Schalter **Automatisch speichern** (Standard: ein, Einstellung pro Browser). Ausgeschaltet gehen deine
  Änderungen erst mit **Speichern** oder Strg+S an den Server; Änderungen anderer siehst du weiter live. Nach
  jedem bestätigten Speichern erscheint 3 Sekunden lang ein grünes Speicher-Symbol
- Formatierung: Überschriften, fett, kursiv, unterstrichen, durchgestrichen, hoch-/tiefgestellt, Links, Listen,
  Zitatblock, Ausrichtung, Tabellen
- Literatur: DOI/PMID-Abfrage, Mehrfachzitate, automatische Nummerierung, Literaturverzeichnis
- Export als `.docx`, Drucken bzw. PDF über den Browser
- Wort- und Zeichenzählung
- Login mit Benutzerkonten, Dokumentliste mit Suche, Löschen mit „Rückgängig"
- Freigabe pro Dokument mit Rollen, Vorschlagsmodus (Änderungen nachverfolgen), Benutzerverwaltung für Admins
- Kommentare wie in Google Docs, im Bearbeiten- und im Vorschlagsmodus (siehe unten)
- Bilder (PNG, JPEG, GIF, WebP, bis 10 MB): Knopf **Bild einfügen**, aus der Zwischenablage einfügen (z. B.
  Screenshot) oder ins Dokument ziehen. Ein Bild steht wie in Google Docs im Absatz; die Ausrichtungsknöpfe
  zentrieren es. Ein Klick aufs Bild zeigt **25 % / 50 % / 75 % / 100 %** Breite und **Bildbeschreibung**
  (Alternativtext). Im Vorschlagsmodus lassen sich Bilder als Vorschlag einfügen oder löschen, Größe und Beschreibung
  ändern nur Personen mit „Bearbeiten". Der Word-Export übernimmt Bilder mit Breite und Beschreibung
- Menü bei Textauswahl: **Kopieren**, **Ausschneiden**, **Kommentieren**, **Löschen**. Es erscheint über dem
  markierten Text (auf Touch-Geräten darunter, neben dem Systemmenü), Escape blendet es aus. Im Vorschlagsmodus werden
  Ausschneiden und Löschen zu Vorschlägen
- Oberfläche auf Deutsch (Standard) oder Englisch: Knopf **EN**/**DE** in der Kopfzeile, Einstellung pro Browser.
  Die Texte stehen in `client/src/i18n.js`; der deutsche Text ist der Schlüssel. Fehlermeldungen des Servers
  übersetzt der Browser. Der Word-Export nutzt die gewählte Sprache für „Literatur"/„References"

## Rollen und Vorschläge

Ein neues Dokument sieht nur die Person, die es anlegt. Über **Freigeben** gibt sie es anderen frei:

| Rolle | Darf |
|---|---|
| Eigentümer:in | alles, inkl. Freigeben und Löschen |
| Bearbeiten | direkt ändern, umbenennen, Vorschläge annehmen oder ablehnen, Quellen entfernen |
| Vorschlagen | nur Änderungen vorschlagen; Quellen hinzufügen, aber nicht entfernen |

**Zugriff beantragen:** Die Dokumentliste zeigt unter **Weitere Dokumente** Titel und Eigentümer:in aller
Dokumente, auf die du keinen Zugriff hast. Die Inhalte bleiben bis zur Freigabe gesperrt. Ein Klick auf so ein
Dokument (oder ein geteilter Link) öffnet die Antragsseite: dort **Vorschlagen** oder **Bearbeiten** beantragen. Wer nur vorschlagen darf, beantragt über **Bearbeiten beantragen** in der Kopfzeile mehr
Rechte. Die Eigentümer:in sieht offene Anträge als Zahl am Knopf **Freigeben**, als Hinweis im geöffneten Dokument
und in der Dokumentliste. Im Freigabe-Dialog nimmt sie an (Rolle wählbar) oder lehnt ab, beides mit „Rückgängig".
Nach dem Annehmen öffnet sich das Dokument bei der antragstellenden Person von selbst.

Im **Vorschlagsmodus** erscheinen Einfügungen grün, Löschungen rot durchgestrichen, Formatänderungen gestrichelt.
Personen mit „Bearbeiten" können selbst zwischen **Bearbeiten** und **Vorschlagen** umschalten. Die Seitenleiste
**Vorschläge** listet alle offenen Vorschläge mit Autor:in; dort nimmst du sie einzeln oder alle an oder lehnst sie ab.
Der Word-Export übernimmt Vorschläge im Fließtext als Word-Änderungsverfolgung.

Der Server setzt die Rolle „Vorschlagen" selbst durch: Jedes Update einer solchen Person muss nach Rücknahme aller
Vorschläge denselben Text ergeben wie vorher (`server/suggestion-guard.js`). Sonst trennt er die Verbindung, und der
Browser lädt neu.

Grenzen im Vorschlagsmodus: Listen, Zitatblöcke und Tabellen lassen sich nicht als Vorschlag anlegen oder umbauen,
nur direkt bearbeiten. Die verwendete Bibliothek kann solche Vorschläge nicht zuverlässig zurücknehmen.

**Admins** verwalten unter `/admin` Konten: anlegen, Passwort zurücksetzen, Admin-Rolle vergeben, löschen. Dokumente
anderer sehen sie nur nach Freigabe. Beim Löschen einer Person gehen ihre Dokumente an den löschenden Admin. Das
erste Konto ist automatisch Admin.

## Kommentare

Text markieren, dann **Kommentar** in der Werkzeugleiste oder Strg+Alt+M. Der kommentierte Text wird gelb hinterlegt.
Die Seitenleiste **Kommentare** zeigt alle offenen Kommentare in Textreihenfolge; die Zahl am Knopf zählt sie. Ein
Klick auf hinterlegten Text öffnet den passenden Kommentar, ein Klick auf den Kommentar markiert den Text.

| Aktion | Wer darf |
|---|---|
| Kommentieren, antworten, als erledigt markieren, wieder öffnen | alle mit Zugriff, auch „Vorschlagen" |
| Kommentar bearbeiten | nur die Person, die ihn geschrieben hat |
| Kommentar oder Antwort löschen (mit „Rückgängig") | Autor:in sowie Eigentümer:in und „Bearbeiten" |

Eine Antwort öffnet einen erledigten Kommentar wieder. Erledigte Kommentare blendest du mit **Erledigte anzeigen**
ein. Löschst du den ersten Kommentar, verschwindet der ganze Verlauf. Ist der kommentierte Text gelöscht, bleibt der
Kommentar mit durchgestrichenem Zitat am Ende der Liste. Der Word-Export übernimmt Kommentare samt Antworten und
Status „erledigt" als Word-Kommentare.

Technik: Kommentare und Antworten liegen in der Tabelle `comments` (`server/comments.js`). Im Text steht nur ein
Anker, die Marke `comment` mit der Kommentar-ID (`client/src/comment-mark.js`). Die Vorschlagsprüfung ignoriert
diese Marke, deshalb dürfen auch Personen mit „Vorschlagen" kommentieren. Bei ausgeschaltetem automatischem Speichern
erreicht der Anker die anderen erst mit **Speichern**; der Kommentar selbst erscheint sofort.

## Technik

| Teil | Wahl |
|---|---|
| Server | Node.js ≥ 22.13, Express 5, Hocuspocus 4 (Yjs), `ws` |
| Datenbank | SQLite über das eingebaute `node:sqlite` (keine nativen Module) |
| Editor | TipTap 3 (ProseMirror), gebaut mit Vite |
| Vorschläge | `@handlewithcare/prosemirror-suggest-changes` (MIT) |
| UI | Tabler (lokal gebündelt, kein CDN) |

Server, API und WebSocket laufen auf **einem Port**. Der WebSocket-Pfad ist `/collab`.

Bilder liegen in der Tabelle `images` (`server/images.js`), nicht im Yjs-Dokument. Das Dokument speichert nur die
Adresse `/api/docs/<dokument>/images/<id>`. Ausgeliefert wird nur an Personen mit Zugriff auf das Dokument. Der
Server erkennt den Bildtyp am Dateiinhalt; SVG ist ausgeschlossen, weil es Skripte enthalten kann.

## Lokal starten

```bash
npm install
npm run build
npm run adduser -- anna "Anna Muster"   # fragt verdeckt nach dem Passwort; erstes Konto wird Admin
npm start                                 # http://127.0.0.1:5200
```

Weitere Admins: `npm run adduser -- <name> "<Anzeigename>" --admin` oder über `/admin`.

Tests: `npm test` (Lizenz- und Branding-Dateien vorhanden, Übersetzungen vollständig, Zitatlogik, Login, Dokument-API, Rollen und Freigaben, Admin-API, Echtzeit-Sync,
serverseitige Vorschlagsprüfung, Kommentare und ihre Rechte).

## Konfiguration

Umgebungsvariablen, keine davon ist ein Secret:

| Variable | Standard | Zweck |
|---|---|---|
| `PORT` | `5200` | HTTP-Port |
| `HOST` | `127.0.0.1` | Bind-Adresse |
| `DATA_DIR` | `./data` | Ort der SQLite-Datei `docs.sqlite` |
| `COOKIE_SECURE` | – | `1` hinter HTTPS: Cookie nur über HTTPS, HSTS an |
| `TRUST_PROXY` | – | Hinter Reverse Proxy `loopback` setzen, sonst gilt die Login-Sperre für alle gemeinsam |

## Betrieb

LMA Coop braucht nur Node.js ≥ 22.13 und läuft als ein einziger Prozess. So betreibst du es auf einem Server:

1. Repo klonen, `npm ci` und `npm run build` ausführen.
2. Das erste Konto mit `npm run adduser -- <name> "<Anzeigename>"` anlegen. Es wird Admin.
3. `npm start` dauerhaft laufen lassen, z. B. mit systemd oder supervisord.
4. Einen Reverse Proxy mit HTTPS davorschalten. Er muss WebSockets auf `/collab` weiterleiten.
5. Dahinter `COOKIE_SECURE=1` und `TRUST_PROXY=loopback` setzen.

Update: `git pull && npm ci && npm run build`, dann den Prozess neu starten.

Backup: Alle Daten liegen in `DATA_DIR/docs.sqlite`, auch Kommentare und Bilder. Sichere die Datei regelmäßig, zum
Beispiel per Cron mit `sqlite3 data/docs.sqlite ".backup <ziel>"`. Das ist auch bei laufendem Server sicher.

## Sicherheit

- Passwörter mit scrypt und Salt, Sessions als zufällige Token in `HttpOnly`-, `SameSite=Lax`-Cookies
- Login-Sperre nach 10 Fehlversuchen pro IP in 15 Minuten, gleiche Antwortzeit für unbekannte Benutzernamen
- Origin-Prüfung für schreibende API-Aufrufe und den WebSocket-Handshake
- Content-Security-Policy ohne Fremd-Hosts; `style-src 'unsafe-inline'` ist nötig, weil der Editor
  Inline-Styles setzt
- DOI/PMID-Abfrage nur an `api.crossref.org` und `eutils.ncbi.nlm.nih.gov`, die Eingabe wird vorher geprüft
- Rechte pro Dokument werden für API und WebSocket geprüft; bei Rechteänderung trennt der Server die offenen
  Verbindungen der betroffenen Person
- Passwort-Reset durch Admins beendet alle Sitzungen der Person

## Wer es gebaut hat

LMA Coop wurde von **Janne Cadamuro / LabMed Alliance Inc.** entworfen und entwickelt.

Copyright © 2026 Janne Cadamuro / LabMed Alliance Inc.

Die App zeigt das auch selbst: Jede Seite trägt unten den Hinweis *Powered by LabMed Alliance* mit LMA-Logo, im
Editor in der Statusleiste. Daneben führt ein Link auf `/about`. Diese Seite nennt Urheber, Lizenz und den Link zum
Quellcode und ist auch ohne Anmeldung erreichbar. Die Angaben stehen fest in
[`client/src/attribution.js`](client/src/attribution.js), nicht in der Datenbank. Keine Einstellung kann sie
entfernen. Kopfzeilen-Logo, Favicons und App-Icons (`client/public/img/`) stammen aus dem LMA-Logo.

## Lizenz

LMA Coop ist freie Open-Source-Software unter der **GNU Affero General Public License v3.0 or later**
(`AGPL-3.0-or-later`), mit Zusatzbedingungen nach AGPL Abschnitt 7. Den Lizenztext findest du in
[LICENSE](LICENSE), die Zusatzbedingungen in [NOTICE](NOTICE).

Du darfst:

- LMA Coop für dich oder deine Organisation betreiben, kommerziell oder nicht;
- den Quellcode lesen, anpassen und darauf aufbauen;
- die Software weitergeben, verändert oder unverändert.

Unter diesen Bedingungen:

- **Gleiche Lizenz.** Was du darauf aufbaust, muss ebenfalls unter der AGPL stehen.
- **Auch beim reinen Betrieb.** Wenn du eine veränderte Version als Webdienst betreibst, biete den Nutzer:innen
  den Quellcode an (AGPL Abschnitt 13). Setz dazu `SOURCE_URL` in `client/src/attribution.js` auf dein Repo.
- **LabMed-Alliance-Hinweis bleibt.** Der Hinweis *Powered by LabMed Alliance* und die Seite `/about` bleiben auf
  jeder Seite sichtbar (NOTICE, Punkt 1). Eigene Hinweise darfst du daneben setzen.
- **Änderungen kennzeichnen.** Gib an, dass deine Version verändert ist. Stell sie nicht als Original oder als von
  LabMed Alliance unterstützt dar (NOTICE, Punkt 2).
- **Neuer Name für veränderte Versionen.** „LabMed Alliance", „LMA", „LMA Coop" und das LMA-Logo sind nicht
  lizenziert (NOTICE, Punkt 3). Unveränderte Kopien dürfen als *LMA Coop* laufen. Eine veränderte Version braucht
  eigenen Namen, eigene Icons und ein eigenes Kopfzeilen-Logo; sie darf sich „basiert auf LMA Coop" nennen. Logo und
  Icons in `client/public/img/` fallen nicht unter die AGPL.
- **Keine Gewährleistung.** Die Software wird ohne Gewähr bereitgestellt.

### Aufgebaut auf

| Komponente | Lizenz |
|---|---|
| Express, `ws` | MIT |
| Hocuspocus, Yjs, `y-tiptap` | MIT |
| TipTap, ProseMirror | MIT |
| `@handlewithcare/prosemirror-suggest-changes` | MIT |
| `docx` | MIT |
| Tabler, Tabler Icons | MIT |
| Vite (nur Build) | MIT |

## Mitwirken

Issues und Pull Requests sind willkommen. Code, Kommentare und Commit-Messages sind auf Englisch. Mit deinem Beitrag
stimmst du zu, dass er unter denselben Bedingungen lizenziert ist (`AGPL-3.0-or-later` mit den NOTICE-Bedingungen).
