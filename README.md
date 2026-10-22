# AzuraCast for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings an [AzuraCast](https://www.azuracast.com) server — a self-hosted
web radio with AutoDJ and live shows — into Gladys.

- **One device per public station**: on air, listeners, peak listeners of the
  day, the song playing ("Artist – Title"), live or not, the streamer, the
  next song.
- **Scene triggers**: a new song plays (artist, title, album), a live show
  starts, a live show ends (with its duration), the listeners reach a
  threshold (1 to 1000, once a day), a station goes off air — each one can be
  limited to a station.
- **Scene actions**: the song playing on a station (with a ready-made
  sentence), skip to the next song (with an AzuraCast API key).
- **Dashboard widget**: the song with its album art, listeners, peak of the
  day, live show and next song; a Next song button with the API key, a Listen
  button for an https:// station page.
- Texts in English, French, German and Spanish.

Tested against a real AzuraCast in Docker (rolling release after 0.23.9,
October 2026) with generated test tones, listeners and a live show streamed by
ffmpeg. Feedback welcome on
[the issues](https://github.com/guim31/gladys-azuracast/issues).

## Requirements

- Gladys Assistant 5.1.0 or later.
- An AzuraCast server reachable from Gladys, at home or on the Internet
  (https://), with the public API enabled on its stations (the default).
- Optional: an AzuraCast API key of a user who manages the stations, to skip
  songs.

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-azuracast`. Then open its configuration,
enter the address of AzuraCast, and add the stations from the Discover tab.

The full guide: [docs/en.md](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

The container reads the public `GET /api/nowplaying` (every station in one
request, no key) at the chosen interval (15 seconds by default), publishes the
states of the devices when they change and fires the scene events on the
transitions. A station goes off air after one minute without broadcasting, and
a live show ends after one minute without streamer, so a short cut fires
nothing. What each station was is kept in `/data`: a restart neither announces
a transition twice nor misses one. With the API key, `POST
/api/station/<id>/backend/skip` skips a song and
`GET /api/station/<id>/status` checks the services in "Test the connection".
The album art is fetched from the configured address and served to the
dashboard by the integration (300 KB at most). Redirects are not followed, so
the key is never sent to another host.

## Limits

- One AzuraCast server per configuration; stations without public API are not
  seen.
- AzuraCast is read at an interval, not through its real-time feed (SSE): a
  song shorter than the interval may be missed.
- Skipping only works with the AutoDJ (Liquidsoap).
- A self-signed HTTPS certificate is not accepted (use `http://` on the local
  network).

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the notes on the
AzuraCast API.

## Credits

- [AzuraCast](https://github.com/AzuraCast/AzuraCast) by Buster Neece and
  contributors (AGPL-3.0): the API answers in `test/fixtures/azuracast` come
  from its Docker image; the logo on the cover is its official logotype
  (`resources/logotype.svg` of its repository).
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and on the architecture of
  [gladys-owncast](https://github.com/guim31/gladys-owncast).

Not affiliated with AzuraCast or its authors.

## License

Apache-2.0, see [LICENSE](LICENSE).
