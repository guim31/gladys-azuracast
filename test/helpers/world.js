// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake AzuraCast, a temporary
// /data and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs: the tests read AzuraCast with
// `world.hub.pollNow()`. (Adapted from guim31/gladys-owncast.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { stationIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { API_KEY, BASE, FakeAzuraCast } from './fakeAzuraCast.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

/** A manual clock, shared by the hub, the fake AzuraCast and the tests. */
export function createClock(start = new Date(2026, 9, 22, 18, 0, 0).getTime()) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export async function createWorld({
  clock = createClock(),
  azuracast,
  config = { url: BASE, language: 'en' },
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-azuracast-')),
  timings = {},
  timers = false,
} = {}) {
  const server = azuracast ?? new FakeAzuraCast({ now: clock.now });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: server.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, azuracast: server, app, hub: app.hub, clock, dataDir };
}

/** The external ids of a station device (the first station by default). */
export const idsOf = (world, stationId = 1) => stationIds(world.gladys, stationId);

/** Add the discovered devices in Gladys, as the user would. */
export async function createDevices(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { API_KEY, BASE, FakeAzuraCast };
