/**
 * GEDCOM 5.5.1 to 7.0 and back.
 *
 * Works on a tree of lines (level, xref, tag, value, children) instead of on
 * people and families: a conversion must not throw away anything a family
 * tree reader does not know about. The character set is handled by decode.ts
 * (ANSEL, Windows-1252, UTF-16); the output is always UTF-8.
 *
 * Rules from the FamilySearch GEDCOM 7.0 specification (gedcom.io) and the
 * official migration guide (gedcom.io/migrate): header (GEDC.VERS 7.0, no
 * CHAR, no GEDC.FORM, no HEAD.FILE), CONC removed (CONT stays), @ doubled
 * only at the start of a value, xref IDs only A-Z 0-9 _, NOTE records become
 * SNOTE, OBJE and SOUR without a pointer become records, FORM becomes a media
 * type, FILE a URL, date phrases and dual years go to PHRASE, calendars as
 * words, age words, enumerations in upper case, RELA to ROLE, ROMN/FONE to
 * TRAN, AFN/RFN/RIN to EXID, SUBN removed, language names to BCP 47.
 *
 * What cannot be converted without loss is reported as a warning, with line
 * numbers from the source file. No network, no storage, no Node APIs.
 */

import type { DecodedGedcom } from "./decode";

export type ConvertTarget = "7.0" | "5.5.1";

export type ChangeCode =
  | "encoding" | "header" | "conc_joined" | "long_lines_split" | "xref_renamed" | "at_signs"
  | "shared_notes" | "media_records" | "media_types" | "file_paths" | "source_records" | "void_pointers"
  | "dates_calendar" | "dates_phrase" | "dates_dual" | "dates_epoch" | "dates_range_swapped" | "dates_cleaned"
  | "ages" | "enums" | "sex" | "rela_role" | "tran" | "exid" | "lang_tags" | "name_pieces" | "alia_text"
  | "ext_tags" | "subm_added" | "uid" | "levels_fixed";

export type WarnCode =
  | "date_phrase_only" | "age_phrase_only" | "sex_lost" | "lang_unknown" | "media_type_guessed"
  | "subn_removed" | "blob_removed" | "head_file_removed" | "dangling_pointer" | "bad_line"
  | "resn_dropped" | "void_removed" | "schma_removed" | "html_note" | "kept_as_extension" | "already_target" | "no_head";

export interface ConvertWarning {
  code: WarnCode;
  count: number;
  examples: { line: number; text: string }[];
}

export interface ConvertReport {
  /** What the header said (2 VERS under 1 GEDC), or null. */
  fromVersion: string | null;
  to: ConvertTarget;
  /** Character set the file was read with (decode.ts). */
  encoding: string;
  linesIn: number;
  linesOut: number;
  records: { INDI: number; FAM: number; SOUR: number; REPO: number; OBJE: number; NOTE: number; SUBM: number; other: number };
  changes: Partial<Record<ChangeCode, number>>;
  warnings: ConvertWarning[];
  /** Extension tags (with _) that were kept, with their count. */
  extensions: { tag: string; count: number }[];
}

export interface ConvertResult {
  text: string;
  report: ConvertReport;
}

/* the tree */

export interface GNode {
  tag: string;
  xref: string | null;
  /** null = no value; several lines separated by \n (CONT). */
  value: string | null;
  /** Is the value a pointer (@X@)? Then no @ escapes. */
  pointer: boolean;
  children: GNode[];
  /** Line number in the source file (0 = added by the converter). */
  line: number;
}

const LINE_RE = /^\s*(\d+)\s+(?:(@[^@\s]+@)\s+)?([A-Za-z0-9_]+)(?: (.*))?$/;
const POINTER_RE = /^@[^@#\s][^@]*@$/;

interface ParseOut {
  roots: GNode[];
  lines: number;
  conc: number;
  badLines: { line: number; text: string }[];
  levelJumps: number;
}

export function parseTree(text: string, from7: boolean): ParseOut {
  const raw = text.split(/\r\n|\r|\n/);
  if (raw.length && raw[raw.length - 1] === "") raw.pop();
  const roots: GNode[] = [];
  const stack: GNode[] = [];
  let conc = 0;
  let levelJumps = 0;
  const badLines: ParseOut["badLines"] = [];
  let last: GNode | null = null;
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (!s.trim()) continue;
    const m = s.match(LINE_RE);
    if (!m) {
      // A line without a level: usually a note with a hard line break.
      // Throw nothing away: append it as a new line to the previous value.
      if (last && !last.pointer) {
        last.value = (last.value ?? "") + "\n" + s;
      }
      badLines.push({ line: i + 1, text: s.slice(0, 80) });
      continue;
    }
    const level = parseInt(m[1], 10);
    const xref = m[2] ? m[2].slice(1, -1) : null;
    const tag = m[3].toUpperCase();
    let value: string | null = m[4] ?? null;
    if (tag === "CONC" || tag === "CONT") {
      const parent = stack[level - 1];
      if (parent && !parent.pointer) {
        const v = value === null ? "" : unescapeAt(value, from7);
        parent.value = (parent.value ?? "") + (tag === "CONT" ? "\n" : "") + v;
        if (tag === "CONC") conc++;
        continue;
      }
      // A stray CONT/CONC without a parent: falls through as an ordinary line.
    }
    const pointer = value !== null && POINTER_RE.test(value);
    if (value !== null && !pointer) value = unescapeAt(value, from7);
    const node: GNode = { tag, xref, value, pointer, children: [], line: i + 1 };
    let lvl = level;
    if (lvl > stack.length) {
      levelJumps++;
      lvl = stack.length;
    }
    stack.length = lvl;
    if (lvl === 0) roots.push(node);
    else stack[lvl - 1].children.push(node);
    stack[lvl] = node;
    last = node;
  }
  return { roots, lines: raw.length, conc, badLines, levelJumps };
}

/** 5.5.1: every @ is doubled; 7.0: only a leading @. */
function unescapeAt(v: string, from7: boolean): string {
  if (from7) return v.startsWith("@@") ? v.slice(1) : v;
  return v.replace(/@@/g, "@");
}

/* helpers */

export class Tally {
  changes: Partial<Record<ChangeCode, number>> = {};
  warnings = new Map<WarnCode, ConvertWarning>();
  ext = new Map<string, number>();
  change(c: ChangeCode, n = 1) {
    if (n > 0) this.changes[c] = (this.changes[c] ?? 0) + n;
  }
  warn(c: WarnCode, line = 0, text = "") {
    let w = this.warnings.get(c);
    if (!w) {
      w = { code: c, count: 0, examples: [] };
      this.warnings.set(c, w);
    }
    w.count++;
    if (w.examples.length < 3 && (line || text)) w.examples.push({ line, text: text.slice(0, 100) });
  }
}

const mk = (tag: string, value: string | null = null, children: GNode[] = [], pointer = false): GNode => ({
  tag, xref: null, value, pointer, children, line: 0,
});
const child = (n: GNode, tag: string) => n.children.find((c) => c.tag === tag);
const firstLine = (v: string | null) => (v ?? "").split("\n")[0];

/* language: GEDCOM 5.5.1 language names and BCP 47 */

const LANGS: Record<string, string> = {
  AFRIKAANS: "af", ALBANIAN: "sq", "ANGLO-SAXON": "ang", ARABIC: "ar", ARMENIAN: "hy", ASSAMESE: "as",
  BELORUSIAN: "be", BENGALI: "bn", BRAJ: "bra", BULGARIAN: "bg", BURMESE: "my", CANTONESE: "yue",
  CATALAN: "ca", "CATALAN_SPN": "ca-ES", "CHURCH-SLAVIC": "cu", CZECH: "cs", DANISH: "da", DOGRI: "doi",
  DUTCH: "nl", ENGLISH: "en", ESPERANTO: "eo", ESTONIAN: "et", FAROESE: "fo", FINNISH: "fi", FRENCH: "fr",
  GEORGIAN: "ka", GERMAN: "de", GREEK: "el", GUJARATI: "gu", HAWAIIAN: "haw", HEBREW: "he", HINDI: "hi",
  HUNGARIAN: "hu", ICELANDIC: "is", INDONESIAN: "id", ITALIAN: "it", JAPANESE: "ja", KANNADA: "kn",
  KHMER: "km", KONKANI: "kok", KOREAN: "ko", LAHNDA: "lah", LAO: "lo", LATVIAN: "lv", LITHUANIAN: "lt",
  MACEDONIAN: "mk", MAITHILI: "mai", MALAYALAM: "ml", MANDRIN: "cmn", MANIPURI: "mni", MARATHI: "mr",
  MEWARI: "mtr", NAVAHO: "nv", NEPALI: "ne", NORWEGIAN: "no", ORIYA: "or", PAHARI: "him", PALI: "pi",
  PANJABI: "pa", PERSIAN: "fa", POLISH: "pl", PORTUGUESE: "pt", PRAKRIT: "pra", PUSTO: "ps", RAJASTHANI: "raj",
  ROMANIAN: "ro", RUSSIAN: "ru", SANSKRIT: "sa", SERB: "sr", "SERBO_CROA": "sh", SLOVAK: "sk", SLOVENE: "sl",
  SPANISH: "es", SWEDISH: "sv", TAGALOG: "tl", TAMIL: "ta", TELUGU: "te", THAI: "th", TIBETAN: "bo",
  TURKISH: "tr", UKRAINIAN: "uk", URDU: "ur", VIETNAMESE: "vi", WENDIC: "wen", YIDDISH: "yi",
  // Common variants outside the 5.5.1 list.
  FLEMISH: "nl-BE", NEDERLANDS: "nl", DEUTSCH: "de", FRANCAIS: "fr", "FRAN\u00c7AIS": "fr", ESPANOL: "es", "ESPA\u00d1OL": "es",
  CHINESE: "zh", MANDARIN: "cmn", LATIN: "la", WELSH: "cy", IRISH: "ga", FRISIAN: "fy", LUXEMBOURGISH: "lb",
  CROATIAN: "hr", SERBIAN: "sr", NORWEGIAN_BOKMAL: "nb",
};
const LANG_BACK: Record<string, string> = {};
for (const [name, tag] of Object.entries(LANGS)) {
  if (!LANG_BACK[tag.toLowerCase()] && /^[A-Z-]+$/.test(name) && !["NEDERLANDS", "DEUTSCH", "FRANCAIS", "ESPANOL", "MANDARIN", "FLEMISH"].includes(name)) {
    LANG_BACK[tag.toLowerCase()] = name.charAt(0) + name.slice(1).toLowerCase();
  }
}
LANG_BACK["nl-be"] = "Dutch";
const BCP47 = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/;

function langTo7(v: string): string | null {
  const t = v.trim();
  const named = LANGS[t.toUpperCase().replace(/\s+/g, "_")];
  if (named) return named;
  if (BCP47.test(t) && t.length <= 35 && /^[a-z]{2,3}(-|$)/i.test(t)) return t;
  return null;
}

/* media types */

const MIME: Record<string, string> = {
  bmp: "image/bmp", gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg", png: "image/png",
  tif: "image/tiff", tiff: "image/tiff", webp: "image/webp", heic: "image/heic", heif: "image/heif", svg: "image/svg+xml",
  pcx: "image/vnd.zbrush.pcx", ole: "application/ole", pdf: "application/pdf", txt: "text/plain", htm: "text/html",
  html: "text/html", rtf: "application/rtf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel",
  odt: "application/vnd.oasis.opendocument.text", wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg",
  flac: "audio/flac", aac: "audio/aac", wma: "audio/x-ms-wma", mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime",
  avi: "video/x-msvideo", mpg: "video/mpeg", mpeg: "video/mpeg", wmv: "video/x-ms-wmv", webm: "video/webm",
  mkv: "video/x-matroska", "3gp": "video/3gpp", zip: "application/zip",
};
const MIME_BACK: Record<string, string> = {
  "image/jpeg": "jpg", "image/tiff": "tif", "audio/mpeg": "mp3", "video/mpeg": "mpg", "text/html": "htm", "video/mp4": "mp4",
};
for (const [ext, mime] of Object.entries(MIME)) if (!MIME_BACK[mime]) MIME_BACK[mime] = ext;

function extOf(path: string): string {
  const m = path.split(/[?#]/)[0].match(/\.([A-Za-z0-9]{1,5})$/);
  return m ? m[1].toLowerCase() : "";
}

/** A 5.5.1 file path as a URL for 7.0 (RFC 8089 for local absolute paths). */
export function filePathTo7(p: string): string {
  const t = p.trim();
  if (/^(https?|ftp|file):/i.test(t)) return t;
  const enc = (s: string) => s.split("/").map((seg) => encodeURIComponent(decodeSafe(seg))).join("/");
  let s = t.replace(/\\/g, "/");
  const drive = s.match(/^([A-Za-z]):\/?(.*)$/);
  if (drive) return `file:///${drive[1]}:/${enc(drive[2])}`;
  if (s.startsWith("//")) {
    const rest = s.slice(2);
    const cut = rest.indexOf("/");
    return cut < 0 ? `file://${rest}` : `file://${rest.slice(0, cut)}/${enc(rest.slice(cut + 1))}`;
  }
  if (s.startsWith("/")) return `file:///${enc(s.slice(1))}`;
  s = s.replace(/^\.\//, "");
  return enc(s);
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** A 7.0 URL back to a plain path for 5.5.1 programs. */
export function filePathTo551(u: string): string {
  const t = u.trim();
  const m = t.match(/^file:\/\/\/([A-Za-z]):\/(.*)$/);
  if (m) return `${m[1]}:\\${decodeSafe(m[2]).replace(/\//g, "\\")}`;
  const unc = t.match(/^file:\/\/([^/]+)\/(.*)$/);
  if (unc && unc[1]) return `\\\\${unc[1]}\\${decodeSafe(unc[2]).replace(/\//g, "\\")}`;
  const abs = t.match(/^file:\/\/\/(.*)$/);
  if (abs) return `/${decodeSafe(abs[1])}`;
  if (/^(https?|ftp):/i.test(t)) return t;
  const d = decodeSafe(t);
  // A reference that only looks like a URL after decoding stays encoded.
  return /^[a-z][a-z0-9+.-]*:/i.test(d) ? t : d;
}

/* dates */

const GREG_MONTHS = "JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC";
const FR_MONTHS = "VEND|BRUM|FRIM|NIVO|PLUV|VENT|GERM|FLOR|PRAI|MESS|THER|FRUC|COMP";
const HEB_MONTHS = "TSH|CSH|KSL|TVT|SHV|ADR|ADS|NSN|IYR|SVN|TMZ|AAV|ELL";
const CAL7 = "(?:(?:GREGORIAN|JULIAN|FRENCH_R|HEBREW|_[A-Z0-9_]+) )?";
const DATE7 = `${CAL7}(?:(?:\\d{1,2} )?(?:${GREG_MONTHS}|${FR_MONTHS}|${HEB_MONTHS}|_[A-Z0-9_]+) )?\\d+(?: (?:BCE|_[A-Z0-9_]+))?`;
const DATE7_RE = new RegExp(
  `^(?:${DATE7}|(?:FROM ${DATE7}(?: TO ${DATE7})?)|(?:TO ${DATE7})|(?:BET ${DATE7} AND ${DATE7})|(?:(?:BEF|AFT|ABT|CAL|EST) ${DATE7}))$`,
);

/** Is this a valid 7.0 date (without PHRASE)? */
export function isDate7(v: string): boolean {
  return v === "" || DATE7_RE.test(v);
}

const CAL_TO7: Record<string, string> = {
  GREGORIAN: "", JULIAN: "JULIAN", "FRENCH R": "FRENCH_R", FRENCH_R: "FRENCH_R", HEBREW: "HEBREW", ROMAN: "_ROMAN", UNKNOWN: "_UNKNOWN",
};

const WORDS: [RegExp, string][] = [
  [/^(?:ABOUT|CIRCA|CA\.?|C\.|APPROX\.?|ABT\.)\s+/, "ABT "],
  [/^(?:BEFORE|BEF\.)\s+/, "BEF "],
  [/^(?:AFTER|AFT\.)\s+/, "AFT "],
  [/^(?:CALCULATED|CAL\.)\s+/, "CAL "],
  [/^(?:ESTIMATED|EST\.)\s+/, "EST "],
];
const LONG_MONTHS: Record<string, string> = {
  JANUARY: "JAN", FEBRUARY: "FEB", MARCH: "MAR", APRIL: "APR", JUNE: "JUN", JULY: "JUL", AUGUST: "AUG",
  SEPTEMBER: "SEP", SEPT: "SEP", OCTOBER: "OCT", NOVEMBER: "NOV", DECEMBER: "DEC",
};

function yearOfPart(s: string): number | null {
  const m = s.match(/(\d+)(?: BCE)?$/);
  if (!m) return null;
  return / BCE$/.test(s) ? -parseInt(m[1], 10) : parseInt(m[1], 10);
}

/** Comparable key for a single date (year, month, day). */
function dateKey(s: string): number | null {
  const parts = s.replace(/^(GREGORIAN|JULIAN) /, "").split(" ");
  if (/^(FRENCH_R|HEBREW|_)/.test(s)) return null;
  const y = yearOfPart(s);
  if (y === null) return null;
  const months = GREG_MONTHS.split("|");
  let mo = 0;
  let d = 0;
  if (parts.length >= 2) mo = months.indexOf(parts[parts.length - 2]) + 1;
  if (parts.length >= 3) d = parseInt(parts[0], 10) || 0;
  return y * 10000 + mo * 100 + d;
}

/**
 * A 5.5.1 date to 7.0. Returns the new value and, where needed, a PHRASE with
 * the original text, so nothing is lost.
 */
export function dateTo7(raw: string, t: Tally | null = null): { value: string; phrase: string | null } {
  const original = raw.trim().replace(/\s+/g, " ");
  if (!original) return { value: "", phrase: null };
  let s = original;
  let phrase: string | null = null;

  // Date phrase: "(text)" alone, or "INT date (text)".
  const only = s.match(/^\((.*)\)$/);
  if (only) {
    t?.change("dates_phrase");
    return { value: "", phrase: only[1].trim() };
  }
  const int = s.match(/^INT\s+(.*?)\s*\((.*)\)$/i);
  if (int) {
    s = int[1];
    phrase = int[2].trim();
    t?.change("dates_phrase");
  } else if (/^INT\s+/i.test(s)) {
    s = s.replace(/^INT\s+/i, "");
    t?.change("dates_phrase");
  }

  let u = s.toUpperCase();
  // Calendar escapes: @#DJULIAN@ -> JULIAN, @#DGREGORIAN@ removed (the default).
  if (/@#D/.test(u)) {
    u = u.replace(/@#D([A-Z ]+?)@\s*/g, (_, c: string) => {
      const k = CAL_TO7[c.trim()];
      return k === undefined ? `_${c.trim().replace(/\s+/g, "_")} ` : k ? `${k} ` : "";
    });
    t?.change("dates_calendar");
  }
  // Epoch: B.C. / BC -> BCE.
  if (/\b(B\.C\.?|BC)(?=\s|$|\))/.test(u)) {
    u = u.replace(/\s*\(?\b(B\.C\.?|BC)\)?(?=\s|$)/g, " BCE");
    t?.change("dates_epoch");
  }
  u = u.replace(/\s+/g, " ").trim();

  // Dual year (1648/9, 1648/49): the new year, with the original as PHRASE.
  let dual = false;
  u = u.replace(/(\d{3,4})\/(\d{1,4})\b/g, (whole: string, a: string, b: string) => {
    const first = parseInt(a, 10);
    const tail = parseInt(b, 10);
    // Only a real dual year (1648/9, 1648/49, 1648/1649), not a range like 1850/1855.
    if (b.length > 2 && tail !== first + 1) return whole;
    dual = true;
    const mod = 10 ** b.length;
    let y = first - (first % mod) + tail;
    if (y < first) y += mod;
    return String(y);
  });
  if (dual) {
    t?.change("dates_dual");
    phrase = original;
  }

  if (DATE7_RE.test(u)) {
    // BET x AND y with x later than y: swap them.
    const bet = u.match(new RegExp(`^BET (${DATE7}) AND (${DATE7})$`));
    let swapped = false;
    if (bet) {
      const a = dateKey(bet[1]);
      const b = dateKey(bet[2]);
      if (a !== null && b !== null && a > b) {
        u = `BET ${bet[2]} AND ${bet[1]}`;
        swapped = true;
        t?.change("dates_range_swapped");
      }
    }
    if (u !== original && !dual && !int && !/@#D/i.test(original) && !/\bB\.?C\.?(?=\s|$|\))/i.test(original) && !swapped) {
      t?.change("dates_cleaned");
    }
    return { value: u, phrase };
  }

  // Rescue what can be rescued: "about 1850", "12 March 1850", "1850." ...
  let r = u.replace(/,/g, " ").replace(/\.$/, "").replace(/\s+/g, " ").trim();
  for (const [re, rep] of WORDS) r = r.replace(re, rep);
  r = r.replace(/\b([A-Z]{3,9})\b/g, (w) => LONG_MONTHS[w] ?? w);
  r = r.replace(/\b(\d{1,2})(ST|ND|RD|TH)\b/g, "$1");
  const between = r.match(/^(\d{3,4})\s*[-/]\s*(\d{3,4})$/);
  if (between) r = `BET ${between[1]} AND ${between[2]}`;
  if (DATE7_RE.test(r)) {
    t?.change("dates_cleaned");
    return { value: r, phrase: phrase ?? original };
  }
  // Not readable: the whole text as PHRASE, the date empty.
  return { value: "", phrase: original };
}

/** A 7.0 date with PHRASE back to 5.5.1. */
export function dateTo551(value: string, phrase: string | null): { value: string; leftover: string | null } {
  let v = value.trim();
  // Calendars back to escapes, BCE to B.C.
  v = v.replace(/(^|\s)(GREGORIAN|JULIAN|FRENCH_R|HEBREW|_ROMAN|_UNKNOWN) /g, (_, sp: string, c: string) => {
    const back: Record<string, string> = { GREGORIAN: "@#DGREGORIAN@", JULIAN: "@#DJULIAN@", FRENCH_R: "@#DFRENCH R@", HEBREW: "@#DHEBREW@", _ROMAN: "@#DROMAN@", _UNKNOWN: "@#DUNKNOWN@" };
    return `${sp}${back[c]} `;
  });
  v = v.replace(/ BCE\b/g, " B.C.");
  if (!phrase) return { value: v, leftover: null };
  const p = phrase.replace(/\(/g, "[").replace(/\)/g, "]").replace(/\s+/g, " ").trim();
  // A PHRASE with a dual year (from our own conversion): that was the date.
  if (/\d{3,4}\/\d{1,4}/.test(phrase) && /^[A-Z0-9 @#/.]+$/i.test(phrase)) return { value: phrase.toUpperCase(), leftover: null };
  if (!v) return { value: `(${p})`, leftover: null };
  if (!/^(FROM|TO|BET|BEF|AFT|ABT|CAL|EST|INT)\b/.test(v)) return { value: `INT ${v} (${p})`, leftover: null };
  return { value: v, leftover: phrase };
}

/* ages */

export function ageTo7(raw: string): { value: string; phrase: string | null; ok: boolean } {
  const s = raw.trim();
  const u = s.toUpperCase();
  if (u === "CHILD") return { value: "< 8y", phrase: "Child", ok: true };
  if (u === "INFANT") return { value: "< 1y", phrase: "Infant", ok: true };
  if (u === "STILLBORN") return { value: "0y", phrase: "Stillborn", ok: true };
  const m = s.match(/^([<>])?\s*(\d+\s*[yY])?\s*(\d+\s*[mM])?\s*(\d+\s*[wW])?\s*(\d+\s*[dD])?$/);
  if (m && (m[2] || m[3] || m[4] || m[5])) {
    const parts = [m[2], m[3], m[4], m[5]].filter(Boolean).map((p) => p!.replace(/\s+/g, "").toLowerCase());
    return { value: `${m[1] ? m[1] + " " : ""}${parts.join(" ")}`, phrase: null, ok: true };
  }
  if (/^\d+$/.test(s)) return { value: `${s}y`, phrase: null, ok: true };
  return { value: "", phrase: s, ok: false };
}

/* tags per version */

export const TAGS7 = new Set(
  ("ABBR ADDR ADOP ADR1 ADR2 ADR3 AGE AGNC ALIA ANCI ANUL ASSO AUTH BAPL BAPM BARM BASM BIRT BLES BURI CALN CAST CAUS " +
    "CENS CHAN CHIL CHR CHRA CITY CONF CONL CONT COPR CORP CREA CREM CROP CTRY DATA DATE DEAT DESI DEST DIV DIVF DSCR " +
    "EDUC EMAIL EMIG ENDL ENGA EVEN EXID FACT FAM FAMC FAMS FAX FCOM FILE FORM GEDC GIVN GRAD HEAD HEIGHT HUSB IDNO IMMI " +
    "INDI INIL LANG LATI LEFT LONG MAP MARB MARC MARL MARR MARS MEDI MIME NAME NATI NATU NCHI NICK NMR NO NOTE NPFX NSFX " +
    "OBJE OCCU ORDN PAGE PEDI PHON PHRASE PLAC POST PROB PROP PUBL QUAY REFN RELI REPO RESI RESN RETI ROLE SCHMA SDATE " +
    "SEX SLGC SLGS SNOTE SOUR SPFX SSN STAE STAT SUBM SURN TAG TEMP TEXT TIME TITL TOP TRAN TRLR TYPE UID VERS WIDTH " +
    "WIFE WILL WWW").split(" "),
);

export const TAGS551 = new Set(
  ("ABBR ADDR ADR1 ADR2 ADR3 ADOP AFN AGE AGNC ALIA ANCE ANCI ANUL ASSO AUTH BAPL BAPM BARM BASM BIRT BLES BLOB BURI " +
    "CALN CAST CAUS CENS CHAN CHAR CHIL CHR CHRA CITY CONC CONF CONL CONT COPR CORP CREM CTRY DATA DATE DEAT DESC DESI " +
    "DEST DIV DIVF DSCR EDUC EMAIL EMIG ENDL ENGA EVEN FACT FAM FAMC FAMF FAMS FAX FCOM FILE FONE FORM GEDC GIVN GRAD " +
    "HEAD HUSB IDNO IMMI INDI LANG LATI LONG MAP MARB MARC MARL MARR MARS MEDI NAME NATI NATU NCHI NICK NMR NOTE NPFX " +
    "NSFX OBJE OCCU ORDI ORDN PAGE PEDI PHON PLAC POST PROB PROP PUBL QUAY REFN RELA RELI REPO RESI RESN RETI RFN RIN " +
    "ROLE ROMN SEX SLGC SLGS SOUR SPFX SSN STAE STAT SUBM SUBN SURN TEMP TEXT TIME TITL TRLR TYPE VERS WIFE WILL WWW").split(" "),
);

/* enumerations */

const ENUM_NAME_TYPE = ["AKA", "BIRTH", "IMMIGRANT", "MAIDEN", "MARRIED", "PROFESSIONAL"];
const ENUM_PEDI = ["ADOPTED", "BIRTH", "FOSTER", "SEALING"];
const ENUM_MEDI = ["AUDIO", "BOOK", "CARD", "ELECTRONIC", "FICHE", "FILM", "MAGAZINE", "MANUSCRIPT", "MAP", "NEWSPAPER", "PHOTO", "TOMBSTONE", "VIDEO"];
const ENUM_STAT = ["CHALLENGED", "DISPROVEN", "PROVEN"];
const ENUM_RESN = ["CONFIDENTIAL", "LOCKED", "PRIVACY"];
const ENUM_ROLE = ["CHIL", "CLERGY", "FATH", "FRIEND", "GODP", "HUSB", "MOTH", "MULTIPLE", "NGHBR", "OFFICIATOR", "PARENT", "SPOU", "WIFE", "WITN"];
const ENUM_ORD = ["BIC", "CANCELED", "CHILD", "COMPLETED", "DNS", "DNS_CAN", "EXCLUDED", "INFANT", "PRE_1970", "STILLBORN", "SUBMITTED", "UNCLEARED"];

/** RELA text to a ROLE value (English, Dutch, German, French and Spanish words). */
const RELA_MAP: [RegExp, string][] = [
  [/^witn|^wit(ness|ness(es)?)$|^getuige|^zeuge|^t[\u00e9e]moin|^testigo/i, "WITN"],
  [/^god|^peet|^meter$|^peter$|^pate|^parrain|^marraine|^padrino|^madrina/i, "GODP"],
  [/^(friend|vriend|freund|ami|amigo)/i, "FRIEND"],
  [/^(neighbo|buur|nachbar|voisin|vecin)/i, "NGHBR"],
  [/^(father|vader|vater|p[\u00e8e]re|padre)$/i, "FATH"],
  [/^(mother|moeder|mutter|m[\u00e8e]re|madre)$/i, "MOTH"],
  [/^(parent|ouder|eltern)$/i, "PARENT"],
  [/^(husband|echtgenoot|ehemann|mari|esposo)$/i, "HUSB"],
  [/^(wife|echtgenote|ehefrau|femme|esposa)$/i, "WIFE"],
  [/^(spouse|partner|conjoint|c[\u00f3o]nyuge)$/i, "SPOU"],
  [/^(child|kind|enfant|hij[oa])$/i, "CHIL"],
  [/^(clergy|priest|minister|pastor|pastoor|dominee|pfarrer|pr[\u00eae]tre|cura|sacerdote|rabbi)/i, "CLERGY"],
  [/^(officiat|officiant|ambtenaar)/i, "OFFICIATOR"],
];
const ROLE_WORD: Record<string, string> = {
  CHIL: "Child", CLERGY: "Clergy", FATH: "Father", FRIEND: "Friend", GODP: "Godparent", HUSB: "Husband", MOTH: "Mother",
  MULTIPLE: "Multiple", NGHBR: "Neighbor", OFFICIATOR: "Officiator", PARENT: "Parent", SPOU: "Spouse", WIFE: "Wife", WITN: "Witness",
};

/** ROMN/FONE TYPE to a BCP 47 tag for TRAN (gedcom.io/migrate). */
const TRAN_LANG: Record<string, string> = {
  hangul: "ko-hang", kana: "ja-hrkt", pinyin: "und-Latn-pinyin", romaji: "ja-Latn", wadegiles: "zh-Latn-wadegile",
};

/* xref IDs */

function xrefMap7(roots: GNode[], t: Tally): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const r of roots) if (r.xref && /^[A-Z0-9_]+$/.test(r.xref) && r.xref !== "VOID") used.add(r.xref);
  for (const r of roots) {
    if (!r.xref || map.has(r.xref)) continue;
    if (/^[A-Z0-9_]+$/.test(r.xref) && r.xref !== "VOID") {
      map.set(r.xref, r.xref);
      continue;
    }
    let base = r.xref.toUpperCase().replace(/[^A-Z0-9_]/g, "_") || "X";
    if (base === "VOID") base = "VOID_";
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}_${n++}`;
    used.add(id);
    map.set(r.xref, id);
    t.change("xref_renamed");
  }
  return map;
}

function xrefMap551(roots: GNode[], t: Tally): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const r of roots) if (r.xref && r.xref.length <= 20) used.add(r.xref);
  let n = 1;
  for (const r of roots) {
    if (!r.xref || map.has(r.xref)) continue;
    if (r.xref.length <= 20) {
      map.set(r.xref, r.xref);
      continue;
    }
    let id = `X${n++}`;
    while (used.has(id)) id = `X${n++}`;
    used.add(id);
    map.set(r.xref, id);
    t.change("xref_renamed");
  }
  return map;
}

function remapPointers(nodes: GNode[], map: Map<string, string>, known: Set<string>, t: Tally) {
  for (const n of nodes) {
    if (n.pointer && n.value) {
      const id = n.value.slice(1, -1);
      if (id !== "VOID") {
        if (!known.has(id)) t.warn("dangling_pointer", n.line, `${n.tag} ${n.value}`);
        const to = map.get(id);
        if (to && to !== id) n.value = `@${to}@`;
      }
    }
    if (n.xref && map.has(n.xref)) n.xref = map.get(n.xref)!;
    remapPointers(n.children, map, known, t);
  }
}

/* counting */

function countRecords(roots: GNode[]): ConvertReport["records"] {
  const r = { INDI: 0, FAM: 0, SOUR: 0, REPO: 0, OBJE: 0, NOTE: 0, SUBM: 0, other: 0 };
  for (const n of roots) {
    if (n.tag === "HEAD" || n.tag === "TRLR") continue;
    const k = n.tag === "SNOTE" ? "NOTE" : n.tag;
    if (k in r) r[k as keyof typeof r]++;
    else r.other++;
  }
  return r;
}

function headVersion(roots: GNode[]): string | null {
  const head = roots.find((r) => r.tag === "HEAD");
  const v = head && child(head, "GEDC") && child(child(head, "GEDC")!, "VERS");
  return v?.value ? v.value.trim() : null;
}

/* 5.5.1 -> 7.0 */

interface Ctx7 {
  t: Tally;
  newRecords: GNode[];
  nextId: (prefix: string) => string;
  sourceIndex: Map<string, string>;
  headSour: string;
}

function to7(roots: GNode[], t: Tally): GNode[] {
  const used = new Set(roots.map((r) => r.xref).filter(Boolean) as string[]);
  let seq = 1;
  const nextId = (prefix: string) => {
    let id = `${prefix}${seq++}`;
    while (used.has(id)) id = `${prefix}${seq++}`;
    used.add(id);
    return id;
  };
  const head = roots.find((r) => r.tag === "HEAD");
  const ctx: Ctx7 = {
    t,
    newRecords: [],
    nextId,
    sourceIndex: new Map(),
    headSour: head ? firstLine(child(head, "SOUR")?.value ?? null).trim() : "",
  };

  const out: GNode[] = [];
  for (const r of roots) {
    if (r.tag === "TRLR") continue;
    if (r.tag === "SUBN") {
      t.warn("subn_removed", r.line, "0 SUBN");
      continue;
    }
    if (r.tag === "HEAD") {
      out.push(head7(r, t));
      continue;
    }
    if (r.tag === "NOTE" && r.xref) {
      r.tag = "SNOTE";
      t.change("shared_notes");
    }
    if (!TAGS7.has(r.tag) && !r.tag.startsWith("_")) {
      t.change("ext_tags");
      t.warn("kept_as_extension", r.line, r.tag);
      r.tag = `_${r.tag}`;
    }
    walk7(r, [], ctx);
    out.push(r);
  }
  out.push(...ctx.newRecords);
  if (!out.length || out[0].tag !== "HEAD") {
    t.warn("no_head");
    out.unshift(head7(mk("HEAD"), t));
  }
  out.push(mk("TRLR"));
  return out;
}

function head7(h: GNode, t: Tally): GNode {
  const kids: GNode[] = [mk("GEDC", null, [mk("VERS", "7.0")])];
  for (const c of h.children) {
    switch (c.tag) {
      case "GEDC":
      case "CHAR":
        continue;
      case "FILE":
        t.warn("head_file_removed", c.line, `1 FILE ${c.value ?? ""}`);
        continue;
      case "SUBN":
        t.warn("subn_removed", c.line, `1 SUBN ${c.value ?? ""}`);
        continue;
      case "LANG": {
        const l = langTo7(c.value ?? "");
        if (l) {
          if (l !== c.value) t.change("lang_tags");
          kids.push(mk("LANG", l));
        } else t.warn("lang_unknown", c.line, c.value ?? "");
        continue;
      }
      case "NOTE":
        if (c.pointer) c.tag = "SNOTE";
        kids.push(c);
        continue;
      case "DATE":
        if (c.value) c.value = c.value.toUpperCase();
        kids.push(c);
        continue;
      case "DEST":
      case "SUBM":
      case "COPR":
      case "PLAC":
      case "SOUR":
      case "SCHMA":
        kids.push(c);
        continue;
      default:
        if (!c.tag.startsWith("_")) {
          t.change("ext_tags");
          c.tag = `_${c.tag}`;
        }
        kids.push(c);
    }
  }
  t.change("header");
  return { ...h, children: kids };
}

function walk7(n: GNode, path: string[], ctx: Ctx7): void {
  const { t } = ctx;
  const here = [...path, n.tag];
  const out: GNode[] = [];
  if (n.tag === "OBJE" && !n.pointer) restructureObje(n, t);

  for (const c0 of n.children) {
    let c = c0;
    const tag = c.tag;

    // Removed in 7.0.
    if (tag === "SUBN") {
      t.warn("subn_removed", c.line, `SUBN ${c.value ?? ""}`);
      continue;
    }
    if (tag === "BLOB") {
      t.warn("blob_removed", c.line, "BLOB");
      continue;
    }

    // Shared notes.
    if (tag === "NOTE" && c.pointer) {
      c.tag = "SNOTE";
      t.change("shared_notes");
    }

    // Multimedia without a pointer -> record.
    if (tag === "OBJE" && !c.pointer && n.tag !== "OBJE") {
      out.push(mk("OBJE", `@${obje7Record(c, ctx)}@`, [], true));
      continue;
    }

    // Source without a pointer -> record.
    if (tag === "SOUR" && !c.pointer && n.tag !== "HEAD") {
      out.push(sour7Record(c, ctx));
      continue;
    }

    // REPO without a pointer (5.5.1 allowed it empty) -> @VOID@.
    if (tag === "REPO" && !c.pointer && n.tag === "SOUR") {
      c.value = "@VOID@";
      c.pointer = true;
      t.change("void_pointers");
    }

    if (tag === "AFN" || tag === "RFN" || tag === "RIN") {
      out.push(exid7(c, ctx));
      continue;
    }

    if ((tag === "ROMN" || tag === "FONE") && (n.tag === "NAME" || n.tag === "PLAC")) {
      const type = child(c, "TYPE");
      const key = (type?.value ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
      let lang = TRAN_LANG[key];
      if (!lang) {
        lang = tag === "ROMN" ? "und-Latn" : "und";
        t.warn("kept_as_extension", c.line, `${tag} TYPE ${type?.value ?? ""}`);
      }
      c = { ...c, tag: "TRAN", children: [...c.children.filter((k) => k.tag !== "TYPE"), mk("LANG", lang)] };
      t.change("tran");
    }

    if (tag === "RELA" && n.tag === "ASSO") {
      const v = (c.value ?? "").trim();
      const hit = RELA_MAP.find(([re]) => re.test(v));
      const role = hit ? hit[1] : "OTHER";
      const kids: GNode[] = [];
      if (role === "OTHER" || v.toUpperCase() !== role) kids.push(mk("PHRASE", v));
      out.push(mk("ROLE", role, kids));
      t.change("rela_role");
      continue;
    }

    if (tag === "EMAI") {
      c.tag = "EMAIL";
      t.change("ext_tags");
    }

    // ALIA with a name instead of a pointer -> extra NAME, TYPE AKA.
    if (tag === "ALIA" && n.tag === "INDI" && !c.pointer && c.value) {
      out.push(mk("NAME", c.value, [mk("TYPE", "AKA")]));
      t.change("alia_text");
      continue;
    }

    walk7(c, here, ctx);
    out.push(c);
  }

  n.children = out;
  fixValue7(n, path, ctx);

  // ASSO needs a ROLE in 7.0.
  if (n.tag === "ASSO") {
    n.children = n.children.filter((k) => k.tag !== "TYPE");
    if (!child(n, "ROLE")) {
      n.children.push(mk("ROLE", "OTHER"));
      t.change("rela_role");
    }
  }

  // Name pieces with commas (gedcom.io/migrate): split or join.
  if (n.tag === "NAME") namePieces7(n, t);

  // An unknown tag without _ becomes an extension.
  for (const k of n.children) {
    if (!TAGS7.has(k.tag) && !k.tag.startsWith("_")) {
      t.change("ext_tags");
      t.warn("kept_as_extension", k.line, k.tag);
      k.tag = `_${k.tag}`;
    }
  }
}

function fixValue7(n: GNode, path: string[], ctx: Ctx7): void {
  const { t } = ctx;
  const parent = path[path.length - 1] ?? "";
  const v = n.value;
  const add = (c: GNode) => n.children.splice(0, 0, c);

  switch (n.tag) {
    case "DATE": {
      if (v === null || parent === "CHAN" || parent === "CREA") {
        if (v) n.value = v.toUpperCase();
        return;
      }
      const r = dateTo7(v, t);
      n.value = r.value;
      if (r.phrase !== null && !child(n, "PHRASE")) add(mk("PHRASE", r.phrase));
      if (!r.value && r.phrase !== null && !/^\(.*\)$/.test(v.trim()) && !/^INT\s/i.test(v.trim())) {
        t.warn("date_phrase_only", n.line, v);
      }
      return;
    }
    case "AGE": {
      if (v === null) return;
      const r = ageTo7(v);
      if (r.value !== v) t.change("ages");
      n.value = r.value;
      if (r.phrase && !child(n, "PHRASE")) add(mk("PHRASE", r.phrase));
      if (!r.ok) t.warn("age_phrase_only", n.line, v);
      return;
    }
    case "SEX": {
      const u = (v ?? "").trim().toUpperCase();
      const s = /^[MFXU]/.test(u) ? u[0] : "U";
      if (s !== v) {
        t.change("sex");
        if (u && !/^[MFXU]$/.test(u) && s === "U") t.warn("sex_lost", n.line, v ?? "");
      }
      n.value = s;
      return;
    }
    case "LANG": {
      if (v === null) return;
      const l = langTo7(v);
      if (l) {
        if (l !== v) t.change("lang_tags");
        n.value = l;
      } else {
        t.warn("lang_unknown", n.line, v);
        n.value = "und";
      }
      return;
    }
    case "TYPE":
      if (parent === "NAME") enum7(n, ENUM_NAME_TYPE, t);
      if (parent === "FORM") {
        // 5.5.1: OBJE.FILE.FORM.TYPE (source medium) is called MEDI in 7.0.
        n.tag = "MEDI";
        enum7(n, ENUM_MEDI, t);
      }
      return;
    case "MEDI":
      enum7(n, ENUM_MEDI, t);
      return;
    case "PEDI":
      enum7(n, ENUM_PEDI, t);
      return;
    case "STAT":
      if (parent === "FAMC") enum7(n, ENUM_STAT, t, false);
      else if (v) {
        const u = v.trim().toUpperCase().replace("DNS/CAN", "DNS_CAN").replace("PRE-1970", "PRE_1970");
        if (u !== v && ENUM_ORD.includes(u)) {
          n.value = u;
          t.change("enums");
        }
      }
      return;
    case "RESN": {
      const vals = (v ?? "").split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
      const good = vals.filter((x) => ENUM_RESN.includes(x));
      if (good.length !== vals.length) t.warn("resn_dropped", n.line, v ?? "");
      const nv = good.join(", ");
      if (nv !== v) t.change("enums");
      n.value = nv || null;
      return;
    }
    case "ROLE": {
      if (!v) return;
      const pm = v.trim().match(/^\((.*)\)$/);
      if (pm) {
        n.value = "OTHER";
        add(mk("PHRASE", pm[1].trim()));
        t.change("enums");
      } else enum7(n, ENUM_ROLE, t);
      return;
    }
    case "FILE": {
      if (v === null) return;
      const url = filePathTo7(firstLine(v));
      if (url !== v) {
        n.value = url;
        t.change("file_paths");
      }
      // FORM is required and must be a media type.
      let form = child(n, "FORM");
      if (!form) {
        form = mk("FORM", "");
        n.children.unshift(form);
      }
      formToMime(form, url, t);
      return;
    }
    default:
      return;
  }
}

function enum7(n: GNode, allowed: string[], t: Tally, other = true): void {
  const v = (n.value ?? "").trim();
  if (!v) return;
  const u = v.toUpperCase().replace(/\s+/g, "_");
  if (allowed.includes(u)) {
    if (u !== v) {
      n.value = u;
      t.change("enums");
    }
    return;
  }
  if (u === "OTHER") return;
  if (!other) {
    t.warn("kept_as_extension", n.line, `${n.tag} ${v}`);
    return;
  }
  n.value = "OTHER";
  if (!child(n, "PHRASE")) n.children.unshift(mk("PHRASE", v));
  t.change("enums");
}

function formToMime(form: GNode, url: string, t: Tally): void {
  const v = (form.value ?? "").trim().toLowerCase().replace(/^\./, "");
  if (/^[a-z]+\/[a-z0-9.+-]+/.test(v)) return;
  const mime = MIME[v] ?? MIME[extOf(url)];
  if (mime) {
    form.value = mime;
    t.change("media_types");
  } else {
    form.value = "application/octet-stream";
    t.warn("media_type_guessed", form.line, `FORM ${form.value === v ? v : v || "(empty)"} ${url}`.trim());
  }
}

/**
 * OBJE record or link in 5.5/5.5.1 form to the 7.0 form: FORM (5.5) and TITL
 * belong under FILE, BLOB no longer exists.
 */
function restructureObje(c: GNode, t: Tally): void {
  const files = c.children.filter((k) => k.tag === "FILE");
  const titl = child(c, "TITL");
  const form5 = child(c, "FORM");
  if (child(c, "BLOB")) t.warn("blob_removed", c.line, "OBJE BLOB");
  if (!files.length) {
    if (!form5 && !titl && !child(c, "BLOB")) return;
    // Without a file 7.0 cannot have an OBJE record: empty FILE with the title.
    const f = mk("FILE", "", [mk("FORM", "application/octet-stream")]);
    files.push(f);
    c.children.unshift(f);
    t.warn("media_type_guessed", c.line, "OBJE");
  }
  for (const f of files) {
    if (form5 && !child(f, "FORM")) f.children.unshift({ ...form5, children: [...form5.children] });
    if (titl && !child(f, "TITL")) f.children.push({ ...titl, children: [...titl.children] });
  }
  c.children = c.children.filter((k) => k !== titl && k !== form5 && k.tag !== "BLOB");
}

/** An OBJE without a pointer becomes an OBJE record; returns the new ID. */
function obje7Record(c: GNode, ctx: Ctx7): string {
  const id = ctx.nextId("O");
  const rec: GNode = { tag: "OBJE", xref: id, value: null, pointer: false, children: c.children, line: c.line };
  walk7(rec, [], ctx);
  ctx.newRecords.push(rec);
  ctx.t.change("media_records");
  return id;
}

/** A SOUR with text instead of a pointer becomes a SOUR record (TITL + TEXT). */
function sour7Record(c: GNode, ctx: Ctx7): GNode {
  const { t } = ctx;
  const title = c.value ?? "";
  const text = c.children.filter((k) => k.tag === "TEXT");
  const keep = c.children.filter((k) => k.tag !== "TEXT");
  const key = `${title}\u0000${text.map((x) => x.value).join("\u0000")}`;
  let id = ctx.sourceIndex.get(key);
  if (!id) {
    id = ctx.nextId("S");
    ctx.sourceIndex.set(key, id);
    const rec: GNode = { tag: "SOUR", xref: id, value: null, pointer: false, children: [], line: c.line };
    if (title) rec.children.push(mk("TITL", title));
    rec.children.push(...text.map((x) => ({ ...x })));
    ctx.newRecords.push(rec);
    t.change("source_records");
  }
  const link: GNode = { tag: "SOUR", xref: null, value: `@${id}@`, pointer: true, children: keep, line: c.line };
  walk7(link, [], ctx);
  return link;
}

function exid7(c: GNode, ctx: Ctx7): GNode {
  const { t } = ctx;
  let v = (c.value ?? "").trim();
  let type = "https://gedcom.io/terms/v7/AFN";
  if (c.tag === "RFN") {
    const m = v.match(/^([^:]+):(.+)$/);
    if (m) {
      type = `https://gedcom.io/terms/v7/RFN#${encodeURIComponent(m[1])}`;
      v = m[2];
    } else type = "https://gedcom.io/terms/v7/RFN";
  } else if (c.tag === "RIN") {
    type = `https://gedcom.io/terms/v7/RIN${ctx.headSour ? `#${encodeURIComponent(ctx.headSour)}` : ""}`;
  }
  t.change("exid");
  return mk("EXID", v, [mk("TYPE", type)]);
}

function namePieces7(n: GNode, t: Tally): void {
  const PIECES = ["NPFX", "GIVN", "NICK", "SPFX", "SURN", "NSFX"];
  const name = (n.value ?? "").replace(/\//g, " ");
  const out: GNode[] = [];
  for (const k of n.children) {
    if (!PIECES.includes(k.tag) || !k.value || !k.value.includes(",")) {
      out.push(k);
      continue;
    }
    const parts = k.value.split(/\s*,\s*/).filter(Boolean);
    if (parts.length < 2) {
      out.push(k);
      continue;
    }
    const inName = parts.filter((p) => name.includes(p)).length;
    if (parts.some((p) => p.includes(" ")) || inName <= 1) {
      for (const p of parts) out.push({ ...k, value: p, children: [] });
      if (k.children.length) out[out.length - 1].children = k.children;
    } else {
      out.push({ ...k, value: parts.join(" ") });
    }
    t.change("name_pieces");
  }
  n.children = out;
}

/* 7.0 -> 5.5.1 */

function to551(roots: GNode[], t: Tally): GNode[] {
  const out: GNode[] = [];
  let head: GNode | null = null;
  let subm: string | null = null;
  for (const r of roots) {
    if (r.tag === "TRLR") continue;
    if (r.tag === "HEAD") {
      head = r;
      continue;
    }
    if (r.tag === "SNOTE") {
      r.tag = "NOTE";
      t.change("shared_notes");
    }
    if (r.tag === "SUBM" && r.xref && !subm) subm = r.xref;
    if (!TAGS551.has(r.tag) && !r.tag.startsWith("_")) {
      t.change("ext_tags");
      t.warn("kept_as_extension", r.line, r.tag);
      r.tag = `_${r.tag}`;
    }
    walk551(r, []);
    out.push(r);
  }

  function walk551(n: GNode, path: string[]): void {
    const here = [...path, n.tag];
    const parent = path[path.length - 1] ?? "";
    const kids: GNode[] = [];
    for (const c of n.children) {
      // @VOID@: REPO may be empty in 5.5.1; everything else is dropped.
      if (c.pointer && c.value === "@VOID@") {
        if (c.tag === "REPO") {
          c.value = null;
          c.pointer = false;
          t.change("void_pointers");
        } else {
          t.warn("void_removed", c.line, `${c.tag} @VOID@`);
          continue;
        }
      }
      if (c.tag === "SNOTE") {
        c.tag = "NOTE";
        t.change("shared_notes");
      }
      if (c.tag === "EXID") {
        kids.push(exid551(c));
        continue;
      }
      if (c.tag === "UID") {
        c.tag = "_UID";
        t.change("uid");
      }
      if (c.tag === "TRAN" && (n.tag === "NAME" || n.tag === "PLAC")) {
        kids.push(tran551(c));
        continue;
      }
      if (c.tag === "ROLE" && n.tag === "ASSO") {
        const phrase = child(c, "PHRASE")?.value;
        const v = (c.value ?? "").trim().toUpperCase();
        const rela = v === "OTHER" || !ROLE_WORD[v] ? phrase || "Other" : phrase || ROLE_WORD[v];
        kids.push(mk("RELA", rela));
        t.change("rela_role");
        continue;
      }
      if (c.tag === "MIME" && (n.tag === "NOTE" || n.tag === "SNOTE" || n.tag === "TEXT")) {
        if ((c.value ?? "").toLowerCase().includes("html")) t.warn("html_note", c.line, "MIME text/html");
        continue;
      }
      walk551(c, here);
      kids.push(c);
    }
    n.children = kids;
    fixValue551(n, parent);
    for (const k of n.children) {
      if (!TAGS551.has(k.tag) && !k.tag.startsWith("_")) {
        t.change("ext_tags");
        t.warn("kept_as_extension", k.line, k.tag);
        k.tag = `_${k.tag}`;
      }
    }
  }

  function exid551(c: GNode): GNode {
    const type = child(c, "TYPE")?.value ?? "";
    const v = c.value ?? "";
    let m: RegExpMatchArray | null;
    t.change("exid");
    if (type === "https://gedcom.io/terms/v7/AFN") return mk("AFN", v);
    if ((m = type.match(/^https:\/\/gedcom\.io\/terms\/v7\/RFN(?:#(.+))?$/))) return mk("RFN", m[1] ? `${decodeSafe(m[1])}:${v}` : v);
    if (/^https:\/\/gedcom\.io\/terms\/v7\/RIN/.test(type)) return mk("RIN", v);
    t.warn("kept_as_extension", c.line, `EXID ${type}`);
    return { ...c, tag: "_EXID" };
  }

  function tran551(c: GNode): GNode {
    const lang = (child(c, "LANG")?.value ?? "").toLowerCase();
    const back = Object.entries(TRAN_LANG).find(([, l]) => l.toLowerCase() === lang);
    const rest = c.children.filter((k) => k.tag !== "LANG");
    t.change("tran");
    if (back) {
      const tag = ["hangul", "kana"].includes(back[0]) ? "FONE" : "ROMN";
      return { ...c, tag, children: [mk("TYPE", back[0]), ...rest] };
    }
    if (/-latn/.test(lang)) return { ...c, tag: "ROMN", children: [mk("TYPE", lang), ...rest] };
    if (/^ja-(hrkt|hira|kana)/.test(lang)) return { ...c, tag: "FONE", children: [mk("TYPE", "kana"), ...rest] };
    t.warn("kept_as_extension", c.line, `TRAN ${lang}`);
    return { ...c, tag: "_TRAN" };
  }

  function fixValue551(n: GNode, parent: string): void {
    const phraseNode = child(n, "PHRASE");
    const phrase = phraseNode?.value ?? null;
    const dropPhrase = () => {
      n.children = n.children.filter((k) => k !== phraseNode);
    };
    switch (n.tag) {
      case "DATE": {
        if (n.value === null && phrase === null) return;
        const r = dateTo551(n.value ?? "", phrase);
        if (r.value !== n.value) t.change(phrase ? "dates_phrase" : "dates_calendar");
        n.value = r.value;
        if (phraseNode && r.leftover === null) dropPhrase();
        return;
      }
      case "AGE": {
        const v = (n.value ?? "").trim();
        const p = (phrase ?? "").toLowerCase();
        let nv: string | null = null;
        if (v === "< 8y" && p === "child") nv = "CHILD";
        else if (v === "< 1y" && p === "infant") nv = "INFANT";
        else if (v === "0y" && p === "stillborn") nv = "STILLBORN";
        if (nv) {
          n.value = nv;
          dropPhrase();
          t.change("ages");
        } else if (!v && phrase) {
          n.tag = "_AGE";
          n.value = phrase;
          dropPhrase();
          t.warn("age_phrase_only", n.line, phrase);
        } else if (/[<>] /.test(v)) {
          n.value = v.replace(/([<>]) /, "$1");
          t.change("ages");
        }
        return;
      }
      case "SEX":
        if (n.value === "X") {
          n.value = "U";
          t.warn("sex_lost", n.line, "SEX X");
        }
        return;
      case "TYPE":
        if (parent === "NAME") {
          lower(n, phrase, dropPhrase, true);
        }
        return;
      case "MEDI":
        if (parent === "FORM") n.tag = "TYPE";
        lower(n, phrase, dropPhrase, true);
        return;
      case "PEDI":
        lower(n, phrase, dropPhrase, false);
        return;
      case "STAT":
        if (parent === "FAMC") lower(n, phrase, dropPhrase, false);
        return;
      case "RESN":
        if (n.value) {
          const v = n.value.split(/[,\s]+/).filter(Boolean)[0]?.toLowerCase() ?? "";
          if (n.value.includes(",")) t.warn("resn_dropped", n.line, n.value);
          if (v !== n.value) t.change("enums");
          n.value = v;
        }
        return;
      case "ROLE":
        if (n.value === "OTHER" && phrase) {
          n.value = `(${phrase.replace(/[()]/g, "")})`;
          dropPhrase();
          t.change("enums");
        }
        return;
      case "LANG":
        if (parent === "HEAD" || parent === "SUBM") {
          const name = LANG_BACK[(n.value ?? "").toLowerCase()] ?? LANG_BACK[(n.value ?? "").toLowerCase().split("-")[0]];
          if (name) {
            n.value = name;
            t.change("lang_tags");
          } else {
            t.warn("lang_unknown", n.line, n.value ?? "");
            n.tag = "_LANG";
          }
        } else {
          n.tag = "_LANG";
        }
        return;
      case "FILE": {
        if (n.value) {
          const p = filePathTo551(n.value);
          if (p !== n.value) {
            n.value = p;
            t.change("file_paths");
          }
        }
        const form = child(n, "FORM");
        if (form?.value && form.value.includes("/")) {
          const mime = form.value.toLowerCase().split(";")[0].trim();
          form.value = MIME_BACK[mime] ?? (extOf(n.value ?? "") || mime.split("/")[1]);
          t.change("media_types");
        }
        return;
      }
      default:
        return;
    }
  }

  function lower(n: GNode, phrase: string | null, dropPhrase: () => void, phraseAsValue: boolean): void {
    const v = (n.value ?? "").trim();
    if (v === "OTHER" && phrase && phraseAsValue) {
      n.value = phrase;
      dropPhrase();
      t.change("enums");
      return;
    }
    if (/^[A-Z_]+$/.test(v)) {
      n.value = v.toLowerCase();
      t.change("enums");
    }
  }

  // The header: GEDC VERS 5.5.1 + FORM, CHAR UTF-8, SUBM (required in 5.5.1).
  const h = head ?? mk("HEAD");
  if (!head) t.warn("no_head");
  const kids: GNode[] = [];
  for (const c of h.children) {
    if (c.tag === "GEDC") continue;
    if (c.tag === "SCHMA") {
      if (c.children.length) t.warn("schma_removed", c.line, `SCHMA (${c.children.length})`);
      continue;
    }
    if (c.tag === "SNOTE") c.tag = "NOTE";
    kids.push(c);
  }
  const hasSubm = kids.some((k) => k.tag === "SUBM");
  if (!hasSubm) {
    if (!subm) {
      subm = "SUBM1";
      out.push({ tag: "SUBM", xref: subm, value: null, pointer: false, children: [mk("NAME", "Unknown")], line: 0 });
      t.change("subm_added");
    }
    kids.push(mk("SUBM", `@${subm}@`, [], true));
  }
  const gedc = mk("GEDC", null, [mk("VERS", "5.5.1"), mk("FORM", "LINEAGE-LINKED")]);
  const newHead: GNode = { ...h, children: [gedc, mk("CHAR", "UTF-8"), ...kids] };
  walk551(newHead, []);
  t.change("header");
  out.unshift(newHead);
  out.push(mk("TRLR"));
  return out;
}

/* writing */

function serialize(roots: GNode[], target: ConvertTarget, t: Tally): string[] {
  const lines: string[] = [];
  let split = 0;
  const esc = (v: string) => {
    if (target === "7.0") return v.startsWith("@") ? `@${v}` : v;
    // 5.5.1: double every @, except the calendar escapes @#D...@ in dates.
    return v.replace(/@#D[A-Z ]+@|@/g, (m) => (m === "@" ? "@@" : m));
  };
  const emit = (n: GNode, level: number) => {
    const head = `${level}${n.xref ? ` @${n.xref}@` : ""} ${n.tag}`;
    if (n.value === null || n.value === "") {
      lines.push(head);
    } else if (n.pointer) {
      lines.push(`${head} ${n.value}`);
    } else {
      const parts = n.value.split("\n");
      parts.forEach((p, i) => {
        const prefix = i === 0 ? head : `${level + 1} CONT`;
        const text = p === "" ? "" : esc(p);
        if (target === "5.5.1" && prefix.length + 1 + text.length > 255) {
          // 5.5.1: at most 255 characters per line; the rest goes on CONC, never split next to a space.
          let rest = text;
          let first = true;
          while (rest.length) {
            const pre = first ? prefix : `${level + 1} CONC`;
            const room = 255 - pre.length - 1;
            let cut = Math.min(room, rest.length);
            if (cut < rest.length) {
              while (cut > 1 && (rest[cut - 1] === " " || rest[cut] === " " || rest[cut - 1] === "@")) cut--;
              if (cut <= 1) cut = Math.min(room, rest.length);
              split++;
            }
            lines.push(`${pre} ${rest.slice(0, cut)}`);
            rest = rest.slice(cut);
            first = false;
          }
        } else {
          lines.push(text === "" ? prefix : `${prefix} ${text}`);
        }
      });
    }
    for (const c of n.children) emit(c, level + 1);
  };
  for (const r of roots) emit(r, 0);
  t.change("long_lines_split", split);
  return lines;
}

/* the main function */

export function convertDecoded(decoded: DecodedGedcom, target: ConvertTarget): ConvertResult {
  const t = new Tally();
  const peek = parseTree(decoded.text.slice(0, 4096), false);
  const fromVersion = headVersion(peek.roots);
  const from7 = !!fromVersion && /^7/.test(fromVersion);
  const parsed = parseTree(decoded.text, from7);
  if (from7 === (target === "7.0")) t.warn("already_target", 0, fromVersion ?? "");
  for (const b of parsed.badLines) t.warn("bad_line", b.line, b.text);
  t.change("levels_fixed", parsed.levelJumps);
  if (target === "7.0") t.change("conc_joined", parsed.conc);

  if (decoded.used !== "UTF-8" && decoded.used !== "ASCII") t.change("encoding");

  let roots = parsed.roots;
  const known = new Set(roots.map((r) => r.xref).filter(Boolean) as string[]);
  const map = target === "7.0" ? xrefMap7(roots, t) : xrefMap551(roots, t);
  remapPointers(roots, map, known, t);

  // @ signs: count values whose escaping changes.
  let ats = 0;
  const countAt = (ns: GNode[]) => {
    for (const n of ns) {
      if (n.value && !n.pointer && n.value.includes("@")) ats++;
      countAt(n.children);
    }
  };
  countAt(roots);
  t.change("at_signs", ats);

  roots = target === "7.0" ? to7(roots, t) : to551(roots, t);

  const ext = new Map<string, number>();
  const countExt = (ns: GNode[]) => {
    for (const n of ns) {
      if (n.tag.startsWith("_")) ext.set(n.tag, (ext.get(n.tag) ?? 0) + 1);
      countExt(n.children);
    }
  };
  countExt(roots);

  const lines = serialize(roots, target, t);
  const text = "\ufeff" + lines.join("\r\n") + "\r\n";

  // A repeated "kept_as_extension" warning for the same tag counts per line; that is intended.
  const order: WarnCode[] = [
    "no_head", "already_target", "bad_line", "date_phrase_only", "age_phrase_only", "sex_lost", "lang_unknown", "media_type_guessed",
    "subn_removed", "blob_removed", "head_file_removed", "void_removed", "schma_removed", "html_note", "resn_dropped",
    "dangling_pointer", "kept_as_extension",
  ];
  const warnings = [...t.warnings.values()].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));

  return {
    text,
    report: {
      fromVersion,
      to: target,
      encoding: decoded.used,
      linesIn: parsed.lines,
      linesOut: lines.length,
      records: countRecords(roots),
      changes: t.changes,
      warnings,
      extensions: [...ext.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag, count]) => ({ tag, count })),
    },
  };
}

/** The most obvious direction: a 7.0 file back to 5.5.1, everything else to 7.0. */
export function defaultTarget(text: string): ConvertTarget {
  const v = headVersion(parseTree(text.slice(0, 4096), false).roots);
  return v && /^7/.test(v) ? "5.5.1" : "7.0";
}
