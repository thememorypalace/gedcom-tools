# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## 0.1.0 (2026-11-02)

First public release.

- `convertTo7`, `convertTo551` and `convertGedcom`: convert between GEDCOM 5.5.1 and 7.0, with a report of every change and of everything that could not be converted without loss.
- `checkGedcom`: structured findings with stable codes, severity, line numbers, the person or family involved, and English messages.
- `repairGedcom`: repairs the form of a file (UTF-8, CHAR line, line endings, empty lines, indentation, HEAD and TRLR) without touching names, dates, places or links.
- `decodeGedcom`: reads UTF-8, UTF-16, ANSEL and Windows-1252, and tells when the header names the wrong character set.
- `gedcom-tools` command line tool with `convert`, `check` and `repair`.
- ESM and CommonJS builds with TypeScript types. Zero runtime dependencies.
