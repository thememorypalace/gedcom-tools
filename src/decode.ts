/**
 * GEDCOM bytes to text, using the character set the file really uses.
 *
 * Why not just read the file as UTF-8: files from older genealogy programs
 * are often ANSEL (the old GEDCOM standard) or Windows ANSI. Read as UTF-8,
 * accented letters turn into question marks or "Ã©" instead of "é". This
 * module reads the header (1 CHAR ...), checks whether the bytes are valid
 * UTF-8, and decodes ANSEL itself, since no browser or runtime supports it.
 *
 * Pure computation on a Uint8Array. No network, no storage, no Node APIs;
 * runs in browsers, workers and Node 18+.
 */

export type GedcomEncoding = "UTF-8" | "UTF-16LE" | "UTF-16BE" | "ANSEL" | "WINDOWS-1252" | "ASCII";

export interface DecodedGedcom {
  text: string;
  /** What the header says (1 CHAR ...), upper case, or null without a CHAR line. */
  declared: string | null;
  /** The character set that was used to read the bytes. */
  used: GedcomEncoding;
  hadBom: boolean;
  /** Bytes above 0x7F were present. Without them the character set does not matter. */
  hasHighBytes: boolean;
  /** The header names a different character set than the bytes really are (for example ANSEL, but really UTF-8). */
  mislabeled: boolean;
  /** Characters that could not be read (U+FFFD after decoding). */
  unreadable: number;
  /** Line endings as they appear in the file. */
  lineEndings: { crlf: number; lf: number; cr: number };
}

/* ANSEL (ANSI/NISO Z39.47) with the GEDCOM extensions */

const ANSEL_SPACING: Record<number, string> = {
  0xa1: "\u0141", 0xa2: "\u00d8", 0xa3: "\u0110", 0xa4: "\u00de", 0xa5: "\u00c6", 0xa6: "\u0152",
  0xa7: "\u02b9", 0xa8: "\u00b7", 0xa9: "\u266d", 0xaa: "\u00ae", 0xab: "\u00b1", 0xac: "\u01a0",
  0xad: "\u01af", 0xae: "\u02bc", 0xb0: "\u02bb", 0xb1: "\u0142", 0xb2: "\u00f8", 0xb3: "\u0111",
  0xb4: "\u00fe", 0xb5: "\u00e6", 0xb6: "\u0153", 0xb7: "\u02ba", 0xb8: "\u0131", 0xb9: "\u00a3",
  0xba: "\u00f0", 0xbc: "\u01a1", 0xbd: "\u01b0", 0xbe: "\u25a1", 0xbf: "\u25a0",
  0xc0: "\u00b0", 0xc1: "\u2113", 0xc2: "\u2117", 0xc3: "\u00a9", 0xc4: "\u266f", 0xc5: "\u00bf",
  0xc6: "\u00a1", 0xc7: "\u00df", 0xc8: "\u20ac", 0xcd: "e", 0xce: "o", 0xcf: "\u00df",
};

/** Combining marks: in ANSEL they come BEFORE the base letter, in Unicode after it. */
const ANSEL_COMBINING: Record<number, string> = {
  0xe0: "\u0309", 0xe1: "\u0300", 0xe2: "\u0301", 0xe3: "\u0302", 0xe4: "\u0303", 0xe5: "\u0304",
  0xe6: "\u0306", 0xe7: "\u0307", 0xe8: "\u0308", 0xe9: "\u030c", 0xea: "\u030a", 0xeb: "\ufe20",
  0xec: "\ufe21", 0xed: "\u0315", 0xee: "\u030b", 0xef: "\u0310", 0xf0: "\u0327", 0xf1: "\u0328",
  0xf2: "\u0323", 0xf3: "\u0324", 0xf4: "\u0325", 0xf5: "\u0333", 0xf6: "\u0332", 0xf7: "\u0326",
  0xf8: "\u031c", 0xf9: "\u032e", 0xfa: "\ufe22", 0xfb: "\ufe23", 0xfe: "\u0313",
};

/** Decodes ANSEL bytes (with the GEDCOM extensions) to an NFC-normalised string. */
export function decodeAnsel(bytes: Uint8Array): string {
  const out: string[] = [];
  let pending = "";
  let chunk = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80) {
      const ch = String.fromCharCode(b);
      // A combining mark belongs to the next letter; before a line break it has none.
      if (pending && (b === 0x0a || b === 0x0d)) {
        chunk += pending;
        pending = "";
      }
      chunk += ch + pending;
      pending = "";
    } else if (ANSEL_COMBINING[b]) {
      pending += ANSEL_COMBINING[b];
    } else {
      const s = ANSEL_SPACING[b] ?? "\ufffd";
      chunk += s + pending;
      pending = "";
    }
    if (chunk.length > 8192) {
      out.push(chunk);
      chunk = "";
    }
  }
  out.push(chunk + pending);
  // NFC: "e" plus a combining accent becomes a plain "é" again.
  return out.join("").normalize("NFC");
}

/* detection */

function readDeclaredChar(bytes: Uint8Array): string | null {
  // The header is at the top; 64 kB is plenty, even with long SOUR blocks.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const m = head.match(/(?:^|[\r\n])\s*1\s+CHAR\s+([^\r\n]+)/);
  return m ? m[1].trim().toUpperCase() : null;
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function countLineEndings(text: string): DecodedGedcom["lineEndings"] {
  let crlf = 0, lf = 0, cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) { crlf++; i++; } else cr++;
    } else if (c === 10) lf++;
  }
  return { crlf, lf, cr };
}

function countReplacement(text: string): number {
  let n = 0;
  for (let i = text.indexOf("\ufffd"); i !== -1; i = text.indexOf("\ufffd", i + 1)) n++;
  return n;
}

/**
 * Reads GEDCOM bytes with the right character set.
 *
 * Order of decisions: a UTF-16 byte order mark wins; pure ASCII is read as is;
 * valid UTF-8 is read as UTF-8 even when the header says otherwise; ANSEL is
 * used when the header says ANSEL; everything else is read as Windows-1252.
 */
export function decodeGedcom(input: ArrayBuffer | Uint8Array): DecodedGedcom {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  // UTF-16 with a BOM (rare, but some Windows programs write it).
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return finish(new TextDecoder("utf-16le").decode(bytes.subarray(2)), "UTF-16LE", true, true, null);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return finish(new TextDecoder("utf-16be").decode(bytes.subarray(2)), "UTF-16BE", true, true, null);

  const hadBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = hadBom ? bytes.subarray(3) : bytes;
  const declared = readDeclaredChar(body);

  let hasHighBytes = false;
  for (let i = 0; i < body.length; i++) {
    if (body[i] > 0x7f) { hasHighBytes = true; break; }
  }

  if (!hasHighBytes) {
    // Pure ASCII: every character set reads this the same way.
    return finish(new TextDecoder("utf-8").decode(body), "ASCII", hadBom, false, declared);
  }

  const utf8 = hadBom || isValidUtf8(body);
  const d = declared || "";
  if (utf8) {
    // Valid UTF-8 with bytes above 0x7F is (almost) never a coincidence: even if
    // the header says ANSEL or ANSI, this is UTF-8 and we read it that way.
    return finish(new TextDecoder("utf-8").decode(body), "UTF-8", hadBom, true, declared);
  }
  if (d === "ANSEL") return finish(decodeAnsel(body), "ANSEL", hadBom, true, declared);
  // ANSI, IBMPC, ASCII with high bytes, or "UTF-8" that is not UTF-8:
  // Windows-1252 is what Windows programs write by default.
  return finish(new TextDecoder("windows-1252").decode(body), "WINDOWS-1252", hadBom, true, declared);
}

function finish(
  text: string,
  used: GedcomEncoding,
  hadBom: boolean,
  hasHighBytes: boolean,
  declared: string | null,
): DecodedGedcom {
  const clean = text.replace(/^\ufeff/, "");
  const decl = (declared || "").replace(/[^A-Z0-9-]/g, "");
  let mislabeled = false;
  if (hasHighBytes && decl) {
    if (used === "UTF-8") mislabeled = decl !== "UTF-8" && decl !== "UTF8" && decl !== "UNICODE";
    else if (used === "ANSEL") mislabeled = false;
    else if (used === "WINDOWS-1252") mislabeled = !["ANSI", "WINDOWS-1252", "CP1252", "ISO-8859-1", "LATIN1", "IBMPC", "IBM-PC"].includes(decl);
    else if (used === "UTF-16LE" || used === "UTF-16BE") mislabeled = decl !== "UNICODE" && decl !== "UTF-16";
  }
  return {
    text: clean,
    declared,
    used,
    hadBom,
    hasHighBytes,
    mislabeled,
    unreadable: countReplacement(clean),
    lineEndings: countLineEndings(clean),
  };
}

/* garbled characters ("Ã©" instead of "é") */

/**
 * Double-encoded UTF-8: text that was once written as UTF-8, read by a program
 * as Windows-1252 and saved again as UTF-8. Recognisable by an "Ã" or "Â"
 * followed by a character from the 0x80-0xBF range as Windows-1252 shows it.
 */
const MOJIBAKE = /[\u00c2-\u00df][\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018\u2019\u201a\u201c\u201d\u201e\u2020\u2021\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]|\u00e2\u20ac[\u0080-\u00bf\u2122\u0153\u02dc\u201c\u201d\u2018\u2019\u00a6]/g;

export interface MojibakeHit {
  line: number;
  sample: string;
  fixed: string;
}

/** Windows-1252 characters 0x80-0x9F back to their byte. */
const CP1252_BACK: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/**
 * Tries to repair one piece of garbled text. Returns null when that cannot be
 * done exactly: an ugly character is better than a wrong one.
 */
export function unMojibake(s: string): string | null {
  const bytes: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x100) bytes.push(c);
    else if (CP1252_BACK[c] !== undefined) bytes.push(CP1252_BACK[c]);
    else return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

/**
 * Repairs the garbled pieces in one line. Only runs of characters with a hit
 * are touched, and only when the reverse calculation is exact.
 */
export function fixMojibakeLine(line: string): string {
  if (!MOJIBAKE.test(line)) {
    MOJIBAKE.lastIndex = 0;
    return line;
  }
  MOJIBAKE.lastIndex = 0;
  // Reverse each run of non-ASCII characters on its own.
  return line.replace(/[^\x00-\x7f]+/g, (run) => {
    MOJIBAKE.lastIndex = 0;
    if (!MOJIBAKE.test(run)) return run;
    MOJIBAKE.lastIndex = 0;
    const fixed = unMojibake(run);
    return fixed ?? run;
  });
}

/** Lines with garbled characters, with a sample and what the repair would give. */
export function findMojibake(lines: string[], max = 2000): { count: number; hits: MojibakeHit[]; fixable: number } {
  let count = 0;
  let fixable = 0;
  const hits: MojibakeHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    MOJIBAKE.lastIndex = 0;
    if (!MOJIBAKE.test(line)) continue;
    MOJIBAKE.lastIndex = 0;
    count++;
    const fixed = fixMojibakeLine(line);
    if (fixed !== line) fixable++;
    if (hits.length < max) hits.push({ line: i + 1, sample: line.trim().slice(0, 120), fixed: fixed.trim().slice(0, 120) });
  }
  return { count, hits, fixable };
}

/* names that look damaged */

const MOJIBAKE_ONE = new RegExp(MOJIBAKE.source);
/** Unreadable character (U+FFFD) or a control character (C0 except tab, DEL, C1) inside text. */
const BROKEN_CHAR = /[\ufffd\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
/** "Ã" or "Â" at the end of a word: a UTF-8 sequence whose second byte is gone. */
const CUT_SEQUENCE = /[\u00c2\u00c3](?=\s|$)/;
/**
 * A non-ASCII character that is not a letter, mark, digit, space or punctuation
 * (such as ¤, ©, ¼ or ±). In a name or place that points to a wrong character
 * set; ä, ö, ü, ß, é, ñ, ø and every other letter fall under \p{L}.
 */
const ODD_SYMBOL = /[^\u0000-\u007f\p{L}\p{M}\p{Nd}\p{Zs}\p{P}]/u;

/**
 * Does this text look damaged? Unicode aware: correct names with umlauts and
 * accents (Müller, Größe, Muñoz) are fine, garbled text (MÃ¼ller) and
 * unreadable characters are not. `strict` (names and places) also counts odd
 * symbols; in notes those can be intended.
 */
export function looksGarbled(s: string, strict = true): boolean {
  if (BROKEN_CHAR.test(s) || MOJIBAKE_ONE.test(s) || CUT_SEQUENCE.test(s)) return true;
  return strict && ODD_SYMBOL.test(s);
}
