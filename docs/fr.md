# AzuraCast

[AzuraCast](https://www.azuracast.com) est une webradio auto-hébergée : un
AutoDJ qui passe vos playlists, des émissions en direct par vos animateurs, et
une page publique pour vos auditeurs. Cette intégration amène vos stations
dans Gladys : ce qui passe, le nombre d'auditeurs, si un animateur est en
direct, et des scènes qui réagissent à un nouveau titre, au début ou à la fin
d'une émission en direct, à un seuil d'auditeurs ou à une station qui n'émet
plus. Les scènes peuvent aussi passer au titre suivant.

AzuraCast peut tourner chez vous ou sur un serveur loué : l'intégration
fonctionne dans les deux cas (le badge de l'appareil indique « local » ou
« cloud » d'après l'adresse).

Testée contre un vrai AzuraCast en Docker (version continue après la 0.23.9,
octobre 2026), avec des sons de test générés en playlist, des auditeurs et une
émission en direct envoyée par ffmpeg : titres, auditeurs, direct et sa fin,
titre suivant, pochette. Vos retours sont les bienvenus dans
[les issues](https://github.com/guim31/gladys-azuracast/issues).

## Ce qu'il faut

- Gladys Assistant 5.1.0 ou plus récent.
- Un serveur AzuraCast joignable depuis Gladys (son interface web, port 80 ou
  443 par défaut).
- L'API publique activée sur chaque station (Edit Station Profile → Profile →
  « Enable public API », activée par défaut).
- Facultatif : une clé d'API AzuraCast, pour passer des titres depuis Gladys.

## Mise en route

### 1. Trouver l'adresse d'AzuraCast

C'est l'adresse de son interface web, par exemple `http://192.168.1.2` ou
`https://radio.example.org`. Une adresse copiée depuis le navigateur convient
aussi (un lecteur public `…/public/ma_station`, le tableau de bord) :
l'intégration en garde le début.

### 2. Configurer l'intégration

Dans Gladys, ouvrez l'intégration et renseignez :

- **Adresse d'AzuraCast**.
- **Clé d'API (facultative)** : dans AzuraCast, ouvrez My Account → API Keys,
  créez une clé et collez-la ici. L'utilisateur doit pouvoir gérer la station
  (droit « Broadcasting »). Seulement pour le bouton **Titre suivant** et
  l'action « Passer au titre suivant ».
- **Intervalle de rafraîchissement** : 15 secondes par défaut. Une requête
  légère pour toutes les stations à chaque fois.
- **Langue des noms** : la langue des noms des fonctionnalités et des résultats
  de scène.

Puis utilisez **Tester la connexion** : elle lit AzuraCast, donne ce que passe
chaque station et vérifie la clé d'API.

### 3. Ajouter les appareils

Ouvrez l'onglet **Découverte** : chaque station publique est un appareil, à
son nom. Ajoutez celles que vous voulez.

## Les appareils

| Fonctionnalité          | Ce qu'elle indique                                             |
| ----------------------- | -------------------------------------------------------------- |
| À l'antenne             | Oui tant que la station émet                                   |
| Auditeurs               | Les personnes qui écoutent en ce moment                        |
| Pic d'auditeurs du jour | Le plus d'auditeurs depuis minuit                              |
| Titre en cours          | « Artiste – Titre » du morceau diffusé (« — » hors antenne)    |
| En direct               | Oui quand un animateur est en direct, non avec l'AutoDJ        |
| Animateur               | Le nom de l'animateur à l'antenne (« — » avec l'AutoDJ)        |
| Titre suivant           | Le prochain titre de l'AutoDJ (« — » quand AzuraCast l'ignore) |

Une station passe hors antenne après une minute sans émettre (ou sans réponse
d'AzuraCast), et une émission en direct se termine après une minute sans
animateur : une courte coupure ne change rien.

## Tableau de bord

Le widget **AzuraCast en cours** montre le titre et l'artiste du morceau avec
sa pochette, les auditeurs et le pic du jour, si la station est à l'antenne,
l'animateur pendant un direct et le titre suivant. Choisissez la station dans
les réglages du widget (vide : la première station). Le bouton **Titre
suivant** (avec la clé d'API, après confirmation) passe le morceau ; le bouton
**Écouter** ouvre la page publique de la station quand son adresse est en
https://.

## Scènes

### Déclencheurs

Chaque déclencheur peut se limiter à une station (vide : n'importe laquelle),
et donne le nom de la station.

- **Un nouveau titre passe** : avec le titre complet, l'artiste, le titre et
  l'album. Se déclenche aussi pour un morceau joué deux fois de suite.
- **Une émission en direct commence** : avec le nom de l'animateur.
- **Une émission en direct se termine** : avec le nom de l'animateur et la
  durée en minutes.
- **Les auditeurs atteignent un seuil** : choisissez 1, 5, 10, 25, 50, 100,
  250, 500 ou 1000 ; se déclenche une fois par jour quand les auditeurs
  l'atteignent. 1 signifie « quelqu'un écoute ».
- **Une station n'émet plus** : la station (ou tout AzuraCast) a cessé
  d'émettre depuis une minute.

L'intégration garde ce qu'elle a vu : un redémarrage de Gladys n'annonce pas
deux fois un direct ou un seuil, et un titre commencé entre-temps est annoncé
une fois.

### Actions

- **Titre en cours** : lit une station pour les actions suivantes : à
  l'antenne ou non, en direct ou non, titre complet, artiste, titre, album,
  animateur, titre suivant, auditeurs, et une phrase toute prête (« Ma Radio :
  À l'antenne, en direct avec DJ Max, Artiste – Titre, 12 auditeur(s) »).
- **Passer au titre suivant** : passe le morceau de l'AutoDJ. Demande la clé
  d'API de la configuration.

### Idées de scènes

- **Lampe « On air »** : « Une émission en direct commence » passe la lampe du
  studio en rouge ; « Une émission en direct se termine » l'éteint et vous
  envoie la durée.
- **Le titre sur la télé** : « Un nouveau titre passe » affiche le titre sur
  l'écran du salon, ou le dit sur l'enceinte.
- **Alerte hors antenne** : « Une station n'émet plus » vous envoie une
  notification ; une scène du matin passe un morceau qui ne vous plaît pas.

## Dépannage

- **AzuraCast ne répond pas** : vérifiez l'adresse depuis la machine qui fait
  tourner Gladys.
- **Aucun AzuraCast à cette adresse** : l'adresse mène à un autre service.
- **L'adresse redirige** : saisissez l'adresse en https://.
- **AzuraCast répond, mais ne montre aucune station publique** : cochez
  « Enable public API » dans le profil de la station.
- **Clé d'API refusée, ou sans droits sur cette station** : recréez la clé avec
  un utilisateur qui gère la station.
- **Pas de pochette dans le widget** : le morceau n'en a pas dans AzuraCast, ou
  son fichier dépasse 300 Ko (la limite de Gladys).

## Limites

- Un serveur AzuraCast par intégration ; les stations sans API publique ne
  sont pas vues.
- AzuraCast est lu à l'intervalle choisi (15 secondes par défaut), pas en
  temps réel : un morceau plus court que l'intervalle peut passer inaperçu.
- Passer un titre ne marche qu'avec l'AutoDJ d'AzuraCast (Liquidsoap), pas
  pendant un direct.
- Le pic du jour est mesuré par l'intégration à chaque lecture.
- Sans lien avec le projet AzuraCast.
