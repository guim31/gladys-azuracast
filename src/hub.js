// -----------------------------------------------------------------------------
// The AzuraCast hub: /api/nowplaying read on a timer of the container (the
// interval chosen in the configuration), one request for every station; the
// states of the station devices published when they change, the scene events
// fired on transitions, and the views the widget and the scene actions read.
// (Adapted from guim31/gladys-owncast.)
//
// Gladys never polls the devices (should_poll: false, see the CLAUDE.md
// polling trap of the 5.2 core): the timer of the container does.
//
// Two rules on top of what AzuraCast says, so that a hiccup fires nothing:
// a station is off air once it has been offline (or AzuraCast silent, or the
// station gone from the list) for GRACE_MS, and a live is over once no
// streamer has been connected for GRACE_MS — a streamer whose connection
// drops for a few seconds neither ends the live nor starts a new one. What
// each station was (the play in progress, the live, the peak of the day and
// the listener thresholds reached today) is kept in /data (src/store.js): a
// restart of the integration or of Gladys neither fires a transition twice
// nor misses one.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { buildStationDevice, stationIdOf, stationIds, stationValues } from './devices.js';
import { AzuraCastClient, AzuraCastError, songText } from './azuracast/client.js';
import { hostOf, isLocalAddress, normalizeConfig as normalizeIntegrationConfig } from './config.js';
import { ProblemLog } from './problems.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  STATE_TEXT,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'azuracast-hub' });

export const WIDGET_KEY = 'now_playing';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  TRACK: 'track_changed',
  LIVE_STARTED: 'live_started',
  LIVE_ENDED: 'live_ended',
  LISTENERS: 'listeners_reached',
  OFFLINE: 'station_offline',
});

// The listener counts the "listeners reached" trigger offers (manifest
// options of its `threshold` field): each one fires at most once a day.
export const LISTENER_MILESTONES = [1, 5, 10, 25, 50, 100, 250, 500, 1000];

export const HUB_TIMINGS = {
  // Off air, or no streamer, for this long before it counts.
  graceMs: 60_000,
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A scene action reads AzuraCast again when the last read is older.
  freshMs: 5_000,
};

const MINUTE = 60_000;
// Album arts kept in memory for the widget (at most 300 KB each).
const ART_CACHE_SIZE = 8;
// A missing album art is asked again after this long.
const ART_RETRY_MS = 10 * MINUTE;

const emptySaved = () => ({ known: false, stations: {} });

/** The local day (the supervisor sets TZ to the time zone of Gladys). */
export function dayOf(time) {
  const date = new Date(time);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** What identifies the play in progress: a song played twice is two plays. */
function playKey(station) {
  if (!station.online || !station.song) {
    return null;
  }
  if (station.song.playId) {
    return `play:${station.song.playId}`;
  }
  return `song:${station.song.songId || songText(station.song)}:${station.song.playedAt ?? ''}`;
}

export class AzuraCastHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/azuracast/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeIntegrationConfig({});
    this.client = null;
    this.signature = null;
    /** @type {Map<number, object>} the stations of the last successful read */
    this.stations = new Map();
    this.readAt = 0;
    this.error = null;
    this.polling = null;
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = emptySaved();
    this.arts = new Map(); // image key → art URL
    this.artImages = new Map(); // image key → base64, the last few
    this.artFailures = new Map(); // image key → time of the failure
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved =
      saved && saved.known === true && saved.stations && typeof saved.stations === 'object'
        ? saved
        : emptySaved();
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previousUrl = this.signature === null ? null : JSON.parse(this.signature)[0];
    this.config = config;
    const signature = JSON.stringify([config.url, config.apiKey]);
    if (signature !== this.signature) {
      if (previousUrl && config.url && previousUrl !== config.url) {
        // Another server: what was saved about the previous one means nothing.
        this.saved = emptySaved();
        this.store.save(this.saved);
      }
      this.signature = signature;
      this.client = config.url
        ? new AzuraCastClient({ url: config.url, apiKey: config.apiKey, request: this.request })
        : null;
      this.stations = new Map();
      this.readAt = 0;
      this.error = null;
      this.polling = null;
      this.transports.clear();
      this.arts.clear();
      this.artImages.clear();
      this.artFailures.clear();
    }
    // A new language: new names for Discovery.
    this.discovered = null;
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges(true, { publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  /** The next read by the timer, after `delayMs` (the refresh interval by default). */
  schedulePoll(delayMs = this.config.pollIntervalMs) {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    const timer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading AzuraCast works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      // A sooner read asked meanwhile (after a skip) keeps its timer.
      if (this.pollTimer === timer) {
        this.schedulePoll();
      }
    }, delayMs);
    this.pollTimer = timer;
  }

  // --- Reading AzuraCast -----------------------------------------------------

  /** Read the server now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Read again when the last read is older than `freshMs` (scene actions). */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /**
   * Read the server and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    let stations;
    try {
      stations = await client.nowPlaying();
    } catch (err) {
      if (!(err instanceof AzuraCastError)) {
        throw err;
      }
      // Checked after the await: a read of a previous client never lands.
      return client === this.client && this.applyFailure(err);
    }
    if (client !== this.client) {
      return false;
    }
    return this.applySuccess(stations);
  }

  async applySuccess(list) {
    if (this.error) {
      logger.info('AzuraCast answers again');
    }
    if (this.readAt === 0) {
      logger.info(`AzuraCast (${hostOf(this.config.url)}): ${list.length} public station(s)`);
    }
    const before = JSON.stringify(this.views());
    const wasError = this.error !== null || this.readAt === 0;
    this.error = null;
    this.readAt = this.now();
    this.stations = new Map(list.map((station) => [station.id, station]));
    await this.observeAll();
    return wasError || JSON.stringify(this.views()) !== before;
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`AzuraCast: ${err.message}`);
    }
    // AzuraCast silent: its stations go off air after the grace.
    await this.observeAll();
    return wasError !== err.kind;
  }

  /** Compare every station with what was saved; fire the events, publish the states. */
  async observeAll() {
    const now = this.now();
    const events = [];
    let dirty = false;
    if (!this.saved.known || this.saved.url !== this.config.url) {
      this.saved = { known: true, url: this.config.url, stations: {} };
      dirty = true;
    }
    const ids = new Set([...this.stations.keys(), ...Object.keys(this.saved.stations).map(Number)]);
    for (const id of ids) {
      const station = this.error ? null : (this.stations.get(id) ?? null);
      dirty = this.transition(id, station, now, events) || dirty;
    }
    if (dirty) {
      this.store.save(this.saved);
    }
    for (const [key, data] of events) {
      await this.fire(key, data);
    }
    await this.publishStates();
  }

  /**
   * One station: the saved state against what AzuraCast says (null: nothing
   * known now, AzuraCast silent or the station gone); queue the scene events.
   * Synchronous: a concurrent read cannot interleave.
   * @returns {boolean} whether the saved state changed
   */
  transition(id, station, now, events) {
    const day = dayOf(now);
    let saved = this.saved.stations[id];
    if (!saved) {
      if (!station) {
        return false;
      }
      // First sight: the states, no event.
      this.saved.stations[id] = {
        name: station.name,
        online: station.online,
        play: playKey(station),
        live: station.online && station.live,
        streamer: station.streamer,
        liveSince: station.online && station.live ? (station.liveSince ?? now) : null,
        day,
        peak: station.listeners,
        milestones: LISTENER_MILESTONES.filter((m) => station.listeners >= m),
      };
      return true;
    }
    let dirty = false;
    const set = (key, value) => {
      if (saved[key] !== value) {
        saved[key] = value;
        dirty = true;
      }
    };
    const base = () => ({ station: stationIds(this.gladys, id).device, station_name: saved.name });
    if (station) {
      set('name', station.name);
    }

    // On air or not.
    if (station?.online) {
      if (saved.offlineSince !== undefined) {
        delete saved.offlineSince;
        dirty = true;
      }
      if (!saved.online) {
        logger.info(`${saved.name}: on air`);
      }
      set('online', true);
    } else if (saved.online) {
      if (saved.offlineSince === undefined) {
        saved.offlineSince = now;
        dirty = true;
      }
      if (now - saved.offlineSince >= this.timings.graceMs) {
        delete saved.offlineSince;
        saved.online = false;
        dirty = true;
        logger.info(`${saved.name}: off air`);
        events.push([TRIGGERS.OFFLINE, base()]);
      }
    }

    // The listeners of the day.
    // Only on a reading of the station: a failed reading at midnight would
    // forget the thresholds already reached and announce them again.
    if (saved.day !== day && station) {
      saved.day = day;
      saved.peak = station.listeners;
      // Already reached at midnight: nothing to announce.
      saved.milestones = LISTENER_MILESTONES.filter((m) => saved.peak >= m);
      dirty = true;
    }
    if (station) {
      if (station.listeners > saved.peak) {
        saved.peak = station.listeners;
        dirty = true;
      }
      for (const milestone of LISTENER_MILESTONES) {
        if (station.listeners >= milestone && !saved.milestones.includes(milestone)) {
          saved.milestones.push(milestone);
          dirty = true;
          events.push([
            TRIGGERS.LISTENERS,
            { ...base(), threshold: milestone, listeners: station.listeners },
          ]);
        }
      }
    }

    // The song.
    const play = station ? playKey(station) : null;
    if (play && play !== saved.play) {
      saved.play = play;
      dirty = true;
      const song = station.song;
      events.push([
        TRIGGERS.TRACK,
        {
          ...base(),
          artist: song.artist,
          title: song.title,
          album: song.album,
          text: songText(song),
        },
      ]);
    }

    // The live: what AzuraCast says when it knows the station, else unchanged.
    if (station) {
      const live = station.online && station.live;
      if (live) {
        const endingSince = saved.liveEndingSince;
        if (endingSince !== undefined) {
          // Back before the end was confirmed: the same live goes on.
          delete saved.liveEndingSince;
          dirty = true;
        }
        if (
          saved.live &&
          station.streamer &&
          saved.streamer &&
          station.streamer !== saved.streamer
        ) {
          // Another streamer took over: one live ends, another starts.
          this.endLive(id, endingSince ?? now, events, base());
        }
        if (!saved.live) {
          saved.live = true;
          saved.streamer = station.streamer;
          saved.liveSince = Math.min(now, station.liveSince ?? now);
          dirty = true;
          logger.info(`${saved.name}: live${station.streamer ? ` with ${station.streamer}` : ''}`);
          events.push([TRIGGERS.LIVE_STARTED, { ...base(), streamer: station.streamer }]);
        }
        set('streamer', station.streamer || saved.streamer);
      } else if (saved.live) {
        if (saved.liveEndingSince === undefined) {
          saved.liveEndingSince = now;
          dirty = true;
        }
        if (now - saved.liveEndingSince >= this.timings.graceMs) {
          this.endLive(id, saved.liveEndingSince, events, base());
          dirty = true;
        }
      }
    }
    return dirty;
  }

  /** The live of a station is over at `endAt`: the event, the saved state. */
  endLive(id, endAt, events, base) {
    const saved = this.saved.stations[id];
    const minutes = Math.max(0, Math.round((endAt - (saved.liveSince ?? endAt)) / MINUTE));
    logger.info(`${saved.name}: live ended after ${minutes} min`);
    events.push([
      TRIGGERS.LIVE_ENDED,
      { ...base, streamer: saved.streamer ?? '', duration_minutes: minutes },
    ]);
    saved.live = false;
    saved.streamer = '';
    saved.liveSince = null;
    delete saved.liveEndingSince;
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Views -----------------------------------------------------------------

  /** A station as the device, the widget and the scene actions see it. */
  stationView(id) {
    const saved = this.saved.stations[id];
    const station = this.error ? null : (this.stations.get(id) ?? null);
    if (!saved && !station) {
      return null;
    }
    const live = saved ? saved.live === true : station.online && station.live;
    const online = saved ? saved.online === true : station.online;
    return {
      id,
      name: station?.name || saved?.name || `#${id}`,
      // Read from AzuraCast just now (else only "online" is known).
      fresh: station !== null,
      online,
      listeners: station?.online ? station.listeners : 0,
      peak: saved?.peak ?? station?.listeners ?? 0,
      song: station?.online ? station.song : null,
      next: station?.online ? station.next : null,
      live,
      streamer: live ? station?.streamer || saved?.streamer || '' : '',
      liveMinutes:
        live && saved?.liveSince
          ? Math.max(0, Math.floor((this.now() - saved.liveSince) / MINUTE))
          : 0,
      publicUrl: station?.publicUrl ?? '',
    };
  }

  /** Every known station, by id. */
  views() {
    const ids = new Set([...this.stations.keys(), ...Object.keys(this.saved.stations).map(Number)]);
    return [...ids].sort((a, b) => a - b).map((id) => this.stationView(id));
  }

  /** The device external id of a station. */
  stationExternalId(id) {
    return stationIds(this.gladys, id).device;
  }

  /**
   * The station of a device external id (a widget setting, a scene field),
   * or the first station when none is given.
   * @returns {number|null}
   */
  stationIdFor(externalId) {
    if (externalId) {
      return stationIdOf(this.gladys, externalId);
    }
    const first = this.views()[0];
    return first ? first.id : null;
  }

  // --- Album art (widget) ----------------------------------------------------

  /** The image key of an art URL: changes with the URL (AzuraCast dates it). */
  artKey(url) {
    const key = `art-${createHash('sha1').update(url).digest('hex').slice(0, 24)}`;
    this.arts.delete(key);
    this.arts.set(key, url);
    while (this.arts.size > 50) {
      this.arts.delete(this.arts.keys().next().value);
    }
    return key;
  }

  /**
   * Fetch the album art of a song for the widget.
   * @returns {Promise<string|null>} its image key, null when unusable (too large…)
   */
  async prepareArt(song) {
    if (!song?.art || !this.client) {
      return null;
    }
    const key = this.artKey(song.art);
    // A song without art (a 302 to the generic picture) is not asked again
    // at every display of the widget.
    if (this.now() - (this.artFailures.get(key) ?? -Infinity) < ART_RETRY_MS) {
      return null;
    }
    try {
      await this.artImage(key);
      this.artFailures.delete(key);
      return key;
    } catch (err) {
      logger.debug(`Album art not shown: ${err.message}`);
      this.artFailures.set(key, this.now());
      while (this.artFailures.size > 50) {
        this.artFailures.delete(this.artFailures.keys().next().value);
      }
      return null;
    }
  }

  /** The raw base64 of an image key (onWidgetGetImage). */
  async artImage(key) {
    if (this.artImages.has(key)) {
      return this.artImages.get(key);
    }
    const url = this.arts.get(key);
    if (!url || !this.client) {
      throw new Error(`Unknown image ${key}`);
    }
    const base64 = (await this.client.art(url)).toString('base64');
    this.artImages.set(key, base64);
    while (this.artImages.size > ART_CACHE_SIZE) {
      this.artImages.delete(this.artImages.keys().next().value);
    }
    return base64;
  }

  // --- Publishing to Gladys --------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  discoveredDevices() {
    if (!this.client) {
      return [];
    }
    // Nothing read, or the empty list of a restarting station: keep the list
    // Gladys has.
    if (this.readAt === 0 || this.error || this.stations.size === 0) {
      return null;
    }
    return [...this.stations.values()].map((station) =>
      buildStationDevice(this.gladys, station, this.config.language),
    );
  }

  /** Publish the Discovery list when it changed (a new station, a new name…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices();
    if (devices === null) {
      return;
    }
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read AzuraCast, publish the stations again. */
  async rediscover() {
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /**
   * The user added (or updated) a device: its states sent before were
   * dropped by Gladys (the SDK already forgot them), and it needs its badge.
   */
  async onDeviceCreated() {
    this.transports.clear();
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.pollNow();
  }

  /** The states of the added devices. The SDK skips the unchanged values. */
  async publishStates() {
    if (this.readAt === 0) {
      return;
    }
    const states = this.views()
      .filter((view) => this.isCreated(stationIds(this.gladys, view.id).device))
      .flatMap((view) => stationValues(this.gladys, view))
      .map(({ key: _key, ...state }) => state);
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of each device: local or cloud (from the address), or unreachable. */
  async publishTransports() {
    if (!this.client || this.readAt === 0) {
      return;
    }
    const reachable = isLocalAddress(this.config.url)
      ? DEVICE_TRANSPORTS.LOCAL
      : DEVICE_TRANSPORTS.CLOUD;
    const changes = [];
    for (const view of this.views()) {
      const externalId = stationIds(this.gladys, view.id).device;
      if (!this.isCreated(externalId)) {
        continue;
      }
      // Missing from a list AzuraCast is rebuilding: unchanged within the grace.
      const transport =
        view.fresh || (!this.error && view.online) ? reachable : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        changes.push({ external_id: externalId, transport });
      }
    }
    if (changes.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(changes);
      for (const { external_id: externalId, transport } of changes) {
        this.transports.set(externalId, transport);
      }
      this.problems.recover('transports', 'Transports accepted again');
    } catch (err) {
      this.problems.fail('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (this.config.url === '') {
      return { connected: false, message: CONNECTION_TEXT.noUrl };
    }
    if (!this.config.url) {
      return { connected: false, message: CONNECTION_TEXT.invalidUrl };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    // An empty list (a station restarting) is only reported after the grace.
    const onAir = Object.values(this.saved.stations).some((saved) => saved.online);
    if (this.readAt !== 0 && this.stations.size === 0 && !onAir) {
      return { connected: false, message: CONNECTION_TEXT.noStation };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands (scene actions, widget, report) ------------------------------

  /** Throws the reason AzuraCast cannot answer, if any. */
  assertReadable() {
    if (!this.config.url || this.error) {
      throw new Error(pick(this.connectionStatus().message, this.config.language));
    }
  }

  /**
   * The station a command targets, read just now.
   * @param {string} [externalId] the device chosen in the scene or the widget
   */
  async commandStation(externalId) {
    if (!this.client) {
      this.assertReadable();
    }
    await this.refreshIfStale();
    this.assertReadable();
    const id = this.stationIdFor(externalId);
    if (id === null || !this.stations.has(id)) {
      throw new Error(pick(ACTION_TEXT.unknownStation, this.config.language));
    }
    return this.stationView(id);
  }

  /** Skip to the next song of a station (API key). */
  async skip(externalId, language = this.config.language) {
    if (!this.client) {
      this.assertReadable();
    }
    if (!this.config.apiKey) {
      throw new Error(pick(ACTION_TEXT.noKey, language));
    }
    const view = await this.commandStation(externalId);
    try {
      await this.client.skip(view.id);
    } catch (err) {
      if (!(err instanceof AzuraCastError)) {
        throw err;
      }
      logger.warn(`${view.name}: next song refused: ${err.message}`);
      throw new Error(pick(ERROR_TEXT[err.kind], language), { cause: err });
    }
    logger.info(`${view.name}: next song requested`);
    return view;
  }

  /** One line about a station, in a language. */
  sentence(view, language) {
    const text = REPORT_TEXT[language] ?? REPORT_TEXT.en;
    const parts = [pick(view.online ? STATE_TEXT.online : STATE_TEXT.offline, language)];
    if (view.online) {
      if (view.live) {
        parts.push(text.live(view.streamer));
      }
      const song = songText(view.song);
      if (song) {
        parts.push(song);
      }
      parts.push(text.listeners(view.listeners));
    }
    return labelled(view.name, parts.join(', '), language);
  }

  /** "Test the connection": read AzuraCast now, one line. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const status = this.connectionStatus();
    let services = null;
    if (status.connected && this.config.apiKey) {
      services = { stopped: false, error: null };
      // In parallel, three stations at most: the action has 30 seconds.
      const results = await Promise.allSettled(
        [...this.stations.keys()].slice(0, 3).map((id) => this.client.stationStatus(id)),
      );
      for (const result of results) {
        if (result.status === 'fulfilled') {
          services.stopped ||= !result.value.backend || !result.value.frontend;
        } else if (result.reason instanceof AzuraCastError) {
          if (!services.error) {
            logger.warn(`Station status: ${result.reason.message}`);
          }
          services.error ??= result.reason.kind;
        } else {
          throw result.reason;
        }
      }
    }
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (!status.connected) {
        message[language] = pick(status.message, language);
        continue;
      }
      const parts = [text.ok, text.stations(this.stations.size)];
      for (const view of this.views()
        .filter((v) => v.fresh)
        .slice(0, 3)) {
        parts.push(this.sentence(view, language));
      }
      if (services?.error) {
        parts.push(pick(ERROR_TEXT[services.error], language));
      } else if (services) {
        parts.push(text.key);
        if (services.stopped) {
          parts.push(text.services);
        }
      }
      message[language] = parts.join(' · ');
    }
    return message;
  }
}
