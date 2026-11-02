# gedcom-tools

Convert GEDCOM 5.5.1 files to GEDCOM 7.0 (and back), check GEDCOM files for errors, and read the old character sets that genealogy programs still write (ANSEL, Windows-1252, UTF-16).

- Zero runtime dependencies.
- Runs in Node 18+, browsers, web workers, Deno and Bun. The core never touches the file system or the network, so family data stays where it is.
- ESM and CommonJS builds, TypeScript types included.
- A small command line tool for quick jobs.

## Install

```sh
npm install @thememorypalace/gedcom-tools
```

## Usage

### Convert 5.5.1 to 7.0

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { convertTo7 } from "@thememorypalace/gedcom-tools";

const bytes = readFileSync("tree.ged"); // pass bytes, so the character set is detected
const { text, report } = convertTo7(bytes);

writeFileSync("tree-v7.ged", text, "utf8");

for (const change of report.changeList) console.log(change.message);
// Header rewritten for the new version
// 3 CONC lines joined
// 1 dual years (such as 1648/9) converted, original kept as PHRASE
// ...

for (const warning of report.warnings) console.log(warning.code, warning.count, warning.examples);
// subn_removed 1 [ { line: 7, text: '1 SUBN @SN1@' } ]
```

What the conversion does, following the [GEDCOM 7.0 specification](https://gedcom.io/specs/) and the official [migration guide](https://gedcom.io/migrate/):

- writes a 7.0 header (no `CHAR`, no `GEDC.FORM`, no `HEAD.FILE`) and always outputs UTF-8;
- joins `CONC` lines, keeps `CONT`, applies the 7.0 `@` escaping rule;
- renames IDs that are not valid in 7.0 (such as `@I-1@`) and updates every pointer;
- turns `NOTE` records into `SNOTE`, and inline `OBJE` and `SOUR` into records;
- turns file paths into URLs and `FORM jpg` into media types such as `image/jpeg`;
- converts calendar escapes, B.C. dates, dual years (`1648/9`) and date phrases, keeping the original wording in `PHRASE`;
- converts ages (`CHILD`, `INFANT`, `STILLBORN`), enumerations, `RELA` to `ROLE`, `ROMN` and `FONE` to `TRAN`, `AFN`, `RFN` and `RIN` to `EXID`, and language names to BCP 47 tags;
- keeps unknown tags as underscore extension tags, so nothing is silently dropped.

`convertTo551(input)` goes the other way, for programs that cannot read 7.0 yet. `convertGedcom(input)` picks the obvious direction: a 7.0 file goes to 5.5.1, anything else goes to 7.0.

Options: `{ bom?: boolean, lineEnding?: "\r\n" | "\n" }`. The defaults are a UTF-8 byte order mark and CRLF line endings.

### Check a file

```ts
import { checkGedcom } from "@thememorypalace/gedcom-tools";

const result = checkGedcom(readFileSync("tree.ged"));

console.log(result.version, result.encoding.used, result.people, result.families);
for (const finding of result.issues) {
  console.log(finding.severity, finding.code, finding.count, finding.title);
  console.log(finding.examples[0]); // { line: 25, text: 'FAMC @F9@', who: { id: 'I3', name: 'Lotte Dewitte' } }
}
```

Each finding has a stable `code`, a `severity` (`error`, `warning` or `info`), a `count`, up to 50 `examples` with line numbers and the person or family involved, an English `title` and `message`, and `fixable` when `repairGedcom` can fix it.

| Area | Codes |
| --- | --- |
| Character set | `encoding_mislabeled`, `encoding_ansel`, `encoding_ansi`, `encoding_no_char`, `encoding_uncertain`, `encoding_unreadable`, `garbled_chars` |
| File structure | `head_missing`, `head_not_first`, `trlr_missing`, `after_trlr`, `version_missing`, `bad_line`, `level_jump`, `leading_space`, `blank_lines`, `line_endings`, `line_too_long`, `conc_in_v7`, `cont_misplaced` |
| Links | `duplicate_id`, `broken_pointer`, `one_sided_link`, `empty_family`, `own_ancestor` |
| People and dates | `no_name`, `death_before_birth`, `child_before_parent`, `parent_too_young`, `born_after_mother_death`, `too_old`, `bad_date` |

The messages are exported as `ISSUE_MESSAGES`, `CHANGE_MESSAGES` and `WARNING_MESSAGES` if you want to translate them.

### Repair the form of a file

```ts
import { repairGedcom } from "@thememorypalace/gedcom-tools";

const { text, changes } = repairGedcom(readFileSync("tree.ged"), { fixGarbled: false });
```

The repair only touches the form: UTF-8 with a matching `CHAR` line, one kind of line ending, no empty lines or indentation, `HEAD` and `TRLR` present. Names, dates, places and links are never changed. With `fixGarbled: true` it also repairs double-encoded text such as `MÃ¼ller`, but only where the reverse calculation is exact.

### Decode bytes

```ts
import { decodeGedcom } from "@thememorypalace/gedcom-tools";

const decoded = decodeGedcom(bytes);
// { text, declared: "ANSEL", used: "UTF-8", mislabeled: true, hadBom, hasHighBytes, unreadable, lineEndings }
```

How the character set is chosen:

1. A UTF-16 byte order mark means UTF-16.
2. Pure ASCII is read as is.
3. Valid UTF-8 with non-ASCII bytes is read as UTF-8, even when the header says something else (then `mislabeled` is true).
4. `1 CHAR ANSEL` means ANSEL, decoded with the GEDCOM extensions and normalised to NFC.
5. Everything else (ANSI, IBMPC, no CHAR line, broken UTF-8) is read as Windows-1252.

All functions accept a `Uint8Array`, an `ArrayBuffer`, a string, or the result of `decodeGedcom`. Pass bytes when you have them; a string has already been decoded by someone else, so character set problems can no longer be detected.

## Command line

```sh
npx @thememorypalace/gedcom-tools convert tree.ged tree-v7.ged
npx @thememorypalace/gedcom-tools convert tree-v7.ged tree-551.ged --to 5.5.1
npx @thememorypalace/gedcom-tools check tree.ged
npx @thememorypalace/gedcom-tools check tree.ged --json
npx @thememorypalace/gedcom-tools repair tree.ged tree-fixed.ged --fix-garbled
```

After a global install (`npm install -g @thememorypalace/gedcom-tools`) the command is `gedcom-tools`. `check` exits with code 1 when there are errors, so it can run in CI. `convert` also takes `--no-bom` and `--lf`.

## Limits

- The converter works on the line tree and does not validate every 7.0 rule (such as cardinality of every substructure). Run the result through a full validator when you need certainty.
- Only the Gregorian calendar is used for date comparisons in the checker; Julian dates are treated as Gregorian, and French Republican and Hebrew dates are skipped.
- ANSEL is only used when the header says `ANSEL`. Other legacy code pages (IBM 437, 850, Mac Roman) are read as Windows-1252 and reported as `encoding_uncertain`.
- `GEDZIP` archives and embedded `BLOB` media are not supported; `BLOB` is reported and removed when converting to 7.0.
- The whole file is held in memory. For large files in the browser, run it in a web worker so the page stays responsive.

## Package name

The package is published as `@thememorypalace/gedcom-tools`. If the scope is not available, the fallback name is `gedcom-tools-mp`.

## About

Made by the small team behind [The Memory Palace](https://www.thememorypalace.ai/gedcom-7-converter) in Leuven, Belgium. The same code runs the free online GEDCOM 7 converter and GEDCOM checker on that site.

## License

MIT. See [LICENSE](LICENSE).
