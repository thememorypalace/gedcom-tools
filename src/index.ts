/**
 * gedcom-tools: convert GEDCOM 5.5.1 to 7.0 (and back), check GEDCOM files
 * for structural and genealogical problems, and decode legacy character sets
 * (ANSEL, Windows-1252, UTF-16).
 *
 * Zero runtime dependencies. No Node APIs in this module, so it runs in
 * browsers, web workers, Deno, Bun and Node 18+.
 */

import { decodeGedcom, type DecodedGedcom, type GedcomEncoding } from "./decode";
import {
  checkDecoded,
  repairDecoded,
  type CheckIssue,
  type CheckResult as CoreCheckResult,
  type RepairResult,
} from "./check";
import {
  convertDecoded,
  defaultTarget,
  type ChangeCode,
  type ConvertReport as CoreConvertReport,
  type ConvertTarget,
  type ConvertWarning as CoreConvertWarning,
} from "./convert7";
import { CHANGE_MESSAGES, ISSUE_MESSAGES, WARNING_MESSAGES, format } from "./messages";

export { decodeGedcom, decodeAnsel, fixMojibakeLine, findMojibake, looksGarbled, unMojibake } from "./decode";
export type { DecodedGedcom, GedcomEncoding, MojibakeHit } from "./decode";
export { parseDateRange } from "./check";
export type { IssueCode, Severity, IssueExample, ExampleWho, RepairChange, RepairResult, DateRange } from "./check";
export { dateTo7, dateTo551, ageTo7, isDate7, filePathTo7, filePathTo551, defaultTarget, parseTree, TAGS7, TAGS551 } from "./convert7";
export type { ChangeCode, WarnCode, ConvertTarget, GNode } from "./convert7";
export { ISSUE_MESSAGES, CHANGE_MESSAGES, WARNING_MESSAGES, format } from "./messages";

/** Anything the functions accept: raw bytes (preferred, so the character set can be detected), text, or an already decoded file. */
export type GedcomInput = Uint8Array | ArrayBuffer | string | DecodedGedcom;

function isDecoded(x: unknown): x is DecodedGedcom {
  return typeof x === "object" && x !== null && "text" in x && "used" in x && "lineEndings" in x;
}

/** Text that is already a JavaScript string: the character set no longer matters. */
function fromString(text: string): DecodedGedcom {
  const clean = text.replace(/^\ufeff/, "");
  const m = clean.slice(0, 65536).match(/(?:^|[\r\n])\s*1\s+CHAR\s+([^\r\n]+)/);
  let crlf = 0, lf = 0, cr = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i);
    if (c === 13) {
      if (clean.charCodeAt(i + 1) === 10) { crlf++; i++; } else cr++;
    } else if (c === 10) lf++;
  }
  let unreadable = 0;
  for (let i = clean.indexOf("\ufffd"); i !== -1; i = clean.indexOf("\ufffd", i + 1)) unreadable++;
  const high = /[^\x00-\x7f]/.test(clean);
  return {
    text: clean,
    declared: m ? m[1].trim().toUpperCase() : null,
    used: high ? "UTF-8" : "ASCII",
    hadBom: clean.length !== text.length,
    hasHighBytes: high,
    mislabeled: false,
    unreadable,
    lineEndings: { crlf, lf, cr },
  };
}

/** Turns any accepted input into a decoded file. Bytes go through decodeGedcom. */
export function toDecoded(input: GedcomInput): DecodedGedcom {
  if (typeof input === "string") return fromString(input);
  if (input instanceof Uint8Array || input instanceof ArrayBuffer) return decodeGedcom(input);
  if (isDecoded(input)) return input;
  throw new TypeError("gedcom-tools: expected a string, Uint8Array, ArrayBuffer or DecodedGedcom");
}

/* checking */

/** One finding of the checker: a stable code, a severity, a count, examples and an English message. */
export interface Finding extends CheckIssue {
  title: string;
  message: string;
}

export interface CheckResult extends Omit<CoreCheckResult, "issues"> {
  /** Findings, errors first, then warnings, then info. */
  issues: Finding[];
  errors: number;
  warnings: number;
}

/**
 * Checks a GEDCOM file and returns structured findings: encoding problems,
 * broken structure, broken or one-sided links, impossible dates and more.
 * Pass bytes when you have them, so character set problems can be detected.
 */
export function checkGedcom(input: GedcomInput): CheckResult {
  const res = checkDecoded(toDecoded(input));
  const issues: Finding[] = res.issues.map((it) => {
    const m = ISSUE_MESSAGES[it.code];
    const params = { count: it.count, ...(it.params ?? {}) };
    return { ...it, title: format(m.title, params), message: format(m.message, params) };
  });
  return {
    ...res,
    issues,
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
  };
}

export interface RepairOptions {
  /** Also repair garbled characters such as "Ã©" where that can be done exactly. Default false. */
  fixGarbled?: boolean;
}

/**
 * Repairs the form of a GEDCOM file without touching its content: UTF-8 with
 * BOM, CRLF line endings, a correct CHAR line, no empty lines or indentation,
 * HEAD and TRLR present. Names, dates, places and pointers are never changed,
 * except garbled characters when `fixGarbled` is set.
 */
export function repairGedcom(input: GedcomInput, options: RepairOptions = {}): RepairResult {
  const decoded = toDecoded(input);
  return repairDecoded(decoded, checkDecoded(decoded), options);
}

/* converting */

export interface ConvertOptions {
  /** Target version. Default: 7.0 for convertTo7; for convertGedcom, 5.5.1 when the input is 7.0, else 7.0. */
  target?: ConvertTarget;
  /** Start the output with a UTF-8 byte order mark. Default true (recommended by the 7.0 specification). */
  bom?: boolean;
  /** Line ending of the output. Default "\r\n". */
  lineEnding?: "\r\n" | "\n";
}

export interface ConvertWarning extends CoreConvertWarning {
  title: string;
  message: string;
}

export interface ConvertReport extends Omit<CoreConvertReport, "warnings"> {
  warnings: ConvertWarning[];
  /** The changes as English sentences, in a stable order. */
  changeList: { code: ChangeCode; count: number; message: string }[];
}

export interface ConvertResult {
  /** The converted file as text. Encode it as UTF-8 when writing it to disk. */
  text: string;
  report: ConvertReport;
}

/** Converts a GEDCOM file between 5.5.1 and 7.0. Without a target, the obvious direction is used. */
export function convertGedcom(input: GedcomInput, options: ConvertOptions = {}): ConvertResult {
  const decoded = toDecoded(input);
  const target = options.target ?? defaultTarget(decoded.text);
  const res = convertDecoded(decoded, target);
  let text = res.text;
  if (options.bom === false) text = text.replace(/^\ufeff/, "");
  if (options.lineEnding === "\n") text = text.replace(/\r\n/g, "\n");
  const warnings: ConvertWarning[] = res.report.warnings.map((w) => ({
    ...w,
    title: WARNING_MESSAGES[w.code].title,
    message: WARNING_MESSAGES[w.code].message,
  }));
  const changeList = (Object.keys(CHANGE_MESSAGES) as ChangeCode[])
    .filter((c) => (res.report.changes[c] ?? 0) > 0)
    .map((code) => {
      const count = res.report.changes[code]!;
      return { code, count, message: format(CHANGE_MESSAGES[code], { count }) };
    });
  return { text, report: { ...res.report, warnings, changeList } };
}

/** Converts a GEDCOM 5.5 or 5.5.1 file to GEDCOM 7.0. */
export function convertTo7(input: GedcomInput, options: Omit<ConvertOptions, "target"> = {}): ConvertResult {
  return convertGedcom(input, { ...options, target: "7.0" });
}

/** Converts a GEDCOM 7.0 file to GEDCOM 5.5.1, for programs that do not read 7.0 yet. */
export function convertTo551(input: GedcomInput, options: Omit<ConvertOptions, "target"> = {}): ConvertResult {
  return convertGedcom(input, { ...options, target: "5.5.1" });
}
