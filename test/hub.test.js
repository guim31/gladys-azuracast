// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and a fake AzuraCast: discovery,
// states, songs, lives starting and ending (with the grace for a
// reconnection), listener thresholds and the peak of the day, stations going
// off air, persistence across restarts, errors, scene actions, the widget and
// its album art, quiet logs, and the reading timer of the container.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS, NONE } from '../src/devices.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import {
  API_KEY,
  BASE,
  FakeAzuraCast,
  createClock,
  createDevices,
  createWorld,
  idsOf,
} from './helpers/world.js';

const MINUTE = 60_000;
const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const state = (world, key, station = 1) => world.fake.lastState(idsOf(world, station).feature(key));
const text = (world, key, station = 1) => {
  const id = idsOf(world, station).feature(key);
  return world.fake.states.filter((entry) => entry.device_feature_external_id === id).at(-1)?.text;
};

async function captureLogs(t, level, fn) {
  const lines = [];
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const before = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = before;
  }
  return lines;
}

/** A world whose station device is added. */
async function addedWorld(t, options = {}) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createDevices(world);
  return world;
}

test('one device per station, named after it, proposed in Discovery, nothing polled by Gladys', async (t) => {
  const azuracast = new FakeAzuraCast();
  azuracast.addStation({ id: 4, name: 'Second', shortcode: 'second' });
  const world = await createWorld({ azuracast });
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => [device.name, device.external_id]),
    [
      ['Radio Gladys', idsOf(world, 1).device],
      ['Second', idsOf(world, 4).device],
    ],
  );
  assert.equal(devices[0].should_poll, false);
  assert.equal(devices[0].poll_frequency, undefined);
  assert.deepEqual(
    devices[0].features.map((feature) => feature.external_id.split(':').at(-1)),
    Object.values(FEATURE_KEYS),
  );
  assert.deepEqual(devices[0].params, [{ name: 'STATION_SHORTCODE', value: 'radio_gladys' }]);
  assert.equal(world.fake.states.length, 0, 'nothing published for a device not added');
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.deepEqual(world.fake.sceneEvents, [], 'first sight: no event');
});

test('the states of the added device at once, then only the changes', async (t) => {
  const world = await addedWorld(t);
  assert.equal(state(world, FEATURE_KEYS.ONLINE), 1);
  assert.equal(state(world, FEATURE_KEYS.LISTENERS), 0);
  assert.equal(text(world, FEATURE_KEYS.NOW_PLAYING), 'Artist 1 – Title 1');
  assert.equal(text(world, FEATURE_KEYS.NEXT_TRACK), 'Artist 2 – Title 2');
  assert.equal(state(world, FEATURE_KEYS.LIVE), 0);
  assert.equal(text(world, FEATURE_KEYS.STREAMER), NONE, 'never an empty text');
  assert.deepEqual(world.fake.transports.at(-1), {
    device_external_id: idsOf(world).device,
    transport: 'local',
  });
  assert.ok(world.fake.widgetRefreshes.includes(WIDGET_KEY));
  const before = world.fake.states.length;
  await world.hub.pollNow();
  assert.equal(world.fake.states.length, before, 'nothing changed, nothing sent');
});

test('a new song: the state and "A new song plays", once per play', async (t) => {
  const world = await addedWorld(t);
  world.azuracast.play(5);
  await world.hub.pollNow();
  await world.hub.pollNow();
  assert.equal(text(world, FEATURE_KEYS.NOW_PLAYING), 'Artist 5 – Title 5');
  assert.deepEqual(
    events(world, TRIGGERS.TRACK).map((event) => event.data),
    [
      {
        station: idsOf(world).device,
        station_name: 'Radio Gladys',
        artist: 'Artist 5',
        title: 'Title 5',
        album: 'Album 5',
        text: 'Artist 5 – Title 5',
      },
    ],
  );
  // The same song again is another play.
  world.azuracast.play(5);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.TRACK).length, 2);
});

test('a live show: started at once, ended after a minute without streamer, with its length', async (t) => {
  const world = await addedWorld(t);
  world.azuracast.goLive('DJ Gladys');
  await world.hub.pollNow();
  assert.equal(state(world, FEATURE_KEYS.LIVE), 1);
  assert.equal(text(world, FEATURE_KEYS.STREAMER), 'DJ Gladys');
  assert.deepEqual(
    events(world, TRIGGERS.LIVE_STARTED).map((event) => event.data),
    [{ station: idsOf(world).device, station_name: 'Radio Gladys', streamer: 'DJ Gladys' }],
  );

  // A dropped connection, back within the grace: the same show.
  world.clock.advance(20 * MINUTE);
  world.azuracast.endLive();
  await world.hub.pollNow();
  world.clock.advance(30_000);
  world.azuracast.goLive('DJ Gladys');
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.LIVE_STARTED).length, 1);
  assert.equal(events(world, TRIGGERS.LIVE_ENDED).length, 0);

  world.clock.advance(10 * MINUTE);
  world.azuracast.endLive();
  await world.hub.pollNow();
  assert.equal(state(world, FEATURE_KEYS.LIVE), 1, 'not yet over');
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.LIVE_ENDED).map((event) => event.data),
    [
      {
        station: idsOf(world).device,
        station_name: 'Radio Gladys',
        streamer: 'DJ Gladys',
        duration_minutes: 31,
      },
    ],
  );
  assert.equal(state(world, FEATURE_KEYS.LIVE), 0);
  assert.equal(text(world, FEATURE_KEYS.STREAMER), NONE);
});

test('another streamer takes over: one show ends, another starts', async (t) => {
  const world = await addedWorld(t);
  world.azuracast.goLive('Alice');
  await world.hub.pollNow();
  world.clock.advance(5 * MINUTE);
  world.azuracast.goLive('Bob');
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.LIVE_STARTED).map((event) => event.data.streamer),
    ['Alice', 'Bob'],
  );
  assert.deepEqual(
    events(world, TRIGGERS.LIVE_ENDED).map((event) => [
      event.data.streamer,
      event.data.duration_minutes,
    ]),
    [['Alice', 5]],
  );
});

test('listener thresholds: once a day each, the peak of the day, reset at midnight', async (t) => {
  const world = await addedWorld(t);
  world.azuracast.station.listeners = 12;
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.LISTENERS).map((event) => [event.data.threshold, event.data.listeners]),
    [
      [1, 12],
      [5, 12],
      [10, 12],
    ],
  );
  world.azuracast.station.listeners = 3;
  await world.hub.pollNow();
  world.azuracast.station.listeners = 11;
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.LISTENERS).length, 3, 'once a day');
  assert.equal(state(world, FEATURE_KEYS.LISTENERS), 11);
  assert.equal(state(world, FEATURE_KEYS.LISTENERS_PEAK), 12);

  // The next day (18:00 + 7 h): the peak starts again; already reached, no event.
  world.clock.advance(7 * 60 * MINUTE);
  await world.hub.pollNow();
  assert.equal(state(world, FEATURE_KEYS.LISTENERS_PEAK), 11);
  assert.equal(events(world, TRIGGERS.LISTENERS).length, 3);
  world.azuracast.station.listeners = 30;
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.LISTENERS)
      .slice(3)
      .map((event) => event.data.threshold),
    [25],
  );
});

test('off air for a minute: "A station goes off air", once, and back on air', async (t) => {
  const world = await addedWorld(t);
  world.azuracast.station.online = false;
  await world.hub.pollNow();
  assert.equal(state(world, FEATURE_KEYS.ONLINE), 1, 'a hiccup is not off air');
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  await world.hub.pollNow();
  assert.equal(state(world, FEATURE_KEYS.ONLINE), 0);
  assert.equal(state(world, FEATURE_KEYS.LISTENERS), 0);
  assert.equal(text(world, FEATURE_KEYS.NOW_PLAYING), NONE, 'not "Station Offline"');
  assert.deepEqual(
    events(world, TRIGGERS.OFFLINE).map((event) => event.data),
    [{ station: idsOf(world).device, station_name: 'Radio Gladys' }],
  );
  assert.equal(events(world, TRIGGERS.TRACK).length, 0);
  world.azuracast.station.online = true;
  await world.hub.pollNow();
  assert.equal(state(world, FEATURE_KEYS.ONLINE), 1);
  assert.equal(events(world, TRIGGERS.TRACK).length, 0, 'the same play goes on');
});

test('AzuraCast silent: unreachable badge, off air after the grace, back again', async (t) => {
  const world = await addedWorld(t);
  world.azuracast.failure = 'down';
  await world.hub.pollNow();
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.equal(world.fake.connectionStatus.message.en, 'AzuraCast does not answer');
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  assert.equal(state(world, FEATURE_KEYS.ONLINE), 0);
  assert.equal(events(world, TRIGGERS.OFFLINE).length, 1);
  assert.equal(world.fake.discoveredDevices.length, 1, 'the Discovery list is kept');
  world.azuracast.failure = null;
  await world.hub.pollNow();
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
  assert.equal(state(world, FEATURE_KEYS.ONLINE), 1);
});

test('an empty list (a station restarting) keeps the Discovery list', async (t) => {
  const world = await addedWorld(t);
  const stations = world.azuracast.stations;
  const transports = world.fake.transports.length;
  world.azuracast.stations = [];
  await world.hub.pollNow();
  assert.equal(world.fake.discoveredDevices.length, 1);
  assert.equal(world.fake.connectionStatus.connected, true, 'within the grace');
  assert.equal(world.fake.transports.length, transports, 'the badge stays');
  assert.equal(state(world, FEATURE_KEYS.ONLINE), 1, 'within the grace');
  world.azuracast.stations = stations;
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.OFFLINE).length, 0);
});

test('a failed reading at midnight announces no threshold again', async (t) => {
  const world = await addedWorld(t);
  world.azuracast.station.listeners = 30;
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.LISTENERS).length, 4);
  world.azuracast.failure = 'down';
  world.clock.advance(6 * 60 * MINUTE + 30_000); // past midnight
  await world.hub.pollNow();
  world.azuracast.failure = null;
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.LISTENERS).length, 4);
  assert.equal(state(world, FEATURE_KEYS.LISTENERS_PEAK), 30);
});

test('a mistyped address keeps what was saved about the server', async (t) => {
  const world = await addedWorld(t);
  world.azuracast.station.listeners = 30;
  await world.hub.pollNow();
  world.azuracast.station.listeners = 2;
  await world.fake.configUpdated({ url: 'ftp://typo', language: 'en' });
  await world.fake.configUpdated({ url: BASE, language: 'en' });
  assert.equal(state(world, FEATURE_KEYS.LISTENERS_PEAK), 30);
});

test('a restart of the integration fires nothing twice, and misses nothing', async (t) => {
  const clock = createClock();
  const azuracast = new FakeAzuraCast({ now: clock.now });
  const first = await addedWorld(t, { clock, azuracast });
  azuracast.goLive('DJ Gladys');
  azuracast.station.listeners = 6;
  await first.hub.pollNow();
  await first.app.stop();

  // Back 10 minutes later: same live, same song, a new song since.
  clock.advance(10 * MINUTE);
  azuracast.play(7);
  const second = await createWorld({ clock, azuracast, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.equal(events(second, TRIGGERS.LIVE_STARTED).length, 0);
  assert.equal(events(second, TRIGGERS.LISTENERS).length, 0);
  assert.equal(events(second, TRIGGERS.TRACK).length, 1, 'the song played meanwhile');
  azuracast.endLive();
  await second.hub.pollNow();
  clock.advance(MINUTE);
  await second.hub.pollNow();
  assert.equal(events(second, TRIGGERS.LIVE_ENDED)[0].data.duration_minutes, 10);
});

test('another server: what was saved about the previous one is dropped', async (t) => {
  const world = await addedWorld(t);
  await world.fake.configUpdated({ url: 'http://192.0.2.20', language: 'en' });
  assert.deepEqual(world.fake.sceneEvents, []);
  assert.equal(world.hub.saved.url, 'http://192.0.2.20');
});

test('no address, a wrong address, a refused API answer', async (t) => {
  const empty = await createWorld({ config: {} });
  t.after(() => empty.app.stop());
  assert.equal(empty.fake.connectionStatus.connected, false);
  assert.match(empty.fake.connectionStatus.message.fr, /Saisissez l'adresse/);
  const wrong = await createWorld({ config: { url: 'ftp://x' } });
  t.after(() => wrong.app.stop());
  assert.match(wrong.fake.connectionStatus.message.en, /Address not understood/);
  const azuracast = new FakeAzuraCast();
  azuracast.stations = [];
  const none = await createWorld({ azuracast });
  t.after(() => none.app.stop());
  assert.match(none.fake.connectionStatus.message.en, /Enable public API/);
});

test('"Test the connection": the stations, the API key', async (t) => {
  const world = await addedWorld(t, { config: { url: BASE, language: 'en', api_key: API_KEY } });
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  const message = ack.data?.message ?? ack.data;
  assert.match(
    message.en,
    /^Connected · 1 station\(s\) · Radio Gladys: On air, Artist 1 – Title 1, 0 listener\(s\) · API key OK$/,
  );
  assert.match(message.fr, /Radio Gladys : À l'antenne/);
  world.azuracast.apiKey = 'other';
  const refused = await world.fake.action('test_connection', {});
  const refusedMessage = refused.data?.message ?? refused.data;
  assert.match(refusedMessage.en, /API key refused/);
});

test('scene action "Now playing": the outputs and a sentence', async (t) => {
  const world = await addedWorld(t);
  world.azuracast.goLive('DJ Gladys');
  world.azuracast.station.listeners = 3;
  world.clock.advance(10_000);
  const ack = await world.fake.sceneAction('get_now_playing', { station: idsOf(world).device });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    online: true,
    live: true,
    text: 'Artist 1 – Title 1',
    artist: 'Artist 1',
    title: 'Title 1',
    album: 'Album 1',
    streamer: 'DJ Gladys',
    next: 'Artist 2 – Title 2',
    listeners: 3,
    sentence: 'Radio Gladys: On air, live with DJ Gladys, Artist 1 – Title 1, 3 listener(s)',
  });
  const unknown = await world.fake.sceneAction('get_now_playing', { station: 'other:station:9' });
  assert.equal(unknown.success, false);
});

test('scene action "Skip to the next song": the key, the station', async (t) => {
  const world = await addedWorld(t);
  const noKey = await world.fake.sceneAction('skip_song', { station: idsOf(world).device });
  assert.equal(noKey.success, false);
  assert.match(noKey.error, /API key/);
  await world.fake.configUpdated({ url: BASE, language: 'en', api_key: API_KEY });
  const ack = await world.fake.sceneAction('skip_song', { station: idsOf(world).device });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(world.azuracast.skips, [1]);
  world.azuracast.apiKey = 'other';
  const refused = await world.fake.sceneAction('skip_song', { station: idsOf(world).device });
  assert.match(refused.error, /API key refused/);
});

test('the widget: song, album art, listeners, status, buttons, in the budget', async (t) => {
  const world = await addedWorld(t, { config: { url: BASE, language: 'fr', api_key: API_KEY } });
  world.azuracast.station.https = true;
  world.azuracast.station.listeners = 4;
  await world.hub.pollNow();
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'fr' });
  assert.equal(ack.success, true, ack.error);
  const content = ack.data.content ?? ack.data;
  assert.deepEqual(validateWidgetContent(content), []);
  const types = content.components.map((component) => component.type);
  assert.deepEqual(types, [
    'text',
    'text',
    'image',
    'value',
    'value',
    'status',
    'button',
    'button',
  ]);
  assert.equal(content.components[0].text, 'Title 1');
  assert.equal(content.components[1].text, 'Artist 1 · Album 1');
  assert.equal(content.components[3].value, 4);
  assert.deepEqual(
    content.components[5].items.map((item) => [item.label, item.value]),
    [
      ['Radio Gladys', "À l'antenne"],
      ['Ensuite', 'Artist 2 – Title 2'],
    ],
  );
  assert.deepEqual(content.components[7].link, {
    url: 'https://radio.example.org/public/radio_gladys',
  });

  // The album art, served by the integration.
  const image = await world.fake.widgetGetImage(content.components[2].key);
  assert.equal(image.success, true, image.error);
  assert.equal(Buffer.from(image.data.image, 'base64')[0], 0xff);

  // The button skips the song.
  const action = await world.fake.widgetAction(
    WIDGET_KEY,
    'skip',
    content.components[6].action.params,
    {
      settings: {},
    },
  );
  assert.equal(action.success, true, action.error);
  assert.deepEqual(world.azuracast.skips, [1]);

  // Live: the streamer, and no Next song button (the AutoDJ is not playing).
  world.azuracast.goLive('DJ Gladys');
  await world.hub.pollNow();
  const live = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'fr' });
  const liveContent = live.data.content ?? live.data;
  assert.deepEqual(validateWidgetContent(liveContent), []);
  const status = liveContent.components.find((c) => c.type === 'status');
  assert.deepEqual(status.items[1], {
    label: 'En direct',
    value: 'DJ Gladys',
    icon: 'mic',
    color: 'danger',
  });
  assert.ok(!liveContent.components.some((c) => c.action?.key === 'skip'));
});

test('a song without art is not asked again at every display', async (t) => {
  const world = await addedWorld(t);
  world.azuracast.play(4);
  await world.hub.pollNow();
  const arts = () => world.azuracast.requests.filter((r) => r.path.includes('/art/')).length;
  await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'fr' });
  assert.equal(arts(), 1);
});

test('the widget: no art for a song without one, one station chosen, errors', async (t) => {
  const azuracast = new FakeAzuraCast();
  const second = azuracast.addStation({ id: 4, name: 'Second', shortcode: 'second' });
  second.song.art = second.song.art.replace(/-\d+\.jpg$/, '');
  const world = await addedWorld(t, { azuracast });
  const ack = await world.fake.widgetGet(WIDGET_KEY, {
    settings: { station: idsOf(world, 4).device },
    language: 'en',
  });
  const content = ack.data.content ?? ack.data;
  assert.deepEqual(validateWidgetContent(content), []);
  assert.ok(!content.components.some((component) => component.type === 'image'));
  assert.ok(!content.components.some((component) => component.type === 'button'));
  assert.equal(content.components.find((c) => c.type === 'status').items[0].label, 'Second');

  azuracast.failure = 'down';
  await world.hub.pollNow();
  const down = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  const downContent = down.data.content ?? down.data;
  assert.deepEqual(validateWidgetContent(downContent), []);
  assert.ok(downContent.components.some((c) => c.text === 'AzuraCast does not answer'));
});

test('quiet logs: a normal cycle writes nothing at info level', async (t) => {
  const world = await addedWorld(t);
  const lines = await captureLogs(t, 'info', async () => {
    world.azuracast.play(3);
    world.azuracast.station.listeners = 2;
    await world.hub.pollNow();
    await world.hub.pollNow();
  });
  assert.deepEqual(lines, []);
});

test('the timer of the container reads AzuraCast, Gladys never has to poll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const world = await addedWorld(t, { timers: true });
  const reads = () =>
    world.azuracast.requests.filter((request) => request.path === '/api/nowplaying').length;
  const before = reads();
  world.azuracast.play(9);
  t.mock.timers.tick(15_000);
  // Let the read and its publication settle.
  for (let i = 0; i < 20; i += 1) {
    await new Promise(setImmediate);
  }
  assert.equal(reads(), before + 1);
  assert.equal(text(world, FEATURE_KEYS.NOW_PLAYING), 'Artist 9 – Title 9');
});
