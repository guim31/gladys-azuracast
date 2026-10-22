// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `now_playing`.
//
// The use case: a glance at the wall tablet tells what the radio plays, with
// its album art, how many people listen, and whether a streamer is live. One
// station per widget (the `station` setting, the first station when empty).
// A Next song button with the API key, and a Listen button opening the public
// page of the station when its address is https (the only links the core
// accepts).
//
// The figures are sent as values, not bound to device features: the widget
// works before the device is added.
//
// Budget (8 components, 2 texts, 1 focal, 1 status, 4 buttons): the title
// (heading), the artist or the error (caption), the album art, two tiles, the
// status list, two buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { songText } from './azuracast/client.js';
import { ACTION_TEXT, CONNECTION_TEXT, ERROR_TEXT, STATE_TEXT, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ SKIP: 'skip' });

export const TEXT = {
  pick: {
    en: 'Enter the address of your AzuraCast in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre AzuraCast dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines AzuraCast in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su AzuraCast en la configuración de la integración.',
  },
  noStation: {
    en: 'No station: choose one in the settings of the widget.',
    fr: 'Aucune station : choisissez-en une dans les réglages du widget.',
    de: 'Kein Sender: Wähle einen in den Einstellungen des Widgets.',
    es: 'Ninguna emisora: elija una en los ajustes del widget.',
  },
  listeners: { en: 'Listeners', fr: 'Auditeurs', de: 'Zuhörer', es: 'Oyentes' },
  peak: { en: 'Peak today', fr: 'Pic du jour', de: 'Spitze heute', es: 'Pico de hoy' },
  next: { en: 'Next', fr: 'Ensuite', de: 'Danach', es: 'Después' },
  skip: { en: 'Next song', fr: 'Titre suivant', de: 'Nächster Titel', es: 'Siguiente' },
  listen: { en: 'Listen', fr: 'Écouter', de: 'Anhören', es: 'Escuchar' },
};

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

async function get(hub, { settings = {}, language = 'en' } = {}) {
  if (!hub.client) {
    return message(hub.config.url === null ? CONNECTION_TEXT.invalidUrl : TEXT.pick, language);
  }
  const id = hub.stationIdFor(settings.station);
  const view = id === null ? null : hub.stationView(id);
  if (!view) {
    return message(hub.error ? ERROR_TEXT[hub.error.kind] : TEXT.noStation, language);
  }
  const components = [];
  const song = view.song;
  if (song) {
    components.push({
      type: 'text',
      variant: 'heading',
      text: fit(song.title || songText(song), 40),
    });
  }
  if (hub.error) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: pick(ERROR_TEXT[hub.error.kind], language),
    });
  } else if (song?.artist && song.title) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: fit(song.album ? `${song.artist} · ${song.album}` : song.artist, 80),
    });
  }
  const art = await hub.prepareArt(song);
  if (art) {
    components.push({
      type: 'image',
      key: art,
      alt: fit(songText(song), 100),
      fit: 'contain',
    });
  }
  components.push(
    {
      type: 'value',
      value: view.listeners,
      label: pick(TEXT.listeners, language),
      icon: 'headphones',
      color: WIDGET_COLORS.PRIMARY,
    },
    {
      type: 'value',
      value: view.peak,
      label: pick(TEXT.peak, language),
      icon: 'trending-up',
      color: WIDGET_COLORS.NEUTRAL,
    },
  );
  const rows = [
    {
      label: fit(view.name, 40),
      value: pick(view.online ? STATE_TEXT.online : STATE_TEXT.offline, language),
      icon: view.online ? 'radio' : 'wifi-off',
      color: view.online ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
    },
  ];
  if (view.live) {
    rows.push({
      label: pick(STATE_TEXT.live, language),
      value: fit(view.streamer || '–', 40),
      icon: 'mic',
      color: WIDGET_COLORS.DANGER,
    });
  }
  if (view.next) {
    rows.push({
      label: pick(TEXT.next, language),
      value: fit(songText(view.next), 40),
      icon: 'skip-forward',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items: rows });
  // Skipping is for the AutoDJ of a station on air, never during a live show.
  if (hub.config.apiKey && view.fresh && view.online && !view.live) {
    components.push({
      type: 'button',
      label: pick(TEXT.skip, language),
      icon: 'skip-forward',
      style: 'secondary',
      action: { key: ACTIONS.SKIP, params: { station: view.id }, confirm: true },
    });
  }
  if (view.publicUrl.startsWith('https://')) {
    components.push({
      type: 'button',
      label: pick(TEXT.listen, language),
      icon: 'play',
      style: 'secondary',
      link: { url: view.publicUrl },
    });
  }
  // A song lasts a few minutes: refresh soon (the hub also nudges on change).
  return { ttl_seconds: view.online || hub.error ? 30 : 120, components };
}

async function action(hub, { actionKey, params = {}, language }) {
  if (actionKey !== ACTIONS.SKIP) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  const id = Number(params.station);
  const externalId = Number.isInteger(id) ? hub.stationExternalId(id) : null;
  await hub.skip(externalId, language);
  // AzuraCast updates its now playing a few seconds later: read it again soon.
  hub.schedulePoll(3_000);
  return { message: ACTION_TEXT.skipped };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
