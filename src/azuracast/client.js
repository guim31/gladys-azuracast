// -----------------------------------------------------------------------------
// AzuraCast client: the HTTP API of an AzuraCast server (AGPL-3.0,
// https://github.com/AzuraCast/AzuraCast), checked against AzuraCast in Docker
// (test/fixtures/azuracast):
//
//   GET  /api/nowplaying                  public, no key: one entry per public
//        station — `station` (id, name, shortcode, public_player_url),
//        `listeners.current`, `live` (is_live, streamer_name,
//        broadcast_start), `now_playing` (sh_id, song: text, artist, title,
//        album, art), `playing_next`, `is_online`
//   GET  /api/station/<id>/status         `X-API-Key`: whether the station
//        services run (`backendRunning`, `frontendRunning`)
//   POST /api/station/<id>/backend/skip   `X-API-Key`: skip to the next song
//   GET  <now_playing.song.art>           the album art (JPEG or PNG); a 302 to
//        the generic picture of AzuraCast for a song without art
//
// Redirects are not followed: the API key would be sent to wherever the
// address points (an http:// address redirected to https:// is reported).
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // the API key is refused, or lacks the permission
  NOT_AZURACAST: 'not_azuracast', // something answers, not the AzuraCast API
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  HTTP: 'http', // any other HTTP error
});

export class AzuraCastError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'AzuraCastError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// /api/nowplaying holds the song history of every station: a few hundred KB
// for a server with many stations.
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
// What the Gladys core accepts for a widget image (decoded bytes).
export const MAX_IMAGE_BYTES = 300 * 1024;

/**
 * The one function that talks to the network (fetch). The client takes it as
 * a parameter: the tests replace it with an in-memory AzuraCast
 * (test/helpers/fakeAzuraCast.js).
 * @returns {Promise<{ status: number, body: string|Buffer, type?: string }>}
 *   `body` is a Buffer when `binary` is set
 */
export async function httpRequest(
  url,
  { method = 'GET', headers = {}, body, timeoutMs = 10_000, binary = false, maxBytes } = {},
) {
  const limit = maxBytes ?? MAX_BODY_BYTES;
  const response = await fetch(url, {
    method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > limit) {
    await response.body?.cancel();
    throw new Error('Response too large');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > limit) {
    throw new Error('Response too large');
  }
  return {
    status: response.status,
    body: binary ? bytes : bytes.toString('utf8'),
    type: response.headers.get('content-type') ?? '',
  };
}

const clean = (value, max) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

const count = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
};

/** A Unix time in seconds (AzuraCast) to milliseconds, null when absent. */
const secondsToMs = (value) => (Number.isFinite(value) && value > 0 ? value * 1000 : null);

/** "Artist – Title", or what AzuraCast has ("Artist - Title", a file name). */
export function songText(song) {
  if (!song) {
    return '';
  }
  if (song.artist && song.title) {
    return `${song.artist} – ${song.title}`;
  }
  return song.title || song.text || song.artist;
}

function normalizeSong(raw) {
  if (!raw || typeof raw !== 'object' || !raw.song || typeof raw.song !== 'object') {
    return null;
  }
  const song = {
    artist: clean(raw.song.artist, 150),
    title: clean(raw.song.title, 150),
    album: clean(raw.song.album, 150),
    text: clean(raw.song.text, 255),
    art: typeof raw.song.art === 'string' ? raw.song.art.trim() : '',
  };
  if (!song.artist && !song.title && !song.text) {
    return null;
  }
  return {
    ...song,
    // The id of this play in the song history: a song played twice in a row
    // is two plays.
    playId: raw.sh_id ?? null,
    songId: clean(raw.song.id, 64),
    playedAt: secondsToMs(raw.played_at),
    playlist: clean(raw.playlist, 100),
  };
}

/**
 * One entry of /api/nowplaying, normalized.
 * @returns {{ id: number, shortcode: string, name: string, online: boolean,
 *   listeners: number, live: boolean, streamer: string,
 *   liveSince: number|null, song: object|null, next: object|null,
 *   publicUrl: string }}
 */
export function normalizeStation(raw) {
  const station = raw?.station;
  if (!station || typeof station !== 'object' || !Number.isInteger(station.id)) {
    throw new AzuraCastError(
      ERROR_KINDS.NOT_AZURACAST,
      'The answer is not an AzuraCast now playing entry',
    );
  }
  const live = raw.live?.is_live === true;
  return {
    id: station.id,
    shortcode: clean(station.shortcode, 100),
    name: clean(station.name, 100) || clean(station.shortcode, 100) || `#${station.id}`,
    online: raw.is_online === true,
    listeners: count(raw.listeners?.current ?? raw.listeners?.total),
    live,
    streamer: live ? clean(raw.live?.streamer_name, 100) : '',
    liveSince: live ? secondsToMs(raw.live?.broadcast_start) : null,
    song: normalizeSong(raw.now_playing),
    next: normalizeSong(raw.playing_next),
    publicUrl: typeof station.public_player_url === 'string' ? station.public_player_url : '',
  };
}

/** The whole /api/nowplaying answer, normalized and sorted by station id. */
export function normalizeNowPlaying(raw) {
  if (!Array.isArray(raw)) {
    throw new AzuraCastError(ERROR_KINDS.NOT_AZURACAST, 'The answer is not an AzuraCast list');
  }
  return raw.map(normalizeStation).sort((a, b) => a.id - b.id);
}

/** The magic numbers of the image formats the Gladys core accepts. */
export function imageType(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'png';
  }
  if (
    bytes.length > 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export class AzuraCastClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} [options.apiKey] for the station status and skipping
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, apiKey = '', request = httpRequest, timeoutMs }) {
    this.url = url;
    this.apiKey = apiKey;
    this.request = request;
    this.timeoutMs = timeoutMs ?? 10_000;
  }

  get hasKey() {
    return Boolean(this.apiKey);
  }

  async call(target, { method = 'GET', headers = {}, body, binary, maxBytes } = {}) {
    try {
      return await this.request(target, {
        method,
        headers: { accept: binary ? 'image/*' : 'application/json', ...headers },
        body,
        binary,
        maxBytes,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      const code = err.cause?.code ?? err.code;
      if (TLS_CODES.has(code)) {
        throw new AzuraCastError(ERROR_KINDS.TLS, `Certificate refused (${code})`);
      }
      throw new AzuraCastError(ERROR_KINDS.UNREACHABLE, code ?? err.message ?? err.name);
    }
  }

  check({ status }, path) {
    if (status === 401 || status === 403) {
      throw new AzuraCastError(ERROR_KINDS.AUTH, `Refused (HTTP ${status})`, { status });
    }
    if (status >= 300 && status < 400) {
      throw new AzuraCastError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw new AzuraCastError(ERROR_KINDS.NOT_AZURACAST, `Not found: ${path} (HTTP 404)`, {
        status,
      });
    }
    if (status < 200 || status >= 300) {
      throw new AzuraCastError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, { status });
    }
  }

  keyHeaders() {
    return this.apiKey ? { 'x-api-key': this.apiKey } : {};
  }

  async json(path, options = {}) {
    const response = await this.call(`${this.url}${path}`, options);
    this.check(response, path);
    try {
      return JSON.parse(response.body);
    } catch {
      throw new AzuraCastError(ERROR_KINDS.NOT_AZURACAST, `The answer of ${path} is not JSON`);
    }
  }

  /**
   * Every station whose public API is enabled, with what plays now. A public
   * route: no key is sent. AzuraCast answers an empty list for a moment while
   * a station restarts.
   * @throws {AzuraCastError}
   */
  async nowPlaying() {
    return normalizeNowPlaying(await this.json('/api/nowplaying'));
  }

  /**
   * Whether the services of a station run (needs the API key).
   * @returns {Promise<{ backend: boolean, frontend: boolean }>}
   * @throws {AzuraCastError} AUTH when the key is refused
   */
  async stationStatus(stationId) {
    const raw = await this.json(`/api/station/${stationId}/status`, {
      headers: this.keyHeaders(),
    });
    // camelCase in the answers of AzuraCast 0.23, snake_case in its docs.
    return {
      backend: (raw?.backendRunning ?? raw?.backend_running) === true,
      frontend: (raw?.frontendRunning ?? raw?.frontend_running) === true,
    };
  }

  /**
   * Skip to the next song (needs the API key, and the AutoDJ of AzuraCast).
   * @throws {AzuraCastError} AUTH when the key is refused
   */
  async skip(stationId) {
    const raw = await this.json(`/api/station/${stationId}/backend/skip`, {
      method: 'POST',
      headers: this.keyHeaders(),
    });
    if (raw && raw.success === false) {
      throw new AzuraCastError(ERROR_KINDS.HTTP, `Skip refused: ${clean(raw.message, 200)}`);
    }
  }

  /**
   * The album art of a song, fetched from the configured server whatever the
   * host AzuraCast writes in its URLs (its "base URL" setting can be a public
   * name Gladys cannot reach). No key is sent.
   * @returns {Promise<Buffer>} a JPEG, PNG or WebP of at most MAX_IMAGE_BYTES
   * @throws {AzuraCastError}
   */
  async art(artUrl) {
    let path;
    try {
      const parsed = new URL(artUrl, this.url);
      path = `${parsed.pathname}${parsed.search}`;
    } catch {
      throw new AzuraCastError(ERROR_KINDS.HTTP, 'Invalid album art address');
    }
    const base = new URL(this.url);
    // A server under a sub-path writes it in its URLs already.
    const prefix = base.pathname.replace(/\/+$/, '');
    const target = `${base.origin}${prefix && path.startsWith(`${prefix}/`) ? '' : prefix}${path}`;
    let response;
    try {
      response = await this.call(target, { binary: true, maxBytes: MAX_IMAGE_BYTES });
    } catch (err) {
      if (err.kind === ERROR_KINDS.UNREACHABLE && /too large/i.test(err.message)) {
        throw new AzuraCastError(ERROR_KINDS.HTTP, 'Album art too large');
      }
      throw err;
    }
    this.check(response, path.split('?')[0]);
    if (!imageType(response.body)) {
      throw new AzuraCastError(ERROR_KINDS.HTTP, 'The album art is not a JPEG, PNG or WebP');
    }
    return response.body;
  }
}
