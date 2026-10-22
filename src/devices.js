// -----------------------------------------------------------------------------
// The Gladys devices, proposed in the Discovery tab: one per public station of
// the AzuraCast server (its id is the station id of AzuraCast, which never
// changes, not its short name, which the user can edit):
//
//   online         input/binary            1 the station broadcasts, 0 not
//   listeners      counter-sensor/integer  listeners right now
//   listeners_peak counter-sensor/integer  peak of listeners today (local day)
//   now_playing    text/text               "Artist – Title"
//   live           input/binary            1 a streamer is live, 0 AutoDJ
//   streamer       text/text               the live streamer ("—" when none)
//   next_track     text/text               the next song ("—" when unknown)
//
// Published with should_poll: false: the integration reads AzuraCast on its
// own timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { songText } from './azuracast/client.js';

export const DEVICE_TYPE = 'station';
export const MODEL = 'AzuraCast';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  ONLINE: 'online',
  LISTENERS: 'listeners',
  LISTENERS_PEAK: 'listeners_peak',
  NOW_PLAYING: 'now_playing',
  LIVE: 'live',
  STREAMER: 'streamer',
  NEXT_TRACK: 'next_track',
});

// A text state is never empty, or Gladys ignores it.
export const NONE = '—';

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.ONLINE]: 'On air',
    [FEATURE_KEYS.LISTENERS]: 'Listeners',
    [FEATURE_KEYS.LISTENERS_PEAK]: 'Peak listeners today',
    [FEATURE_KEYS.NOW_PLAYING]: 'Now playing',
    [FEATURE_KEYS.LIVE]: 'Live',
    [FEATURE_KEYS.STREAMER]: 'Streamer',
    [FEATURE_KEYS.NEXT_TRACK]: 'Next track',
  },
  fr: {
    [FEATURE_KEYS.ONLINE]: "À l'antenne",
    [FEATURE_KEYS.LISTENERS]: 'Auditeurs',
    [FEATURE_KEYS.LISTENERS_PEAK]: "Pic d'auditeurs du jour",
    [FEATURE_KEYS.NOW_PLAYING]: 'Titre en cours',
    [FEATURE_KEYS.LIVE]: 'En direct',
    [FEATURE_KEYS.STREAMER]: 'Animateur',
    [FEATURE_KEYS.NEXT_TRACK]: 'Titre suivant',
  },
  de: {
    [FEATURE_KEYS.ONLINE]: 'Auf Sendung',
    [FEATURE_KEYS.LISTENERS]: 'Zuhörer',
    [FEATURE_KEYS.LISTENERS_PEAK]: 'Zuhörerspitze heute',
    [FEATURE_KEYS.NOW_PLAYING]: 'Aktueller Titel',
    [FEATURE_KEYS.LIVE]: 'Live',
    [FEATURE_KEYS.STREAMER]: 'Moderator',
    [FEATURE_KEYS.NEXT_TRACK]: 'Nächster Titel',
  },
  es: {
    [FEATURE_KEYS.ONLINE]: 'En antena',
    [FEATURE_KEYS.LISTENERS]: 'Oyentes',
    [FEATURE_KEYS.LISTENERS_PEAK]: 'Pico de oyentes de hoy',
    [FEATURE_KEYS.NOW_PLAYING]: 'Canción actual',
    [FEATURE_KEYS.LIVE]: 'En directo',
    [FEATURE_KEYS.STREAMER]: 'Locutor',
    [FEATURE_KEYS.NEXT_TRACK]: 'Siguiente canción',
  },
};

// Display bound (the core never applies it on write).
export const MAX_LISTENERS = 100_000;

export const stationIds = (gladys, stationId) => gladys.externalIds(DEVICE_TYPE, String(stationId));

/** The AzuraCast station id of a device external id, null when not ours. */
export function stationIdOf(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  const prefix = stationIds(gladys, '').device;
  if (!externalId.startsWith(prefix)) {
    return null;
  }
  const id = Number(externalId.slice(prefix.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

const binary = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.INPUT, DEVICE_FEATURE_TYPES.SENSOR.BINARY, {
    keep_history: true,
    min: 0,
    max: 1,
  });

const counter = (name, externalId) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    { keep_history: true, min: 0, max: MAX_LISTENERS },
  );

const text = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, {
    keep_history: false,
    // NOT NULL in the core, even for a text: 422 on "Add to Gladys" without them.
    min: 0,
    max: 0,
  });

/**
 * The discovery payload of a station.
 * @param {object} gladys
 * @param {{ id: number, name: string, shortcode: string }} station
 * @param {string} [language]
 */
export function buildStationDevice(gladys, station, language = 'en') {
  const ids = stationIds(gladys, station.id);
  const names = NAMES[language] ?? NAMES.en;
  const id = (key) => ids.feature(key);
  return {
    name: station.name,
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: [{ name: 'STATION_SHORTCODE', value: station.shortcode.slice(0, 255) }],
    features: [
      binary(names[FEATURE_KEYS.ONLINE], id(FEATURE_KEYS.ONLINE)),
      counter(names[FEATURE_KEYS.LISTENERS], id(FEATURE_KEYS.LISTENERS)),
      counter(names[FEATURE_KEYS.LISTENERS_PEAK], id(FEATURE_KEYS.LISTENERS_PEAK)),
      text(names[FEATURE_KEYS.NOW_PLAYING], id(FEATURE_KEYS.NOW_PLAYING)),
      binary(names[FEATURE_KEYS.LIVE], id(FEATURE_KEYS.LIVE)),
      text(names[FEATURE_KEYS.STREAMER], id(FEATURE_KEYS.STREAMER)),
      text(names[FEATURE_KEYS.NEXT_TRACK], id(FEATURE_KEYS.NEXT_TRACK)),
    ],
  };
}

/**
 * The value of every feature of a station:
 * `{ key, device_feature_external_id, state | text }`.
 * @param {object} gladys
 * @param {object} view the station as the hub sees it (src/hub.js `stationView()`)
 */
export function stationValues(gladys, view) {
  const ids = stationIds(gladys, view.id);
  const values = [{ key: FEATURE_KEYS.ONLINE, state: view.online ? 1 : 0 }];
  if (view.fresh) {
    values.push(
      { key: FEATURE_KEYS.LISTENERS, state: Math.min(view.listeners, MAX_LISTENERS) },
      { key: FEATURE_KEYS.LISTENERS_PEAK, state: Math.min(view.peak, MAX_LISTENERS) },
      { key: FEATURE_KEYS.NOW_PLAYING, text: songText(view.song) || NONE },
      { key: FEATURE_KEYS.LIVE, state: view.live ? 1 : 0 },
      { key: FEATURE_KEYS.STREAMER, text: (view.live && view.streamer) || NONE },
      { key: FEATURE_KEYS.NEXT_TRACK, text: songText(view.next) || NONE },
    );
  }
  return values.map(({ key, ...value }) => ({
    key,
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}
