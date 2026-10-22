# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-22

### Added

- Each public station of an AzuraCast server as a Gladys device: on air,
  listeners, peak listeners of the day, the song playing ("Artist – Title"),
  live or not, the streamer, the next song.
- Scene triggers: a new song plays (artist, title, album), a live show starts,
  a live show ends (with its duration), the listeners reach a threshold (1 to
  1000, once a day), a station goes off air; each one can be limited to a
  station.
- Scene actions: the song playing on a station (with a ready-made sentence),
  skip to the next song (with an AzuraCast API key).
- Dashboard widget: the song with its album art, listeners, peak of the day,
  live show and next song; a Next song button with the API key, a Listen
  button for an https:// station page.
- A "Test the connection" action, texts in English, French, German and
  Spanish.

[Unreleased]: https://github.com/guim31/gladys-azuracast/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-azuracast/releases/tag/v1.0.0
