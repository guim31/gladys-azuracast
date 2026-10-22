// -----------------------------------------------------------------------------
// The AzuraCast client against the real answers of AzuraCast in Docker
// (test/fixtures/azuracast): AutoDJ, live, off air; the key, the errors, the
// album art fetched from the configured address.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  AzuraCastClient,
  ERROR_KINDS,
  MAX_IMAGE_BYTES,
  imageType,
  normalizeNowPlaying,
  songText,
} from '../src/azuracast/client.js';

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/azuracast/${name}.json`, import.meta.url), 'utf8'));
const art = await readFile(new URL('./fixtures/azuracast/art.jpg', import.meta.url));

const KEY = 'abcdef0123456789:0123456789abcdef0123456789abcdef';

function clientWith(answer, { apiKey = '', url = 'http://192.0.2.10' } = {}) {
  const calls = [];
  const request = async (target, options) => {
    calls.push({ target, ...options });
    return typeof answer === 'function' ? answer(target, options) : answer;
  };
  return { client: new AzuraCastClient({ url, apiKey, request }), calls };
}

test('AutoDJ: the station, the song, the next one, the listeners', async () => {
  const [station] = normalizeNowPlaying(await fixture('autodj'));
  assert.equal(station.id, 3);
  assert.equal(station.shortcode, 'azuratest_radio');
  assert.equal(station.name, 'AzuraTest Radio');
  assert.equal(station.online, true);
  assert.equal(station.live, false);
  assert.equal(station.streamer, '');
  assert.equal(station.song.artist, 'Test Artist 4');
  assert.equal(station.song.title, 'Long Tone 4');
  assert.equal(station.song.album, 'Gladys Test Album');
  assert.ok(station.song.playId > 0);
  assert.equal(songText(station.song), 'Test Artist 4 – Long Tone 4');
  assert.ok(station.next.title);
  assert.equal(station.publicUrl, 'http://192.0.2.10/public/azuratest_radio');
});

test('live: the streamer and the start of the show', async () => {
  const [station] = normalizeNowPlaying(await fixture('live'));
  assert.equal(station.live, true);
  assert.equal(station.streamer, 'DJ Gladys');
  assert.equal(station.liveSince, 1792685824 * 1000);
  assert.equal(station.listeners, 4);
});

test('off air: is_online false, the "Station Offline" placeholder kept as a song', async () => {
  const [station] = normalizeNowPlaying(await fixture('offline'));
  assert.equal(station.online, false);
  assert.equal(station.song.playId, 0, 'the hub ignores a play id of 0');
});

test('the song text: "Artist – Title", or what AzuraCast has', () => {
  assert.equal(songText({ artist: 'A', title: 'T', text: 'A - T' }), 'A – T');
  assert.equal(songText({ artist: '', title: '', text: 'file name' }), 'file name');
  assert.equal(songText(null), '');
});

test('not AzuraCast: an object, a station without id, HTML', async () => {
  assert.throws(() => normalizeNowPlaying({}), { kind: ERROR_KINDS.NOT_AZURACAST });
  assert.throws(() => normalizeNowPlaying([{ station: {} }]), { kind: ERROR_KINDS.NOT_AZURACAST });
  const { client } = clientWith({ status: 200, body: '<html></html>' });
  await assert.rejects(client.nowPlaying(), { kind: ERROR_KINDS.NOT_AZURACAST });
});

test('no key on the public now playing, the key on the station routes', async () => {
  const body = JSON.stringify(await fixture('autodj'));
  const { client, calls } = clientWith(
    (target) =>
      target.endsWith('/status')
        ? { status: 200, body: JSON.stringify(fixtureStatus) }
        : target.endsWith('/skip')
          ? { status: 200, body: '{"success":true,"message":"Song skipped."}' }
          : { status: 200, body },
    { apiKey: KEY },
  );
  const fixtureStatus = await fixture('station-status');
  await client.nowPlaying();
  assert.equal(calls[0].target, 'http://192.0.2.10/api/nowplaying');
  assert.equal(calls[0].headers['x-api-key'], undefined);
  assert.deepEqual(await client.stationStatus(3), { backend: true, frontend: true });
  assert.equal(calls[1].headers['x-api-key'], KEY);
  await client.skip(3);
  assert.equal(calls[2].method, 'POST');
  assert.equal(calls[2].target, 'http://192.0.2.10/api/station/3/backend/skip');
});

test('errors: refused key, redirect, 404, 500, down, certificate', async () => {
  const cases = [
    [{ status: 403, body: 'Error: You must be logged in' }, ERROR_KINDS.AUTH],
    [{ status: 302, body: '' }, ERROR_KINDS.REDIRECT],
    [{ status: 404, body: '' }, ERROR_KINDS.NOT_AZURACAST],
    [{ status: 500, body: '' }, ERROR_KINDS.HTTP],
  ];
  for (const [answer, kind] of cases) {
    const { client } = clientWith(answer, { apiKey: KEY });
    await assert.rejects(client.skip(3), { kind });
  }
  const down = new AzuraCastClient({
    url: 'http://192.0.2.10',
    request: async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    },
  });
  await assert.rejects(down.nowPlaying(), { kind: ERROR_KINDS.UNREACHABLE });
  const tls = new AzuraCastClient({
    url: 'https://192.0.2.10',
    request: async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
      });
    },
  });
  await assert.rejects(tls.nowPlaying(), { kind: ERROR_KINDS.TLS });
  const { client } = clientWith({ status: 200, body: '{"success":false,"message":"No"}' });
  await assert.rejects(client.skip(3), /Skip refused: No/);
});

test('the album art: from the configured address, an image, 300 KB at most', async () => {
  const { client, calls } = clientWith({ status: 200, body: art });
  const bytes = await client.art('https://radio.example.org/api/station/x/art/abc-1.jpg?v=1');
  assert.equal(imageType(bytes), 'jpeg');
  assert.equal(calls[0].target, 'http://192.0.2.10/api/station/x/art/abc-1.jpg?v=1');
  assert.equal(calls[0].binary, true);
  assert.equal(calls[0].maxBytes, MAX_IMAGE_BYTES);
  assert.equal(calls[0].headers['x-api-key'], undefined);

  const sub = clientWith({ status: 200, body: art }, { url: 'https://example.org/radio' });
  await sub.client.art('https://example.org/radio/api/station/x/art/abc');
  await sub.client.art('/api/station/x/art/abc');
  assert.deepEqual(
    sub.calls.map((call) => call.target),
    [
      'https://example.org/radio/api/station/x/art/abc',
      'https://example.org/radio/api/station/x/art/abc',
    ],
  );

  const html = clientWith({ status: 200, body: Buffer.from('<html>') });
  await assert.rejects(html.client.art('/a'), /not a JPEG/);
  const generic = clientWith({ status: 302, body: Buffer.alloc(0) });
  await assert.rejects(generic.client.art('/a'), { kind: ERROR_KINDS.REDIRECT });
  const large = new AzuraCastClient({
    url: 'http://192.0.2.10',
    request: async () => {
      throw new Error('Response too large');
    },
  });
  await assert.rejects(large.art('/a'), /too large/);
});

test('the image formats the core accepts', () => {
  assert.equal(imageType(art), 'jpeg');
  assert.equal(imageType(Buffer.from('89504e470d0a1a0a0000', 'hex')), 'png');
  assert.equal(imageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')), 'webp');
  assert.equal(imageType(Buffer.from('GIF89a........')), null);
});
