import { findMojibake, fixMojibakeLine, looksGarbled, type DecodedGedcom } from "./decode";

/**
 * The GEDCOM checker: reads a file line by line and reports, as structured
 * findings, what is wrong with it. Afterwards, only where that is safe, it can
 * produce a repaired file (repairDecoded).
 *
 * Safe means: the repair touches the form of the file (character set, CHAR
 * header, line endings, empty lines, indentation, missing HEAD or TRLR), never
 * the genealogical content. Names, dates, places and pointers stay exactly as
 * they were. Garbled characters ("Ã©") are only repaired on request
 * (fixGarbled), and only where the reverse calculation is exact.
 *
 * Pure computation: no network, no storage, no Node APIs.
 */

export type Severity = "error" | "warning" | "info";

export type IssueCode =
  | "encoding_mislabeled"
  | "encoding_ansel"
  | "encoding_ansi"
  | "encoding_no_char"
  | "encoding_uncertain"
  | "encoding_unreadable"
  | "garbled_chars"
  | "head_missing"
  | "head_not_first"
  | "trlr_missing"
  | "after_trlr"
  | "version_missing"
  | "bad_line"
  | "level_jump"
  | "leading_space"
  | "blank_lines"
  | "line_endings"
  | "line_too_long"
  | "conc_in_v7"
  | "cont_misplaced"
  | "duplicate_id"
  | "broken_pointer"
  | "one_sided_link"
  | "no_name"
  | "death_before_birth"
  | "child_before_parent"
  | "parent_too_young"
  | "born_after_mother_death"
  | "too_old"
  | "bad_date"
  | "empty_family"
  | "own_ancestor";

export interface IssueExample {
  /** Line number in the file (1 = first line), when there is one. */
  line?: number;
  /** What to show: an ID, a name, or a piece of the line. */
  text: string;
  /**
   * The record the line belongs to: the GEDCOM ID (without @) and, for a
   * person or family, the name. That lets someone without a text editor find
   * the person again in their own genealogy program.
   */
  who?: ExampleWho;
}

export interface ExampleWho {
  id: string;
  /** Name of the person, or "Husband & Wife" for a family; absent when there is none. */
  name?: string;
}

export interface CheckIssue {
  code: IssueCode;
  severity: Severity;
  count: number;
  examples: IssueExample[];
  /** Fixed by repairDecoded. */
  fixable: boolean;
  /** A repair that must be requested explicitly (fixGarbled). */
  optIn?: boolean;
  params?: Record<string, string>;
}

export interface CheckResult {
  version: string | null;
  /** "5.5", "5.5.1", "5.5.5", "7.0" or "other". */
  versionFamily: "5.5" | "5.5.1" | "5.5.5" | "7.0" | "other" | null;
  encoding: { declared: string | null; used: string; hadBom: boolean };
  lines: number;
  people: number;
  families: number;
  issues: CheckIssue[];
  /** There is something repairDecoded can safely fix. */
  repairable: boolean;
  /**
   * Names, places and notes that look damaged (garbled or unreadable
   * characters), with the person attached. Correct letters with umlauts or
   * accents are not listed. When the character set was a guess (accentGuess),
   * up to eight ordinary lines with non-ASCII letters are added, so a person
   * can check by eye whether the guess was right.
   */
  accentSamples: IssueExample[];
  /** The character set was a guess: accentSamples also holds ordinary lines with accents. */
  accentGuess: boolean;
}

const MAX_EXAMPLES = 50;

/* dates */

const MONTHS: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const OTHER_CAL_MONTHS = new Set([
  "VEND", "BRUM", "FRIM", "NIVO", "PLUV", "VENT", "GERM", "FLOR", "PRAI", "MESS", "THER", "FRUC", "COMP",
  "TSH", "CSH", "KSL", "TVT", "SHV", "ADR", "ADS", "NSN", "IYR", "SVN", "TMZ", "AAV", "ELL",
]);

export type DateRange = { min: number; max: number };

/** "12 MAR 1850" to a range in yyyymmdd. null = not a Gregorian or Julian date we can read. */
function plainDate(s: string): DateRange | null | "other" {
  let t = s.trim().toUpperCase();
  let other = false;
  // Calendar escapes (5.5: @#DJULIAN@, 7.0: JULIAN). Julian is read as
  // Gregorian: a few days of difference never changes "died before birth".
  t = t.replace(/^@#D(GREGORIAN|JULIAN)@\s*/, "").replace(/^(GREGORIAN|JULIAN)\s+/, "");
  if (/^@#D(HEBREW|FRENCH R|ROMAN|UNKNOWN)@/.test(t) || /^(HEBREW|FRENCH_R)\s/.test(t)) other = true;
  if (other) return "other";
  t = t.replace(/\s+(B\.?C\.?|BCE)$/, " BC");
  const bc = / BC$/.test(t);
  if (bc) return "other";
  const parts = t.split(/\s+/);
  const yearOf = (y: string) => {
    // Dual year (1700/01) from the old New Year rule: the second one is the modern year.
    const m = y.match(/^(\d{1,4})(?:\/(\d{2}))?$/);
    if (!m) return null;
    let n = parseInt(m[1], 10);
    if (m[2]) n = Math.floor(n / 100) * 100 + parseInt(m[2], 10);
    return n;
  };
  if (parts.length === 1) {
    const y = yearOf(parts[0]);
    return y === null ? null : { min: y * 10000 + 101, max: y * 10000 + 1231 };
  }
  if (parts.length === 2) {
    if (OTHER_CAL_MONTHS.has(parts[0])) return "other";
    const mo = MONTHS[parts[0]];
    const y = yearOf(parts[1]);
    if (!mo || y === null) return null;
    return { min: y * 10000 + mo * 100 + 1, max: y * 10000 + mo * 100 + 31 };
  }
  if (parts.length === 3) {
    if (OTHER_CAL_MONTHS.has(parts[1])) return "other";
    const d = parseInt(parts[0], 10);
    const mo = MONTHS[parts[1]];
    const y = yearOf(parts[2]);
    if (!/^\d{1,2}$/.test(parts[0]) || !mo || y === null || d < 1 || d > 31) return null;
    const v = y * 10000 + mo * 100 + d;
    return { min: v, max: v };
  }
  return null;
}

/**
 * A GEDCOM date as a range. "phrase" = free text (valid, but not comparable),
 * "approx" = ABT/EST/CAL (valid, but too vague to prove an impossibility),
 * null = not a valid GEDCOM date.
 */
export function parseDateRange(raw: string): DateRange | "phrase" | "approx" | "other" | null {
  let s = raw.trim();
  if (!s) return "phrase";
  // Date with an explanation: "INT 1850 (roughly)", or 7.0 with a PHRASE substructure.
  if (/^\(.*\)$/.test(s)) return "phrase";
  s = s.replace(/\s*\(.*\)\s*$/, "").trim();
  const u = s.toUpperCase();
  let m = u.match(/^INT\s+(.+)$/);
  if (m) {
    const r = plainDate(m[1]);
    return r;
  }
  if (/^(ABT|EST|CAL)\s+/.test(u)) {
    const r = plainDate(u.replace(/^(ABT|EST|CAL)\s+/, ""));
    return r === null ? null : r === "other" ? "other" : "approx";
  }
  m = u.match(/^BEF\s+(.+)$/);
  if (m) {
    const r = plainDate(m[1]);
    if (r === null || r === "other") return r;
    return { min: -Infinity, max: r.max };
  }
  m = u.match(/^AFT\s+(.+)$/);
  if (m) {
    const r = plainDate(m[1]);
    if (r === null || r === "other") return r;
    return { min: r.min, max: Infinity };
  }
  m = u.match(/^BET\s+(.+?)\s+AND\s+(.+)$/) || u.match(/^FROM\s+(.+?)\s+TO\s+(.+)$/);
  if (m) {
    const a = plainDate(m[1]);
    const b = plainDate(m[2]);
    if (a === null || b === null) return null;
    if (a === "other" || b === "other") return "other";
    return { min: a.min, max: b.max };
  }
  m = u.match(/^FROM\s+(.+)$/) || u.match(/^TO\s+(.+)$/);
  if (m) {
    const r = plainDate(m[1]);
    return r;
  }
  return plainDate(u);
}

/* the check */

type Rec = { tag: string; line: number };

interface IndiInfo {
  id: string;
  line: number;
  name: string;
  hasName: boolean;
  birth?: string;
  birthLine?: number;
  death?: string;
  deathLine?: number;
  famc: string[];
  fams: string[];
}

interface FamInfo {
  id: string;
  line: number;
  husb: string[];
  wife: string[];
  chil: string[];
}

const LINE_RE = /^(\s*)(\d+)(?:\s+(@[^@\s][^@]*@))?\s+([A-Za-z0-9_]+)(?:\s(.*))?$/;
const POINTER_RE = /^@[^@#\s][^@]*@$/;

function familyOf(v: string | null): CheckResult["versionFamily"] {
  if (!v) return null;
  const t = v.trim();
  if (/^7(\.|$)/.test(t)) return "7.0";
  if (t.startsWith("5.5.5")) return "5.5.5";
  if (t.startsWith("5.5.1")) return "5.5.1";
  if (t === "5.5" || /^5\.5(\.0)?$/.test(t)) return "5.5";
  return "other";
}

export function checkDecoded(decoded: DecodedGedcom): CheckResult {
  const text = decoded.text;
  const lines = text.split(/\r\n|\r|\n/);
  // A final line ending gives an empty last "line"; it does not count.
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  const issues = new Map<IssueCode, CheckIssue>();
  const add = (code: IssueCode, severity: Severity, ex?: IssueExample, opts: Partial<CheckIssue> = {}) => {
    let it = issues.get(code);
    if (!it) {
      it = { code, severity, count: 0, examples: [], fixable: false, ...opts };
      issues.set(code, it);
    }
    it.count++;
    if (ex && it.examples.length < MAX_EXAMPLES) it.examples.push(ex);
    return it;
  };

  const records = new Map<string, Rec>();
  const pointers: { from: string; tag: string; target: string; line: number }[] = [];
  const indis = new Map<string, IndiInfo>();
  const fams = new Map<string, FamInfo>();

  let version: string | null = null;
  let firstRecordTag: string | null = null;
  let headSeen = false;
  let trlrLine = 0;
  let afterTrlr = 0;
  let prevLevel = -1;
  /** Level of the last line that is not CONC/CONT. */
  let baseLevel = -1;
  let cur0: { tag: string; xref: string } | null = null;
  const stack: string[] = []; // tags per level inside the current record
  let curIndi: IndiInfo | null = null;
  let curFam: FamInfo | null = null;
  let blank = 0;
  let longLines = 0;
  const concV7: number[] = [];
  const suspectSamples: IssueExample[] = [];
  const plainSamples: IssueExample[] = [];
  /** Start of every record (level 0), in order, to tie a line to its person or family. */
  const recStarts: { line: number; xref: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const ln = i + 1;
    if (!raw.trim()) {
      blank++;
      continue;
    }
    if (trlrLine) {
      afterTrlr++;
      add("after_trlr", "warning", afterTrlr <= 3 ? { line: ln, text: raw.slice(0, 80) } : undefined);
      continue;
    }
    const m = raw.match(LINE_RE);
    if (!m) {
      add("bad_line", "error", { line: ln, text: raw.slice(0, 80) });
      continue;
    }
    const [, lead, lvlStr, xrefRaw, tagRaw, valRaw] = m;
    const level = parseInt(lvlStr, 10);
    const tag = tagRaw.toUpperCase();
    const value = valRaw ?? "";
    const xref = xrefRaw ? xrefRaw.slice(1, -1) : "";

    if (lead) add("leading_space", "warning", { line: ln, text: raw.slice(0, 60) }, { fixable: true });
    if (raw.length > 255) longLines++;
    if (/[^\x00-\x7f]/.test(value) && /^(NAME|PLAC|GIVN|SURN|NICK|NPFX|NSFX|SPFX|NOTE|CONT|CONC)$/.test(tag)) {
      // Only what looks damaged; Müller, Größe or Muñoz are simply fine.
      const strict = !/^(NOTE|CONT|CONC)$/.test(tag);
      if (looksGarbled(value, strict)) {
        if (suspectSamples.length < MAX_EXAMPLES) suspectSamples.push({ line: ln, text: value.trim().slice(0, 80) });
      } else if (plainSamples.length < 8) plainSamples.push({ line: ln, text: value.trim().slice(0, 80) });
    }

    // Levels may only go one step deeper at a time.
    if (prevLevel >= 0 && level > prevLevel + 1) add("level_jump", "error", { line: ln, text: raw.trim().slice(0, 80) });

    if (tag === "CONC" || tag === "CONT") {
      if (level !== baseLevel + 1 || level === 0) add("cont_misplaced", "error", { line: ln, text: raw.trim().slice(0, 80) });
      if (tag === "CONC") concV7.push(ln);
    } else {
      baseLevel = level;
    }
    prevLevel = level;

    if (level === 0) {
      recStarts.push({ line: ln, xref });
      if (firstRecordTag === null) firstRecordTag = tag;
      if (tag === "HEAD") headSeen = true;
      if (tag === "TRLR") {
        trlrLine = ln;
        cur0 = null;
        curIndi = null;
        curFam = null;
        continue;
      }
      if (xref) {
        const prev = records.get(xref);
        if (prev) add("duplicate_id", "error", { line: ln, text: `${prev.tag} ${prev.line}, ${tag} ${ln}` });
        else records.set(xref, { tag, line: ln });
      }
      cur0 = { tag, xref };
      stack.length = 0;
      stack[0] = tag;
      curIndi = null;
      curFam = null;
      if (tag === "INDI" && xref && !indis.has(xref)) {
        curIndi = { id: xref, line: ln, name: "", hasName: false, famc: [], fams: [] };
        indis.set(xref, curIndi);
      } else if (tag === "FAM" && xref && !fams.has(xref)) {
        curFam = { id: xref, line: ln, husb: [], wife: [], chil: [] };
        fams.set(xref, curFam);
      }
      continue;
    }

    stack[level] = tag;
    stack.length = level + 1;

    if (cur0?.tag === "HEAD" && level === 2 && tag === "VERS" && stack[1] === "GEDC") version = value.trim();

    const v = value.trim();
    if (POINTER_RE.test(v) && v !== "@VOID@" && tag !== "CONC" && tag !== "CONT") {
      // With an ID the record (name and ID) is attached later via the line; without one (HEAD) the tag.
      pointers.push({ from: cur0?.xref ? "" : cur0?.tag || "", tag, target: v.slice(1, -1), line: ln });
    }

    if (curIndi) {
      if (level === 1 && tag === "NAME") {
        if (!curIndi.hasName) {
          const nm = v.replace(/\//g, " ").replace(/\s+/g, " ").trim();
          if (nm && !/^(unknown|onbekend|n\.?n\.?|\?+)$/i.test(nm)) {
            curIndi.hasName = true;
            curIndi.name = nm;
          }
        }
      } else if (level === 2 && stack[1] === "NAME" && (tag === "GIVN" || tag === "SURN") && v && !curIndi.hasName) {
        curIndi.hasName = true;
        curIndi.name = v;
      } else if (level === 1 && tag === "FAMC" && POINTER_RE.test(v)) curIndi.famc.push(v.slice(1, -1));
      else if (level === 1 && tag === "FAMS" && POINTER_RE.test(v)) curIndi.fams.push(v.slice(1, -1));
      else if (level === 2 && tag === "DATE" && (stack[1] === "BIRT" || stack[1] === "DEAT")) {
        if (stack[1] === "BIRT" && curIndi.birth === undefined) { curIndi.birth = v; curIndi.birthLine = ln; }
        if (stack[1] === "DEAT" && curIndi.death === undefined) { curIndi.death = v; curIndi.deathLine = ln; }
      }
    } else if (curFam && level === 1 && POINTER_RE.test(v)) {
      const id = v.slice(1, -1);
      if (tag === "HUSB") curFam.husb.push(id);
      else if (tag === "WIFE") curFam.wife.push(id);
      else if (tag === "CHIL") curFam.chil.push(id);
    }

    // Dates: only event dates (not the CHAN or HEAD date with a time).
    if (tag === "DATE" && level >= 2 && cur0?.tag !== "HEAD" && stack[level - 1] !== "CHAN") {
      const r = parseDateRange(v);
      if (r === null) add("bad_date", "warning", { line: ln, text: v.slice(0, 60) });
    }
  }

  const vf = familyOf(version);

  /* header and trailer */
  if (!headSeen) add("head_missing", "error", undefined, { fixable: true });
  else if (firstRecordTag !== "HEAD") add("head_not_first", "error");
  if (!trlrLine) add("trlr_missing", "warning", undefined, { fixable: true });
  if (headSeen && !version) add("version_missing", "warning");
  if (blank > 0) {
    const it = add("blank_lines", "info", undefined, { fixable: true });
    it.count = blank;
  }
  const le = decoded.lineEndings;
  if (le.cr > 0 || [le.crlf, le.lf, le.cr].filter((n) => n > 0).length > 1) {
    const it = add("line_endings", "info", undefined, { fixable: true });
    it.count = le.crlf + le.lf + le.cr;
    it.params = { crlf: String(le.crlf), lf: String(le.lf), cr: String(le.cr) };
  }
  if (longLines > 0 && vf !== "7.0") {
    const it = add("line_too_long", "warning");
    it.count = longLines;
  }
  if (vf === "7.0" && concV7.length) {
    const it = add("conc_in_v7", "warning", { line: concV7[0], text: "CONC" });
    it.count = concV7.length;
  }

  /* character set */
  const decl = decoded.declared;
  const used = decoded.used;
  if (decoded.hasHighBytes) {
    if (decoded.mislabeled) {
      add("encoding_mislabeled", "warning", undefined, { fixable: true, params: { declared: decl || "", used } });
    } else if (used === "ANSEL") {
      add("encoding_ansel", "info", undefined, { fixable: true });
    } else if (used === "WINDOWS-1252") {
      add("encoding_ansi", "info", undefined, { fixable: true, params: { declared: decl || "" } });
    }
    if (decl && /IBM|MAC|ASCII|8859-[2-9]|DOS|850|437/.test(decl.replace(/^ANSI$/, "")) && used === "WINDOWS-1252") {
      add("encoding_uncertain", "warning", undefined, { params: { declared: decl } });
    }
  }
  if (!decl && vf !== "7.0" && headSeen) add("encoding_no_char", "warning", undefined, { fixable: true });
  if (decoded.unreadable > 0) {
    const it = add("encoding_unreadable", "error");
    it.count = decoded.unreadable;
  }
  const moj = findMojibake(lines, MAX_EXAMPLES);
  if (moj.count > 0) {
    const it: CheckIssue = {
      code: "garbled_chars",
      severity: "warning",
      count: moj.count,
      examples: moj.hits.map((h) => ({ line: h.line, text: h.fixed !== h.sample ? `${h.sample}  >  ${h.fixed}` : h.sample })),
      fixable: moj.fixable > 0,
      optIn: true,
      params: { fixable: String(moj.fixable) },
    };
    issues.set("garbled_chars", it);
  }

  /* pointers */
  for (const p of pointers) {
    if (!records.has(p.target)) add("broken_pointer", "error", { line: p.line, text: `${p.from ? `${p.from} ` : ""}${p.tag} @${p.target}@` });
  }

  const label = (id: string) => {
    const p = indis.get(id);
    return p ? `${p.hasName ? p.name : "?"} (@${id}@)` : `@${id}@`;
  };
  /** Name and ID of a record: a person, a family ("Husband & Wife") or anything else (ID only). */
  const whoOf = (id: string): ExampleWho => {
    const p = indis.get(id);
    if (p) return p.hasName ? { id, name: p.name } : { id };
    const f = fams.get(id);
    if (f) {
      const names = [...f.husb, ...f.wife].map((x) => indis.get(x)).filter((x) => x?.hasName).map((x) => x!.name);
      return names.length ? { id, name: names.join(" & ") } : { id };
    }
    return { id };
  };

  // One-sided links: the person says FAMC/FAMS, the family does not list them (or the other way round).
  for (const p of indis.values()) {
    for (const f of p.famc) {
      const fam = fams.get(f);
      if (fam && !fam.chil.includes(p.id)) add("one_sided_link", "warning", { line: p.line, who: whoOf(p.id), text: `FAMC @${f}@` });
    }
    for (const f of p.fams) {
      const fam = fams.get(f);
      if (fam && !fam.husb.includes(p.id) && !fam.wife.includes(p.id)) add("one_sided_link", "warning", { line: p.line, who: whoOf(p.id), text: `FAMS @${f}@` });
    }
  }
  for (const fam of fams.values()) {
    for (const c of fam.chil) {
      const p = indis.get(c);
      if (p && p.famc.length && !p.famc.includes(fam.id)) add("one_sided_link", "warning", { line: fam.line, who: whoOf(fam.id), text: `CHIL ${label(c)}` });
    }
    for (const s of [...fam.husb, ...fam.wife]) {
      const p = indis.get(s);
      if (p && p.fams.length && !p.fams.includes(fam.id)) add("one_sided_link", "warning", { line: fam.line, who: whoOf(fam.id), text: `${fam.husb.includes(s) ? "HUSB" : "WIFE"} ${label(s)}` });
    }
    if (!fam.husb.length && !fam.wife.length && !fam.chil.length) add("empty_family", "info", { line: fam.line, who: whoOf(fam.id), text: "" });
  }

  /* people */
  const range = new Map<string, { b: DateRange | null; d: DateRange | null }>();
  for (const p of indis.values()) {
    if (!p.hasName) add("no_name", "warning", { line: p.line, who: whoOf(p.id), text: "" });
    const b = p.birth !== undefined ? parseDateRange(p.birth) : null;
    const d = p.death !== undefined ? parseDateRange(p.death) : null;
    const br = b && typeof b === "object" ? b : null;
    const dr = d && typeof d === "object" ? d : null;
    range.set(p.id, { b: br, d: dr });
    if (br && dr && dr.max < br.min) add("death_before_birth", "error", { line: p.deathLine, who: whoOf(p.id), text: `${p.birth} / ${p.death}` });
    if (br && dr && Number.isFinite(br.max) && Number.isFinite(dr.min) && Math.floor(dr.min / 10000) - Math.floor(br.max / 10000) > 120) {
      add("too_old", "warning", { line: p.line, who: whoOf(p.id), text: `${p.birth} / ${p.death}` });
    }
  }

  // Parent and child: born before the parent, parent younger than twelve, or born after the mother died.
  const parentsOf = new Map<string, string[]>();
  for (const fam of fams.values()) {
    const parents = [...fam.husb, ...fam.wife].filter((x) => indis.has(x));
    for (const c of fam.chil) {
      if (!indis.has(c)) continue;
      const cur = parentsOf.get(c) || [];
      cur.push(...parents);
      parentsOf.set(c, cur);
      const cb = range.get(c)?.b;
      if (!cb) continue;
      for (const par of parents) {
        const pr = range.get(par);
        if (!pr) continue;
        if (pr.b && Number.isFinite(pr.b.min) && Number.isFinite(cb.max)) {
          if (cb.max < pr.b.min) add("child_before_parent", "error", { line: indis.get(c)!.birthLine, who: whoOf(c), text: `/ ${label(par)}` });
          else if (Math.floor(cb.max / 10000) - Math.floor(pr.b.min / 10000) < 12) add("parent_too_young", "warning", { line: indis.get(c)!.birthLine, who: whoOf(c), text: `< ${label(par)}` });
        }
        if (fam.wife.includes(par) && pr.d && Number.isFinite(pr.d.max) && cb.min > pr.d.max) {
          add("born_after_mother_death", "error", { line: indis.get(c)!.birthLine, who: whoOf(c), text: `/ ${label(par)}` });
        }
      }
    }
  }

  // Someone who is their own ancestor. Iterative, so a long chain cannot overflow the stack.
  const color = new Map<string, 1 | 2>();
  const inCycle = new Set<string>();
  for (const start of indis.keys()) {
    if (color.has(start)) continue;
    const st: { id: string; i: number }[] = [{ id: start, i: 0 }];
    const path: string[] = [start];
    color.set(start, 1);
    while (st.length) {
      const top = st[st.length - 1];
      const ps = parentsOf.get(top.id) || [];
      if (top.i < ps.length) {
        const nx = ps[top.i++];
        const c = color.get(nx);
        if (c === 1) {
          const at = path.lastIndexOf(nx);
          for (const x of path.slice(at)) inCycle.add(x);
        } else if (!c) {
          color.set(nx, 1);
          st.push({ id: nx, i: 0 });
          path.push(nx);
        }
      } else {
        color.set(top.id, 2);
        st.pop();
        path.pop();
      }
    }
  }
  for (const id of inCycle) add("own_ancestor", "error", { line: indis.get(id)?.line, who: whoOf(id), text: "" });

  // Every example with a line number gets the record it sits in: name and ID.
  const recordAt = (ln: number) => {
    let lo = 0, hi = recStarts.length - 1, at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (recStarts[mid].line <= ln) { at = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return at >= 0 ? recStarts[at] : null;
  };
  const attachWho = (ex: IssueExample) => {
    if (ex.who || !ex.line || (trlrLine && ex.line > trlrLine)) return;
    const rec = recordAt(ex.line);
    if (rec?.xref) ex.who = whoOf(rec.xref);
  };
  for (const it of issues.values()) it.examples.forEach(attachWho);

  // Suspicious names; if the character set was a guess, also ordinary lines with accents to check.
  const accentGuess = issues.has("encoding_uncertain");
  const accentSamples = accentGuess ? [...suspectSamples, ...plainSamples.slice(0, Math.max(0, 8 - suspectSamples.length))] : suspectSamples;
  accentSamples.forEach(attachWho);

  // Order: errors first, then warnings, then info.
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  const list = [...issues.values()].sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    version,
    versionFamily: vf,
    encoding: { declared: decl, used, hadBom: decoded.hadBom },
    lines: lines.length,
    people: indis.size,
    families: fams.size,
    issues: list,
    repairable: list.some((i) => i.fixable && !i.optIn) || (decoded.hasHighBytes && used !== "UTF-8" && used !== "ASCII"),
    accentSamples,
    accentGuess,
  };
}

/* repair */

export type RepairChange =
  | "converted_utf8"
  | "char_set_utf8"
  | "char_added"
  | "line_endings"
  | "blank_removed"
  | "indent_removed"
  | "head_added"
  | "trlr_added"
  | "garbled_fixed";

export interface RepairResult {
  text: string;
  changes: { code: RepairChange; count: number }[];
}

/**
 * A repaired file: UTF-8 with BOM, CRLF line endings, a correct CHAR line, no
 * empty lines or indentation, with HEAD and TRLR. Does not touch any name,
 * date, place or pointer, except garbled characters when `fixGarbled` is on
 * (and then only where the reverse calculation is exact).
 */
export function repairDecoded(decoded: DecodedGedcom, check: CheckResult, opts: { fixGarbled?: boolean } = {}): RepairResult {
  const changes = new Map<RepairChange, number>();
  const bump = (c: RepairChange, n = 1) => changes.set(c, (changes.get(c) || 0) + n);

  let lines = decoded.text.split(/\r\n|\r|\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  if (decoded.hasHighBytes && decoded.used !== "UTF-8" && decoded.used !== "ASCII") bump("converted_utf8");

  const le = decoded.lineEndings;
  if (le.lf > 0 || le.cr > 0) bump("line_endings", le.lf + le.cr);

  const out: string[] = [];
  for (let line of lines) {
    if (!line.trim()) {
      bump("blank_removed");
      continue;
    }
    if (/^\s+\d/.test(line)) {
      line = line.replace(/^\s+/, "");
      bump("indent_removed");
    }
    if (opts.fixGarbled) {
      const f = fixMojibakeLine(line);
      if (f !== line) {
        line = f;
        bump("garbled_fixed");
      }
    }
    out.push(line);
  }
  lines = out;

  // HEAD
  const headIdx = lines.findIndex((l) => /^0\s+HEAD\b/.test(l));
  if (headIdx === -1) {
    lines.unshift("0 HEAD", "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8");
    bump("head_added");
  } else if (check.versionFamily !== "7.0") {
    // CHAR inside the header: set it to UTF-8, or add it right under HEAD.
    let end = lines.length;
    for (let i = headIdx + 1; i < lines.length; i++) {
      if (/^0\s/.test(lines[i])) { end = i; break; }
    }
    let found = false;
    for (let i = headIdx + 1; i < end; i++) {
      const m = lines[i].match(/^1\s+CHAR(?:\s+(.*))?$/);
      if (m) {
        found = true;
        if ((m[1] || "").trim().toUpperCase() !== "UTF-8") {
          lines[i] = "1 CHAR UTF-8";
          bump("char_set_utf8");
          // A VERS under CHAR belongs to the old character set (for example the ANSEL version).
          while (i + 1 < end && /^2\s+VERS\b/.test(lines[i + 1])) {
            lines.splice(i + 1, 1);
            end--;
          }
        }
        break;
      }
    }
    if (!found) {
      lines.splice(headIdx + 1, 0, "1 CHAR UTF-8");
      bump("char_added");
    }
  }

  // TRLR
  if (!lines.some((l) => /^0\s+TRLR\b/.test(l))) {
    lines.push("0 TRLR");
    bump("trlr_added");
  }

  return {
    text: "\ufeff" + lines.join("\r\n") + "\r\n",
    changes: [...changes.entries()].map(([code, count]) => ({ code, count })),
  };
}
