#!/usr/bin/env bash
# Konto-API am Spielport durchspielen. Prueft vor allem, was NICHT gehen darf.
set -u
B=http://127.0.0.1:2467/accounts
N="probe$RANDOM$RANDOM"

ok=0; fehl=0
pruef() { # pruef <was> <erwartet> <ist>
  if [ "$2" = "$3" ]; then printf '  ok    %-52s %s\n' "$1" "$3"; ok=$((ok+1))
  else printf '  FEHL  %-52s erwartet %s, ist %s\n' "$1" "$2" "$3"; fehl=$((fehl+1)); fi
}
code() { curl -s -o /tmp/ap.out -w '%{http_code}' "$@"; }
J() { python3 -c "import json,sys;d=json.load(open('/tmp/ap.out'));print(d$1)" 2>/dev/null || echo "?"; }

echo "── Registrierung ──"
pruef "gueltige Registrierung" 201 "$(code -X POST $B/registrieren -H 'content-type: application/json' \
  -d "{\"benutzername\":\"$N\",\"email\":\"a@b.de\",\"passwort\":\"GeheimGeheim1\"}")"
TOK=$(J "['token']")

pruef "derselbe Benutzername nochmal" 409 "$(code -X POST $B/registrieren -H 'content-type: application/json' \
  -d "{\"benutzername\":\"$N\",\"email\":\"a@b.de\",\"passwort\":\"GeheimGeheim1\"}")"
pruef "andere Schreibweise desselben Namens" 409 "$(code -X POST $B/registrieren -H 'content-type: application/json' \
  -d "{\"benutzername\":\"${N^^}\",\"email\":\"a@b.de\",\"passwort\":\"GeheimGeheim1\"}")"
pruef "Passwort zu kurz" 400 "$(code -X POST $B/registrieren -H 'content-type: application/json' \
  -d "{\"benutzername\":\"x$N\",\"email\":\"a@b.de\",\"passwort\":\"kurz\"}")"
pruef "E-Mail ohne @" 400 "$(code -X POST $B/registrieren -H 'content-type: application/json' \
  -d "{\"benutzername\":\"y$N\",\"email\":\"keine\",\"passwort\":\"GeheimGeheim1\"}")"
pruef "kaputter JSON-Koerper" 400 "$(code -X POST $B/registrieren -H 'content-type: application/json' -d 'nicht json')"

echo "── Anmeldung ──"
pruef "richtiges Passwort" 200 "$(code -X POST $B/anmelden -H 'content-type: application/json' \
  -d "{\"benutzername\":\"$N\",\"passwort\":\"GeheimGeheim1\"}")"
pruef "falsches Passwort" 401 "$(code -X POST $B/anmelden -H 'content-type: application/json' \
  -d "{\"benutzername\":\"$N\",\"passwort\":\"falsch\"}")"
pruef "unbekannter Benutzer, gleiche Meldung" 401 "$(code -X POST $B/anmelden -H 'content-type: application/json' \
  -d '{"benutzername":"gibtsnicht","passwort":"egal"}')"
pruef "  und derselbe Fehlerschluessel" "login-failed" "$(J "['fehler']")"

echo "── Zugriffsschutz ──"
pruef "ohne Token"            401 "$(code $B/ich)"
pruef "erfundenes Token"      401 "$(code $B/ich -H 'authorization: Bearer aaa.bbb')"
pruef "Token ohne Signatur"   401 "$(code $B/ich -H "authorization: Bearer ${TOK%%.*}.")"
pruef "veraenderte Nutzlast"  401 "$(code $B/ich -H "authorization: Bearer eyJrIjo5OTk5LCJpIjoxLCJlIjo5OTk5OTk5OTk5OTk5fQ.${TOK##*.}")"
pruef "gueltiges Token"       200 "$(code $B/ich -H "authorization: Bearer $TOK")"

echo "── Charaktere ──"
pruef "anlegen"          201 "$(code -X POST $B/charaktere -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d "{\"name\":\"Held$N\",\"figur\":\"wikingerin\",\"frisur\":\"H_03\",\"ober\":\"\",\"beine\":\"\"}")"
CID=$(J "['charakter']['id']")
pruef "keine spielerId nach aussen" "?" "$(J "['charakter']['spielerId']")"
pruef "Name schon vergeben" 409 "$(code -X POST $B/charaktere -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d "{\"name\":\"held$N\",\"figur\":\"wikingerin\",\"frisur\":\"H_03\"}")"
pruef "Name mit Sonderzeichen" 400 "$(code -X POST $B/charaktere -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d "{\"name\":\"<script>\",\"figur\":\"wikingerin\",\"frisur\":\"H_03\"}")"
pruef "anlegen ohne Token"  401 "$(code -X POST $B/charaktere -H 'content-type: application/json' -d '{"name":"Dieb"}')"

echo "── Spielen ──"
pruef "Spielticket holen" 200 "$(code -X POST $B/charaktere/$CID/spielen -H "authorization: Bearer $TOK")"
ST=$(J "['sessionToken']")
pruef "  Ticket ist zweiteilig" "2" "$(python3 -c "print(len('$ST'.split('.')))")"
pruef "  Ticket != Konto-Token" "verschieden" "$([ "$ST" = "$TOK" ] && echo gleich || echo verschieden)"
pruef "fremder Charakter" 404 "$(code -X POST $B/charaktere/999999/spielen -H "authorization: Bearer $TOK")"
pruef "Spielen ohne Token" 401 "$(code -X POST $B/charaktere/$CID/spielen)"

echo "── Trennung der Token-Arten ──"
pruef "Konto-Token als Spielticket unbrauchbar" 401 "$(code $B/ich -H "authorization: Bearer $ST")"

echo
echo "  $ok bestanden, $fehl fehlgeschlagen"
[ "$fehl" -eq 0 ]
