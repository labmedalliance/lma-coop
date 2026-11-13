// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// UI language: German (default) or English, chosen per browser.
// German text is the key; EN maps it to English. Missing keys fall back to German.
// Also imported on the server (via schema.js), where it always returns German.

const STORAGE_KEY = 'lang';
export const LANGUAGES = ['de', 'en'];

function savedLang() {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return LANGUAGES.includes(value) ? value : 'de';
  } catch {
    return 'de';
  }
}

export const lang = savedLang();
export const locale = lang === 'en' ? 'en-GB' : 'de-AT';

export function setLang(value) {
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* not persisted */ }
  window.location.reload();
}

export const EN = {
  // Shared, navigation, login
  'LMA Coop': 'LMA Coop',
  'Dokumente': 'Documents',
  'Benutzer': 'Users',
  'Abmelden': 'Sign out',
  'Anmelden': 'Sign in',
  'Benutzername': 'Username',
  'Passwort': 'Password',
  'Anmeldung fehlgeschlagen': 'Sign-in failed',
  'Sprache': 'Language',
  'Rückgängig': 'Undo',
  'Abbrechen': 'Cancel',
  'Speichern': 'Save',
  'Schließen': 'Close',
  'Hinzufügen': 'Add',
  'Löschen': 'Delete',
  'Annehmen': 'Accept',
  'Ablehnen': 'Decline',
  'Bearbeiten': 'Edit',
  'Vorschlagen': 'Suggest',
  'Eigentümer:in': 'Owner',
  'Unbekannt': 'Unknown',
  'unbekannt': 'unknown',
  'du': 'you',
  'Fehler': 'Error',

  // Page titles
  'Dokumente – LMA Coop': 'Documents – LMA Coop',
  'Anmelden – LMA Coop': 'Sign in – LMA Coop',
  'Dokument – LMA Coop': 'Document – LMA Coop',
  'Benutzerverwaltung – LMA Coop': 'User management – LMA Coop',
  'Über LMA Coop': 'About LMA Coop',

  // Attribution and /about (see NOTICE)
  'Powered by': 'Powered by',
  'Open Source': 'Open source',
  'Ein frei verfügbarer Editor, um Publikationen gemeinsam zu schreiben. Entwickelt von':
    'A free editor for writing publications together. Built by',
  'Lizenz': 'Licence',
  'Du darfst LMA Coop nutzen, verändern und weitergeben – auch kommerziell. Veränderte Versionen musst du unter derselben Lizenz veröffentlichen, auch wenn du sie nur als Webdienst betreibst. Der Hinweis „Powered by LabMed Alliance" und diese Seite müssen erhalten bleiben (siehe NOTICE).':
    'You may use, modify and share LMA Coop, also commercially. Modified versions must be released under the same licence, even if you only run them as a web service. The "Powered by LabMed Alliance" credit and this page must be kept (see NOTICE).',
  'Ohne jede Gewährleistung.': 'Provided without any warranty.',
  'Quellcode': 'Source code',
  'Den Quellcode dieser Version findest du hier:': 'The source code of this version is available here:',
  'Verwendete Software': 'Built on',
  'Express, Hocuspocus, Yjs, TipTap, ProseMirror, prosemirror-suggest-changes, docx, Tabler und Tabler Icons, jeweils unter der MIT-Lizenz.':
    'Express, Hocuspocus, Yjs, TipTap, ProseMirror, prosemirror-suggest-changes, docx, Tabler and Tabler Icons, each under the MIT licence.',

  // Document list
  'Suchen …': 'Search …',
  'Dokumente durchsuchen': 'Search documents',
  'Neues Dokument': 'New document',
  'Unbenanntes Dokument': 'Untitled document',
  'Noch keine Dokumente': 'No documents yet',
  'Leg ein Dokument an und gib es über „Freigeben" für Kolleg:innen frei.':
    'Create a document and share it with colleagues via “Share”.',
  'Weitere Dokumente': 'Other documents',
  'Dokumente von Kolleg:innen. Öffnen kannst du sie nach einer Freigabe – beantrage dazu Zugriff.':
    'Documents by colleagues. You can open them once they are shared with you – request access to do so.',
  'Geteilt · {role}': 'Shared · {role}',
  '1 offener Antrag': '1 open request',
  '{n} offene Anträge': '{n} open requests',
  '„{title}" löschen': 'Delete “{title}”',
  '„{title}" gelöscht': '“{title}” deleted',
  'Bist du sicher?': 'Are you sure?',
  'Idee': 'Idea',
  'Work in Progress': 'Work in Progress',
  'Finished': 'Finished',
  'Archived': 'Archived',
  'Status': 'Status',
  'Nach Status filtern': 'Filter by status',
  'Alle außer Archived': 'All except archived',
  'Alle': 'All',
  'Keine Dokumente für diese Auswahl.': 'No documents match this selection.',
  'Tags': 'Tags',
  'Alle Tags': 'All tags',
  'Nach Tag filtern': 'Filter by tag',
  'Dieses Dokument hat noch keine Tags.': 'This document has no tags yet.',
  'Tag hinzufügen': 'Add tag',
  'Tag suchen': 'Search tags',
  'Tag suchen oder neu anlegen': 'Search or create a tag',
  'Ein neuer Name legt den Tag in der gemeinsamen Liste an.': 'A new name adds the tag to the shared list.',
  'Es gibt noch keine Tags. Tags legt ein Admin an.': 'There are no tags yet. An admin creates tags.',
  'Kein passender Tag. Neue Tags legt ein Admin an.': 'No matching tag. An admin creates new tags.',
  'Unbekannter Tag. Neue Tags legt ein Admin an.': 'Unknown tag. An admin creates new tags.',
  'Tag: 1–40 Zeichen': 'Tag: 1–40 characters',
  'Diesen Tag gibt es schon': 'This tag already exists',
  'Eine gemeinsame Liste für alle. Eigentümer:innen und Personen mit „Bearbeiten" wählen daraus Tags für ihre Dokumente. Umbenennen ändert den Tag in allen Dokumenten.':
    'One shared list for everyone. Owners and people with “Edit” pick tags for their documents from it. Renaming changes the tag in all documents.',
  'Neuer Tag': 'New tag',
  'Noch keine Tags angelegt.': 'No tags yet.',
  'Tag „{name}" umbenennen': 'Rename tag “{name}”',
  'Tag umbenannt': 'Tag renamed',
  '1 Dokument': '1 document',
  '{n} Dokumente': '{n} documents',
  'Tag „{name}" löschen': 'Delete tag “{name}”',
  'Tag „{name}" löschen? Er verschwindet aus {n} Dokument(en).': 'Delete tag “{name}”? It is removed from {n} document(s).',
  'Tag „{name}" gelöscht': 'Tag “{name}” deleted',
  'Tag „{name}" angelegt': 'Tag “{name}” created',
  'Tag „{name}" entfernen': 'Remove tag “{name}”',
  'Höchstens 20 Tags mit je höchstens 40 Zeichen': 'At most 20 tags with at most 40 characters each',
  'Unbekannter Status': 'Unknown status',
  '„{title}" wird gelöscht. Alle Personen mit Freigabe verlieren den Zugriff.':
    '“{title}” will be deleted. Everyone it is shared with loses access.',
  'Beantragt · {role}': 'Requested · {role}',
  'Zugriff beantragen': 'Request access',

  // Admin
  'Benutzerverwaltung': 'User management',
  'Name': 'Name',
  'Admin': 'Admin',
  'Neue Person': 'New person',
  'Anzeigename': 'Display name',
  '2–40 Zeichen: Buchstaben, Ziffern, Punkt, Binde- und Unterstrich.':
    '2–40 characters: letters, digits, dot, hyphen and underscore.',
  'Start-Passwort': 'Initial password',
  'Mindestens 10 Zeichen. Gib es der Person auf sicherem Weg weiter.':
    'At least 10 characters. Pass it on to the person securely.',
  'Admin (darf Benutzer verwalten)': 'Admin (may manage users)',
  'Anlegen': 'Create',
  'Passwort zurücksetzen': 'Reset password',
  'Neues Passwort': 'New password',
  'Neues Passwort (min. 10 Zeichen)': 'New password (min. 10 characters)',
  '{name} ist Admin': '{name} is admin',
  '{name} ist jetzt Admin': '{name} is now admin',
  '{name} ist kein Admin mehr': '{name} is no longer admin',
  'Passwort von {name} zurücksetzen': 'Reset password of {name}',
  '{name} löschen': 'Delete {name}',
  ' Die {n} Dokument(e) dieser Person gehen an dich über.': ' The {n} document(s) of this person pass to you.',
  '{name} endgültig löschen?{note}': 'Delete {name} permanently?{note}',
  '{name} gelöscht': '{name} deleted',
  'Für {name} ({username}). Bestehende Anmeldungen werden beendet.':
    'For {name} ({username}). Existing sessions are ended.',
  'Passwort für {name} gesetzt': 'Password set for {name}',
  '{name} angelegt': '{name} created',

  // Document header
  'Zur Dokumentliste': 'Back to documents',
  'Dokumenttitel': 'Document title',
  'Verbinde …': 'Connecting …',
  'Gespeichert': 'Saved',
  'Nicht gespeichert': 'Not saved',
  'Speichert …': 'Saving …',
  'Offline – Änderungen werden nachgereicht': 'Offline – changes will sync later',
  'Automatisch speichern': 'Autosave',
  'Speichern (Strg+S)': 'Save (Ctrl+S)',
  'Modus': 'Mode',
  'Vorschlagsmodus': 'Suggestion mode',
  'Bearbeiten beantragen': 'Request edit rights',
  // Role "Lesen" and account permissions
  'Lesen': 'View',
  'Nur lesen': 'View only',
  'darf nur lesen.': 'may only read.',
  'Vorschlagen beantragen': 'Request suggest rights',
  'Vorschlagen beantragt': 'Suggest rights requested',
  'Die Eigentümer:in bitten, Änderungen vorschlagen zu dürfen': 'Ask the owner for permission to suggest changes',
  'Bitte die Eigentümer:in oder einen Admin, dir das Dokument freizugeben.': 'Ask the owner or an admin to share the document with you.',
  'Berechtigungen': 'Permissions',
  'Berechtigungen von {name}': 'Permissions of {name}',
  'Konto': 'Account',
  'Neue Dokumente anlegen': 'Create new documents',
  'Auch „Word importieren“ in der Dokumentliste.': 'Also “Import Word” in the document list.',
  'Rechte beantragen': 'Request rights',
  'Zugriff auf fremde Dokumente oder „Bearbeiten“ statt „Vorschlagen“ beantragen.': 'Request access to documents of others, or “Edit” instead of “Suggest”.',
  'Fremde Dokumente in der Liste sehen': 'See documents of others in the list',
  'Titel und Eigentümer:in unter „Weitere Dokumente“, ohne Inhalt.': 'Title and owner under “More documents”, without content.',
  '{name} darf jetzt: {what}': '{name} may now: {what}',
  '{name} darf nicht mehr: {what}': '{name} may no longer: {what}',
  'gehört {name}': 'owned by {name}',
  'von {owner}': 'by {owner}',
  'Rolle von {name} in „{title}“': 'Role of {name} in “{title}”',
  'Kein Dokument gefunden.': 'No document found.',
  'Es gibt noch keine Dokumente.': 'There are no documents yet.',
  'Deine eigenen Zugriffe vergibt die Eigentümer:in.': 'The owner grants your own access.',
  'Deine eigenen Zugriffe vergibt die Eigentümer:in': 'The owner grants your own access',
  '{name}: „{role}“ in „{title}“': '{name}: “{role}” in “{title}”',
  '{name} hat keinen Zugriff mehr auf „{title}“': '{name} no longer has access to “{title}”',
  'Admins verwalten Konten, Rollen und Berechtigungen. Dokumente öffnen sie nur, wenn sie ihnen gehören oder freigegeben wurden. Beim Löschen einer Person gehen ihre Dokumente an dich über.':
    'Admins manage accounts, roles and permissions. They open documents only if they own them or the documents were shared with them. When you delete a person, their documents pass to you.',
  'Welche Dokumente darf die Person öffnen, und mit welcher Rolle?': 'Which documents may this person open, and with which role?',
  ': nur ansehen.': ': only look.',
  ': Änderungen als Vorschlag.': ': changes as suggestions.',
  ': direkt ändern.': ': change directly.',
  'Dokument suchen …': 'Search documents …',
  'Die Eigentümer:in hat immer vollen Zugriff': 'The owner always has full access',
  'Du darfst keine neuen Dokumente anlegen': 'You may not create new documents',
  'Du darfst keine Rechte beantragen': 'You may not request rights',
  'Bearbeiten beantragt': 'Edit rights requested',
  'Vorschläge': 'Suggestions',
  'Literatur': 'References',
  'Word': 'Word',
  'Drucken oder als PDF speichern': 'Print or save as PDF',
  'Freigeben': 'Share',
  'Zugriff': 'Access',
  'Kein Zugriff': 'No access',
  'Kein Zugriff auf dieses Dokument. Vielleicht wurde die Freigabe entfernt.':
    'No access to this document. Sharing may have been removed.',
  'Diese Änderung war kein reiner Vorschlag und wurde verworfen. Lade neu …':
    'This change was not a pure suggestion and was discarded. Reloading …',
  'Die Freigabe für dieses Dokument wurde geändert. Lade neu …':
    'Sharing for this document has changed. Reloading …',

  // Toolbar
  'Formatierung': 'Formatting',
  'Rückgängig (Strg+Z)': 'Undo (Ctrl+Z)',
  'Wiederholen (Strg+Y)': 'Redo (Ctrl+Y)',
  'Absatzformat': 'Paragraph style',
  'Text': 'Text',
  'Überschrift 1': 'Heading 1',
  'Überschrift 2': 'Heading 2',
  'Überschrift 3': 'Heading 3',
  'Fett (Strg+B)': 'Bold (Ctrl+B)',
  'Kursiv (Strg+I)': 'Italic (Ctrl+I)',
  'Unterstrichen (Strg+U)': 'Underline (Ctrl+U)',
  'Durchgestrichen': 'Strikethrough',
  'Hochgestellt': 'Superscript',
  'Tiefgestellt': 'Subscript',
  'Link': 'Link',
  'Aufzählung': 'Bulleted list',
  'Nummerierte Liste': 'Numbered list',
  'Zitatblock': 'Block quote',
  'Linksbündig': 'Align left',
  'Zentriert': 'Center',
  'Rechtsbündig': 'Align right',
  'Blocksatz': 'Justify',
  'Tabelle einfügen': 'Insert table',
  'Zeile darunter': 'Row below',
  'Spalte rechts': 'Column right',
  'Zeile löschen': 'Delete row',
  'Spalte löschen': 'Delete column',
  'Tabelle löschen': 'Delete table',
  'Literaturzitat einfügen (Strg+Shift+L)': 'Insert citation (Ctrl+Shift+L)',
  'Zitat': 'Cite',
  'Im Vorschlagsmodus nicht möglich': 'Not available in suggestion mode',
  'Link-Adresse (leer lassen zum Entfernen):': 'Link address (leave empty to remove):',
  'Titel, Abstract, Einleitung …': 'Title, abstract, introduction …',
  'Listen, Zitatblöcke und Tabellen lassen sich nicht als Vorschlag ändern.':
    'Lists, block quotes and tables cannot be changed as a suggestion.',

  // References and citations
  'Literatur dieses Dokuments': 'References of this document',
  'DOI oder PMID': 'DOI or PMID',
  'Die Liste gehört zu diesem Dokument; alle mit Zugriff sehen sie. Zitate nummerieren sich nach Reihenfolge im Text.':
    'The list belongs to this document; everyone with access sees it. Citations are numbered by order in the text.',
  '(Quelle wurde aus der Literaturliste entfernt)': '(Source was removed from the reference list)',
  '(Quelle fehlt)': '(Source missing)',
  'Im Text zitiert': 'Cited in the text',
  'Noch nicht zitiert': 'Not cited yet',
  'Quelle entfernen': 'Remove source',
  'Quelle entfernt': 'Source removed',
  'Zitat einfügen': 'Insert citation',
  'Neue Quelle: DOI oder PMID': 'New source: DOI or PMID',
  'Suchen': 'Look up',
  'In der Literaturliste suchen …': 'Search the reference list …',
  'Literaturliste filtern': 'Filter reference list',
  'Einfügen': 'Insert',
  'Kein Treffer.': 'No match.',
  'Noch keine Quellen. Füge oben eine DOI oder PMID hinzu oder gib sie manuell ein.':
    'No sources yet. Add a DOI or PMID above or enter one manually.',
  'Manuell eingeben': 'Enter manually',
  'Manuell': 'Manual',
  'Quelle manuell eingeben': 'Enter source manually',
  'Quelle bearbeiten': 'Edit source',
  'Art der Quelle': 'Type of source',
  'Vorschau (Vancouver)': 'Preview (Vancouver)',
  'Gib mindestens einen Titel ein.': 'Enter at least a title.',
  'Bitte fülle alle Pflichtfelder (*) aus.': 'Please fill in all required fields (*).',
  'Zeitschriftenartikel': 'Journal article',
  'Buch': 'Book',
  'Buchkapitel': 'Book chapter',
  'Webseite': 'Web page',
  'Konferenzbeitrag': 'Conference paper',
  'Bericht': 'Report',
  'Dissertation / Abschlussarbeit': 'Dissertation / thesis',
  'Eine Person pro Zeile: „Cadamuro J" oder „Cadamuro, Janne". Organisationen ausschreiben.':
    'One person per line: "Cadamuro J" or "Cadamuro, Janne". Write out organizations in full.',
  'Autor:innen': 'Authors',
  'Autor:innen oder Organisation': 'Authors or organization',
  'Titel': 'Title',
  'Titel des Kapitels': 'Chapter title',
  'Titel des Beitrags': 'Title of the paper',
  'Zeitschrift (Abkürzung)': 'Journal (abbreviation)',
  'Herausgeber:innen': 'Editors',
  'Titel des Buchs': 'Book title',
  'Titel des Tagungsbands': 'Title of the proceedings',
  'Name der Tagung': 'Conference name',
  'Nur nötig, wenn es keinen Tagungsband gibt.': 'Only needed if there are no proceedings.',
  'Datum der Tagung': 'Conference date',
  'Ort der Tagung': 'Conference location',
  'Art der Arbeit': 'Type of thesis',
  "Zum Beispiel dissertation, master's thesis.": "For example dissertation, master's thesis.",
  'Auflage': 'Edition',
  'Eine Zahl wird zu „2nd ed.".': 'A number becomes "2nd ed.".',
  'Verlagsort': 'Place of publication',
  'Ort': 'Place',
  'Verlag': 'Publisher',
  'Universität': 'University',
  'Betreiber der Seite': 'Publisher of the site',
  'Herausgebende Institution': 'Issuing organization',
  'Jahr': 'Year',
  'Jahr der Veröffentlichung': 'Year of publication',
  'Band': 'Volume',
  'Heft': 'Issue',
  'Seiten': 'Pages',
  'Berichtsnummer': 'Report number',
  'Aktualisiert am': 'Updated on',
  'Abgerufen am': 'Accessed on',
  'URL': 'URL',
  'Erscheint nur, wenn keine DOI angegeben ist.': 'Shown only if there is no DOI.',
  'DOI': 'DOI',
  'PMID': 'PMID',
  'o. A.': 'n.a.',
  'Dokument': 'Document',
  '{words} Wörter · {chars} Zeichen': '{words} words · {chars} characters',

  // Suggestions
  'Alle annehmen': 'Accept all',
  'Alle ablehnen': 'Reject all',
  'Alle Vorschläge angenommen': 'All suggestions accepted',
  'Alle Vorschläge abgelehnt': 'All suggestions rejected',
  'Keine offenen Vorschläge.': 'No open suggestions.',
  'Ersetzt „{old}“ durch „{new}“': 'Replaces “{old}” with “{new}”',
  'Fügt ein: „{text}“': 'Inserts: “{text}”',
  'Löscht: „{text}“': 'Deletes: “{text}”',
  'Ändert die Formatierung': 'Changes formatting',
  'Vorgeschlagene Einfügung': 'Suggested insertion',
  'Vorgeschlagene Löschung': 'Suggested deletion',
  'Vorgeschlagene Formatänderung': 'Suggested format change',

  // Sharing
  'Wer darf dieses Dokument sehen?': 'Who may see this document?',
  'ändert direkt und nimmt Vorschläge an.': 'changes directly and accepts suggestions.',
  'darf nur Änderungen vorschlagen.': 'may only suggest changes.',
  'Anträge': 'Requests',
  'Person': 'Person',
  'Rolle': 'Role',
  '{name} bittet um „{role}“': '{name} asks for “{role}”',
  'Ansehen': 'View',
  '{name} (bisher {role})': '{name} (currently {role})',
  'Rolle für {name}': 'Role for {name}',
  'Rolle von {name}': 'Role of {name}',
  '{name} darf jetzt „{role}“': '{name} may now “{role}”',
  'Antrag von {name} abgelehnt': 'Request from {name} declined',
  'Alle Personen haben schon Zugriff': 'Everyone already has access',
  '{name} entfernen': 'Remove {name}',
  '{name} hat keinen Zugriff mehr': '{name} no longer has access',

  // Access requests
  'Dokument nicht gefunden': 'Document not found',
  'Das Dokument gibt es nicht oder es wurde gelöscht.': 'The document does not exist or was deleted.',
  'Dokument von {owner} – du hast noch keinen Zugriff.': 'Document by {owner} – you do not have access yet.',
  'Du hast ': 'You requested ',
  ' beantragt. Sobald die Eigentümer:in zustimmt, öffnet sich das Dokument hier.':
    '. As soon as the owner approves, the document opens here.',
  'Antrag zurückziehen': 'Withdraw request',
  'Antrag zurückgezogen': 'Request withdrawn',
  'Bitte die Eigentümer:in um Zugriff:': 'Ask the owner for access:',
  'Gewünschte Rolle': 'Requested role',
  'Vorschlagen: Änderungen erscheinen als Vorschlag. Bearbeiten: Änderungen direkt im Text.':
    'Suggest: changes appear as suggestions. Edit: changes go straight into the text.',
  'Die Eigentümer:in um Bearbeitungsrechte bitten': 'Ask the owner for edit rights',
  'Antrag gestellt. Sobald die Eigentümer:in zustimmt, lädt die Seite neu.':
    'Request sent. As soon as the owner approves, the page reloads.',

  // Comments
  'Kommentare': 'Comments',
  'Kommentar': 'Comment',
  'Kommentar hinzufügen (Strg+Alt+M)': 'Add comment (Ctrl+Alt+M)',
  'Erledigte anzeigen': 'Show resolved',
  'Markiere zuerst den Text, den du kommentieren willst.': 'First select the text you want to comment on.',
  'Kommentar als erledigt markiert': 'Comment marked as resolved',
  'Kommentar gelöscht': 'Comment deleted',
  'Antwort gelöscht': 'Reply deleted',
  'bearbeitet': 'edited',
  'Erledigt': 'Resolve',
  'Kommentar löschen': 'Delete comment',
  'Antwort löschen': 'Delete reply',
  'Der kommentierte Text ist nicht mehr im Dokument.': 'The commented text is no longer in the document.',
  'Erledigt von {name}': 'Resolved by {name}',
  'Wieder öffnen': 'Reopen',
  'Antworten …': 'Reply …',
  'Antworten': 'Reply',
  'Kommentar hinzufügen …': 'Add a comment …',
  'Kommentieren': 'Comment',
  'Keine offenen Kommentare.': 'No open comments.',
  'Noch keine Kommentare. Markiere Text und klicke auf „Kommentar“.': 'No comments yet. Select text and click “Comment”.',

  // Selection menu
  'Auswahl': 'Selection',
  'Kopieren': 'Copy',
  'Ausschneiden': 'Cut',
  'Kopiert': 'Copied',
  'Kopieren nicht möglich. Nutze Strg+C.': 'Copying not possible. Use Ctrl+C.',
  'Ausschneiden nicht möglich. Nutze Strg+X.': 'Cutting not possible. Use Ctrl+X.',

  // Images
  'Bild': 'Image',
  'Bild einfügen': 'Insert image',
  'Bildbreite 25 %': 'Image width 25%',
  'Bildbreite 50 %': 'Image width 50%',
  'Bildbreite 75 %': 'Image width 75%',
  'Bildbreite 100 %': 'Image width 100%',
  'Bildbeschreibung (Alternativtext)': 'Image description (alt text)',
  'Bildbeschreibung (für Screenreader und Word):': 'Image description (for screen readers and Word):',
  'Bild wird hochgeladen …': 'Uploading image …',
  'Bilder werden hochgeladen …': 'Uploading images …',

  // Server error messages (the server answers in German)
  'Nicht angemeldet': 'Not signed in',
  'Fremde Herkunft': 'Foreign origin',
  'Zu viele Fehlversuche. Bitte später erneut versuchen.': 'Too many failed attempts. Please try again later.',
  'Benutzername oder Passwort falsch': 'Wrong username or password',
  'Nur für Admins': 'Admins only',
  'Benutzername: 2–40 Zeichen, nur Buchstaben, Ziffern, Punkt, Binde- und Unterstrich':
    'Username: 2–40 characters, only letters, digits, dot, hyphen and underscore',
  'Passwort: mindestens 10 Zeichen': 'Password: at least 10 characters',
  'Benutzername ist vergeben': 'Username is taken',
  'Nicht gefunden': 'Not found',
  'Du kannst dir die Admin-Rolle nicht selbst entziehen': 'You cannot remove your own admin role',
  'Du kannst dich nicht selbst löschen': 'You cannot delete yourself',
  'Keine Berechtigung': 'Not permitted',
  'Titel fehlt': 'Title missing',
  'Unbekannte Rolle': 'Unknown role',
  'Benutzer nicht gefunden': 'User not found',
  'Du bist bereits Eigentümer:in': 'You already are the owner',
  'Diese Rechte hast du bereits': 'You already have these rights',
  'Ungültige Person': 'Invalid person',
  'Quelle nicht gefunden': 'Source not found',
  'PMID nicht gefunden': 'PMID not found',
  'Keine gültige DOI oder PMID': 'Not a valid DOI or PMID',
  'Ungültige Kommentar-ID': 'Invalid comment id',
  'Kommentar ist leer': 'Comment is empty',
  'Kommentar existiert bereits': 'Comment already exists',
  'Kommentar nicht gefunden': 'Comment not found',
  'Nur eigene Kommentare lassen sich bearbeiten': 'You can only edit your own comments',
  'Nur PNG, JPEG, GIF oder WebP möglich': 'Only PNG, JPEG, GIF or WebP possible',
  'Bild ist zu groß (höchstens 10 MB)': 'Image is too large (at most 10 MB)',
  'Bild nicht gefunden': 'Image not found',

  // Word import
  'Word importieren': 'Import Word',
  'Neues Dokument aus einer Word-Datei (.docx), mit Kommentaren, Änderungen und Zitaten':
    'New document from a Word file (.docx), with comments, changes and citations',
  'Word-Datei importieren': 'Import Word file',
  'Word-Datei wird importiert …': 'Importing Word file …',
  'Word-Datei importiert: {changes} Änderungen, {comments} Kommentare, {citations} Zitate, {images} Bilder.':
    'Word file imported: {changes} changes, {comments} comments, {citations} citations, {images} images.',
  '{n} Bilder fehlen (nur PNG, JPEG, GIF und WebP möglich).': '{n} images are missing (only PNG, JPEG, GIF and WebP possible).',
  'Fußnoten werden nicht übernommen ({n}).': 'Footnotes are not imported ({n}).',
  'Keine gültige Word-Datei (.docx)': 'Not a valid Word file (.docx)',
};

/** Translates German `key` into the UI language and fills in {placeholders} from `vars`. */
export function t(key, vars = {}) {
  const text = (lang === 'en' && EN[key]) || key;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

const ATTRIBUTES = ['title', 'placeholder', 'aria-label'];

/** Translates the static texts of the page (text nodes and some attributes). Runs once on load. */
export function translatePage() {
  document.documentElement.lang = lang;
  if (lang === 'de') return;
  document.title = t(document.title);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const key = node.nodeValue.replace(/\s+/g, ' ').trim();
    if (!EN[key]) continue;
    const [lead] = /^\s*/.exec(node.nodeValue);
    const [trail] = /\s*$/.exec(node.nodeValue);
    node.nodeValue = `${lead ? ' ' : ''}${EN[key]}${trail ? ' ' : ''}`;
  }
  for (const attr of ATTRIBUTES) {
    document.querySelectorAll(`[${attr}]`).forEach((el) => {
      const key = el.getAttribute(attr).replace(/\s+/g, ' ').trim();
      if (EN[key]) el.setAttribute(attr, EN[key]);
    });
  }
}
