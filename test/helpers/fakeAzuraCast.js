// -----------------------------------------------------------------------------
// An in-memory AzuraCast, rendering /api/nowplaying from the real answer of
// AzuraCast in Docker (test/fixtures/azuracast/autodj.json), one entry per
// station: `is_online`, `listeners.current`, `live`, `now_playing` (with the
// "Station Offline" placeholder when off air, like AzuraCast), `playing_next`;
// the station status and the skip behind `X-API-Key`; the album art (a 302 for
// a song without art, like AzuraCast).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const BASE = 'http://192.0.2.10';
export const API_KEY = 'abcdef0123456789:0123456789abcdef0123456789abcdef';

const fixture = (name) => new URL(`../fixtures/azuracast/${name}`, import.meta.url);
const TEMPLATE = JSON.parse(readFileSync(fixture('autodj.json'), 'utf8'))[0];
export const ART = readFileSync(fixture('art.jpg'));

const clone = (value) => JSON.parse(JSON.stringify(value));

export const song = (n, { art = false } = {}) => ({
  id: `song${n}`,
  art: art
    ? `${BASE}/api/station/1/art/media${n}-1792684963.jpg`
    : `${BASE}/api/station/1/art/media${n}`,
  custom_fields: [],
  text: `Artist ${n} - Album ${n} - Title ${n}`,
  artist: `Artist ${n}`,
  title: `Title ${n}`,
  album: `Album ${n}`,
  genre: '',
  isrc: '',
  lyrics: '',
});

export class FakeAzuraCast {
  constructor({ now = () => Date.now(), apiKey = API_KEY } = {}) {
    this.now = now;
    this.apiKey = apiKey;
    this.stations = [];
    this.addStation({ id: 1, name: 'Radio Gladys', shortcode: 'radio_gladys' });
    /** 'down': the server does not answer; a number: that HTTP status. */
    this.failure = null;
    this.artBytes = ART;
    this.skips = [];
    this.requests = [];
    this.request = this.request.bind(this);
  }

  addStation({ id, name, shortcode }) {
    const station = {
      id,
      name,
      shortcode,
      online: true,
      listeners: 0,
      live: null, // { streamer, since }
      playId: 1,
      song: song(1, { art: true }),
      next: song(2),
      playedAt: Math.floor(this.now() / 1000),
      https: false,
    };
    this.stations.push(station);
    return station;
  }

  get station() {
    return this.stations[0];
  }

  /** The next song starts on the first station (or `station`). */
  play(n, { art = false, station = this.station } = {}) {
    station.playId += 1;
    station.song = song(n, { art });
    station.next = song(n + 1);
    station.playedAt = Math.floor(this.now() / 1000);
  }

  goLive(streamer = 'DJ Gladys', station = this.station) {
    station.live = { streamer, since: Math.floor(this.now() / 1000) };
  }

  endLive(station = this.station) {
    station.live = null;
  }

  entry(station) {
    const out = clone(TEMPLATE);
    const host = station.https ? 'https://radio.example.org' : BASE;
    Object.assign(out.station, {
      id: station.id,
      name: station.name,
      shortcode: station.shortcode,
      public_player_url: `${host}/public/${station.shortcode}`,
    });
    out.is_online = station.online;
    out.listeners = {
      total: station.listeners,
      unique: station.listeners,
      current: station.listeners,
    };
    out.live = station.live
      ? {
          is_live: true,
          streamer_name: station.live.streamer,
          broadcast_start: station.live.since,
          art: null,
        }
      : { is_live: false, streamer_name: '', broadcast_start: null, art: null };
    if (station.online) {
      Object.assign(out.now_playing, {
        sh_id: station.playId,
        played_at: station.playedAt,
        streamer: station.live?.streamer ?? '',
        song: clone(station.song),
      });
      out.playing_next = { ...out.playing_next, song: clone(station.next) };
    } else {
      // What AzuraCast shows for a station off air.
      Object.assign(out.now_playing, {
        sh_id: 0,
        played_at: 0,
        song: {
          ...song(0),
          art: `${BASE}/static/vite_dist/assets/generic_song.jpg`,
          text: 'Station Offline',
          artist: '',
          title: 'Station Offline',
          album: '',
        },
      });
    }
    return out;
  }

  async request(url, { method = 'GET', headers = {} } = {}) {
    const { pathname } = new URL(url);
    this.requests.push({ method, path: pathname, headers });
    if (this.failure === 'down') {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
    if (typeof this.failure === 'number') {
      return { status: this.failure, body: '' };
    }
    const json = (status, value) => ({ status, body: JSON.stringify(value) });
    const authorized = headers['x-api-key'] === this.apiKey;
    const denied = {
      status: 403,
      body: 'Error: You must be logged in to access this page.',
    };
    if (method === 'GET' && pathname === '/api/nowplaying') {
      return json(
        200,
        this.stations.map((station) => this.entry(station)),
      );
    }
    let match = pathname.match(/^\/api\/station\/(\d+)\/(status|backend\/skip)$/);
    if (match) {
      if (!authorized) {
        return denied;
      }
      const station = this.stations.find((s) => s.id === Number(match[1]));
      if (!station) {
        return json(404, { code: 404, message: 'Station not found.', success: false });
      }
      if (match[2] === 'status' && method === 'GET') {
        return json(200, { backendRunning: station.online, frontendRunning: station.online });
      }
      if (match[2] === 'backend/skip' && method === 'POST') {
        this.skips.push(station.id);
        return json(200, {
          success: true,
          message: 'Song skipped.',
          formatted_message: 'Song skipped.',
        });
      }
    }
    match = pathname.match(/^\/api\/station\/\d+\/art\/([a-z0-9]+)(-\d+\.jpg)?$/);
    if (match && method === 'GET') {
      return match[2]
        ? { status: 200, body: this.artBytes, type: 'image/jpeg' }
        : { status: 302, body: Buffer.alloc(0) };
    }
    return json(404, { code: 404, message: 'Record not found', success: false });
  }
}
