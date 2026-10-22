// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene outputs
// and errors. Four languages, the four of the Gladys interface; German says
// "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './azuracast/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your AzuraCast in the configuration.',
    fr: "Saisissez l'adresse de votre AzuraCast dans la configuration.",
    de: 'Gib die Adresse deines AzuraCast in der Konfiguration ein.',
    es: 'Introduzca la dirección de su AzuraCast en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2',
    fr: 'Adresse incomprise, ex. http://192.168.1.2',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2',
    es: 'Dirección no válida, p. ej. http://192.168.1.2',
  },
  noStation: {
    en: 'AzuraCast answers, but shows no public station: check "Enable public API" in the profile of the station.',
    fr: 'AzuraCast répond, mais ne montre aucune station publique : cochez « Enable public API » dans le profil de la station.',
    de: 'AzuraCast antwortet, zeigt aber keinen öffentlichen Sender: Aktiviere „Enable public API“ im Profil des Senders.',
    es: 'AzuraCast responde, pero no muestra ninguna emisora pública: active «Enable public API» en el perfil de la emisora.',
  },
};

// One short explanation per error kind (src/azuracast/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'AzuraCast does not answer',
    fr: 'AzuraCast ne répond pas',
    de: 'AzuraCast antwortet nicht',
    es: 'AzuraCast no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: use an http:// address or a trusted certificate',
    fr: 'certificat refusé : utilisez une adresse http:// ou un certificat reconnu',
    de: 'Zertifikat abgelehnt: Nutze eine http://-Adresse oder ein vertrauenswürdiges Zertifikat',
    es: 'certificado rechazado: use una dirección http:// o un certificado reconocido',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API key refused, or without the rights on this station',
    fr: "clé d'API refusée, ou sans droits sur cette station",
    de: 'API-Schlüssel abgelehnt oder ohne Rechte für diesen Sender',
    es: 'clave de API rechazada, o sin permisos sobre esta emisora',
  },
  [ERROR_KINDS.NOT_AZURACAST]: {
    en: 'no AzuraCast at this address',
    fr: 'aucun AzuraCast à cette adresse',
    de: 'kein AzuraCast unter dieser Adresse',
    es: 'no hay ningún AzuraCast en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The state of a station, in words (widget, scene outputs).
export const STATE_TEXT = {
  online: { en: 'On air', fr: "À l'antenne", de: 'Auf Sendung', es: 'En antena' },
  offline: { en: 'Off air', fr: 'Hors antenne', de: 'Nicht auf Sendung', es: 'Fuera de antena' },
  live: { en: 'Live', fr: 'En direct', de: 'Live', es: 'En directo' },
};

// The "Test the connection" report and the `sentence` output of "Now playing".
export const REPORT_TEXT = {
  en: {
    ok: 'Connected',
    stations: (count) => `${count} station(s)`,
    listeners: (count) => `${count} listener(s)`,
    live: (name) => (name ? `live with ${name}` : 'live'),
    key: 'API key OK',
    services: 'services stopped',
  },
  fr: {
    ok: 'Connecté',
    stations: (count) => `${count} station(s)`,
    listeners: (count) => `${count} auditeur(s)`,
    live: (name) => (name ? `en direct avec ${name}` : 'en direct'),
    key: "clé d'API OK",
    services: 'services arrêtés',
  },
  de: {
    ok: 'Verbunden',
    stations: (count) => `${count} Sender`,
    listeners: (count) => `${count} Zuhörer`,
    live: (name) => (name ? `live mit ${name}` : 'live'),
    key: 'API-Schlüssel OK',
    services: 'Dienste gestoppt',
  },
  es: {
    ok: 'Conectado',
    stations: (count) => `${count} emisora(s)`,
    listeners: (count) => `${count} oyente(s)`,
    live: (name) => (name ? `en directo con ${name}` : 'en directo'),
    key: 'clave de API OK',
    services: 'servicios detenidos',
  },
};

// Errors and results of the scene actions and of the widget button.
export const ACTION_TEXT = {
  noKey: {
    en: 'Enter an AzuraCast API key in the configuration of the integration.',
    fr: "Saisissez une clé d'API AzuraCast dans la configuration de l'intégration.",
    de: 'Gib einen AzuraCast-API-Schlüssel in der Konfiguration der Integration ein.',
    es: 'Introduzca una clave de API de AzuraCast en la configuración de la integración.',
  },
  unknownStation: {
    en: 'Station unknown to AzuraCast: choose it again in the scene.',
    fr: 'Station inconnue d’AzuraCast : choisissez-la de nouveau dans la scène.',
    de: 'Sender ist AzuraCast unbekannt: Wähle ihn in der Szene erneut aus.',
    es: 'Emisora desconocida para AzuraCast: elíjala de nuevo en la escena.',
  },
  skipped: {
    en: 'Next song requested.',
    fr: 'Titre suivant demandé.',
    de: 'Nächster Titel angefordert.',
    es: 'Siguiente canción solicitada.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
