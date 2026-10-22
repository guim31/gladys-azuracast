# AzuraCast

[AzuraCast](https://www.azuracast.com) ist ein selbst gehostetes Webradio: ein
AutoDJ, der deine Playlists spielt, Live-Sendungen deiner Moderatoren und eine
öffentliche Seite für deine Zuhörer. Diese Integration bringt deine Sender in
Gladys: was gerade läuft, die Zahl der Zuhörer, ob ein Moderator live ist, und
Szenen, die auf einen neuen Titel, den Beginn oder das Ende einer
Live-Sendung, eine Zuhörerschwelle oder einen Sender reagieren, der nicht mehr
sendet. Szenen können auch zum nächsten Titel springen.

AzuraCast kann bei dir zu Hause oder auf einem gemieteten Server laufen: Die
Integration funktioniert mit beiden (das Geräte-Badge zeigt „local“ oder
„cloud“ je nach Adresse).

Getestet mit einem echten AzuraCast in Docker (fortlaufende Version nach
0.23.9, Oktober 2026), mit erzeugten Testtönen in einer Playlist, Zuhörern und
einer von ffmpeg gesendeten Live-Sendung: Titel, Zuhörer, Live-Sendung und ihr
Ende, Titel überspringen, Cover. Feedback gern in
[den Issues](https://github.com/guim31/gladys-azuracast/issues).

## Was du brauchst

- Gladys Assistant 5.1.0 oder neuer.
- Einen AzuraCast-Server, den Gladys erreicht (seine Weboberfläche,
  standardmäßig Port 80 oder 443).
- Die öffentliche API auf jedem Sender aktiviert (Edit Station Profile →
  Profile → „Enable public API“, standardmäßig an).
- Optional: einen AzuraCast-API-Schlüssel, um Titel aus Gladys zu überspringen.

## Erste Schritte

### 1. Die Adresse von AzuraCast finden

Es ist die Adresse seiner Weboberfläche, zum Beispiel `http://192.168.1.2`
oder `https://radio.example.org`. Eine aus dem Browser kopierte Adresse geht
auch (ein öffentlicher Player `…/public/mein_sender`, das Dashboard): Die
Integration behält ihren Anfang.

### 2. Die Integration konfigurieren

Öffne in Gladys die Integration und fülle aus:

- **AzuraCast-Adresse**.
- **API-Schlüssel (optional)**: Öffne in AzuraCast My Account → API Keys,
  erstelle einen Schlüssel und füge ihn hier ein. Der Benutzer muss den Sender
  verwalten dürfen (Recht „Broadcasting“). Nur für die Schaltfläche **Nächster
  Titel** und die Aktion „Zum nächsten Titel springen“.
- **Aktualisierungsintervall**: standardmäßig 15 Sekunden. Jedes Mal eine
  leichte Anfrage für alle Sender.
- **Sprache der Namen**: die Sprache der Funktionsnamen und der
  Szenen-Ergebnisse.

Nutze dann **Verbindung testen**: Die Integration liest AzuraCast, nennt, was
jeder Sender spielt, und prüft den API-Schlüssel.

### 3. Die Geräte hinzufügen

Öffne den Tab **Entdecken**: Jeder öffentliche Sender ist ein Gerät, nach ihm
benannt. Füge die gewünschten hinzu.

## Die Geräte

| Funktion            | Was sie anzeigt                                                   |
| ------------------- | ----------------------------------------------------------------- |
| Auf Sendung         | Ja, solange der Sender sendet                                     |
| Zuhörer             | Wer gerade zuhört                                                 |
| Zuhörerspitze heute | Die meisten Zuhörer seit Mitternacht                              |
| Aktueller Titel     | „Interpret – Titel“ des laufenden Songs („—“ außer Sendung)       |
| Live                | Ja, wenn ein Moderator live ist, nein mit dem AutoDJ              |
| Moderator           | Der Name des Moderators auf Sendung („—“ mit dem AutoDJ)          |
| Nächster Titel      | Der nächste Song des AutoDJ („—“, wenn AzuraCast ihn nicht kennt) |

Ein Sender gilt nach einer Minute ohne Senden (oder ohne Antwort von
AzuraCast) als nicht auf Sendung, und eine Live-Sendung endet nach einer
Minute ohne Moderator: Eine kurze Unterbrechung ändert nichts.

## Dashboard

Das Widget **AzuraCast läuft gerade** zeigt Titel und Interpret des Songs mit
seinem Cover, die Zuhörer und die Spitze des Tages, ob der Sender auf Sendung
ist, den Moderator während einer Live-Sendung und den nächsten Titel. Wähle
den Sender in den Einstellungen des Widgets (leer: der erste Sender). Die
Schaltfläche **Nächster Titel** (mit dem API-Schlüssel, nach einer
Bestätigung) überspringt den Song; die Schaltfläche **Anhören** öffnet die
öffentliche Seite des Senders, wenn ihre Adresse https:// ist.

## Szenen

### Auslöser

Jeder Auslöser lässt sich auf einen Sender beschränken (leer: jeder Sender)
und liefert den Namen des Senders.

- **Ein neuer Titel läuft**: mit Titel, Interpret, Songtitel und Album. Löst
  auch bei einem Song aus, der zweimal hintereinander läuft.
- **Eine Live-Sendung beginnt**: mit dem Namen des Moderators.
- **Eine Live-Sendung endet**: mit dem Namen des Moderators und der Dauer in
  Minuten.
- **Zuhörer erreichen eine Schwelle**: Wähle 1, 5, 10, 25, 50, 100, 250, 500
  oder 1000; löst einmal pro Tag aus, wenn die Zuhörer sie erreichen. 1
  bedeutet „jemand hört zu“.
- **Ein Sender ist nicht mehr auf Sendung**: Der Sender (oder ganz AzuraCast)
  sendet seit einer Minute nicht mehr.

Die Integration merkt sich, was sie gesehen hat: Ein Neustart von Gladys
kündigt eine Live-Sendung oder eine Schwelle nicht zweimal an, und ein
inzwischen begonnener Titel wird einmal angekündigt.

### Aktionen

- **Aktueller Titel**: liest einen Sender für die nächsten Aktionen: auf
  Sendung oder nicht, live oder nicht, Titel, Interpret, Songtitel, Album,
  Moderator, nächster Titel, Zuhörer und einen fertigen Satz („Mein Radio: Auf
  Sendung, live mit DJ Max, Interpret – Titel, 12 Zuhörer“).
- **Zum nächsten Titel springen**: überspringt den Song des AutoDJ. Braucht
  den API-Schlüssel aus der Konfiguration.

### Szenen-Ideen

- **On-Air-Lampe**: „Eine Live-Sendung beginnt“ schaltet die Studiolampe auf
  Rot; „Eine Live-Sendung endet“ schaltet sie aus und schickt dir die Dauer.
- **Der Titel auf dem Fernseher**: „Ein neuer Titel läuft“ zeigt den Titel auf
  dem Bildschirm im Wohnzimmer oder sagt ihn über den Lautsprecher an.
- **Sendeausfall-Alarm**: „Ein Sender ist nicht mehr auf Sendung“ schickt dir
  eine Benachrichtigung; eine Morgenszene überspringt einen Song, der dir
  nicht gefällt.

## Fehlerbehebung

- **AzuraCast antwortet nicht**: Prüfe die Adresse von dem Rechner aus, auf
  dem Gladys läuft.
- **Kein AzuraCast unter dieser Adresse**: Die Adresse führt zu einem anderen
  Dienst.
- **Die Adresse leitet um**: Gib die https://-Adresse ein.
- **AzuraCast antwortet, zeigt aber keinen öffentlichen Sender**: Aktiviere
  „Enable public API“ im Profil des Senders.
- **API-Schlüssel abgelehnt oder ohne Rechte für diesen Sender**: Erstelle den
  Schlüssel neu mit einem Benutzer, der den Sender verwaltet.
- **Kein Cover im Widget**: Der Song hat in AzuraCast keines, oder die Datei
  ist größer als 300 KB (die Grenze von Gladys).

## Grenzen

- Ein AzuraCast-Server pro Integration; Sender ohne öffentliche API sind nicht
  sichtbar.
- AzuraCast wird im gewählten Intervall gelesen (standardmäßig 15 Sekunden),
  nicht in Echtzeit: Ein Song, der kürzer als das Intervall ist, kann
  übersehen werden.
- Überspringen funktioniert nur mit dem AutoDJ von AzuraCast (Liquidsoap),
  nicht während einer Live-Sendung.
- Die Spitze des Tages misst die Integration bei jedem Lesen.
- Nicht mit dem AzuraCast-Projekt verbunden.
