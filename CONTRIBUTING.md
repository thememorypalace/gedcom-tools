# Contributing

Thanks for taking the time to help.

## Reporting a problem

Open an issue with:

- what you ran (library call or CLI command),
- what you expected and what happened,
- a small GEDCOM snippet that shows the problem.

Please never attach a real family tree. Replace names, dates and places of real people, especially living people, with made up ones. A few lines are usually enough.

## Pull requests

1. `npm install`
2. Make your change in `src/`, and add a test in `test/` with a small fixture of fictional people.
3. `npm run typecheck && npm run build && npm test`
4. Add a line to `CHANGELOG.md` under a new "Unreleased" heading.

Finding codes, change codes and warning codes are part of the public API. Do not rename or remove them in a minor release; add new ones instead.

The core (`src/` except `cli.ts`) must stay free of Node APIs and runtime dependencies, so it keeps working in browsers and web workers.

## References

- GEDCOM 7 specification: https://gedcom.io/specs/
- Migration guide from 5.5.1 to 7.0: https://gedcom.io/migrate/
