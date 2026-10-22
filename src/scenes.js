// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Is the station on air?" is already a scene condition on the device
// feature. The actions are about what a condition cannot do: put what plays
// in a message or a spoken sentence ("AzuraTest Radio: On air, Artist – Title,
// 3 listener(s)"), and skip to the next song (an AzuraCast API key in the
// configuration). Both take the station device chosen in the scene.
// -----------------------------------------------------------------------------

import { songText } from './azuracast/client.js';

export const SCENE_ACTIONS = {
  async get_now_playing(hub, { fields = {} }) {
    const view = await hub.commandStation(fields.station);
    return {
      online: view.online,
      live: view.live,
      text: songText(view.song),
      artist: view.song?.artist ?? '',
      title: view.song?.title ?? '',
      album: view.song?.album ?? '',
      streamer: view.streamer,
      next: songText(view.next),
      listeners: view.listeners,
      sentence: hub.sentence(view, hub.config.language),
    };
  },

  async skip_song(hub, { fields = {} }) {
    await hub.skip(fields.station);
    hub.schedulePoll(3_000);
  },
};
