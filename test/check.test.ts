import { describe, expect, it } from "vitest";
import { checkGedcom, decodeGedcom, repairGedcom, parseDateRange, ISSUE_MESSAGES } from "../src/index";
import { bytes, fixture, header } from "./helpers";

const codes = (r: ReturnType<typeof checkGedcom>) => r.issues.map((i) => i.code);

describe("checkGedcom on a clean file", () => {
  it("finds nothing and counts the records", () => {
    const r = checkGedcom(fixture("clean-551.ged"));
    expect(r.issues).toEqual([]);
    expect(r.errors).toBe(0);
    expect(r.version).toBe("5.5.1");
    expect(r.versionFamily).toBe("5.5.1");
    expect(r.people).toBe(3);
    expect(r.families).toBe(1);
  });

  it("also accepts the converted 7.0 file without findings", async () => {
    const { convertTo7 } = await import("../src/index");
    const r = checkGedcom(convertTo7(fixture("clean-551.ged")).text);
    expect(r.versionFamily).toBe("7.0");
    expect(r.issues).toEqual([]);
  });
});

describe("checkGedcom on a file with problems", () => {
  const r = checkGedcom(fixture("problems.ged"));
  const get = (code: string) => r.issues.find((i) => i.code === code)!;

  it("reports every expected finding", () => {
    expect(codes(r).sort()).toEqual(
      [
        "bad_date",
        "blank_lines",
        "broken_pointer",
        "child_before_parent",
        "death_before_birth",
        "duplicate_id",
        "empty_family",
        "garbled_chars",
        "level_jump",
        "no_name",
        "one_sided_link",
        "trlr_missing",
      ].sort(),
    );
    expect(r.errors).toBe(5);
  });

  it("orders findings by severity", () => {
    const order = { error: 0, warning: 1, info: 2 } as const;
    const sev = r.issues.map((i) => order[i.severity]);
    expect([...sev].sort()).toEqual(sev);
  });

  it("gives line numbers and the person involved", () => {
    expect(get("death_before_birth").examples[0]).toMatchObject({ line: 12, who: { id: "I1", name: "Karel Dewitte" } });
    expect(get("broken_pointer").examples[0]).toMatchObject({ line: 25, text: "FAMC @F9@", who: { id: "I3" } });
    expect(get("child_before_parent").examples[0].who).toEqual({ id: "I3", name: "Lotte Dewitte" });
    expect(get("one_sided_link").examples[0]).toMatchObject({ who: { id: "I4" }, text: "FAMS @F1@" });
    expect(get("empty_family").examples[0].who).toEqual({ id: "F2" });
  });

  it("marks what repairGedcom can fix", () => {
    expect(get("trlr_missing").fixable).toBe(true);
    expect(get("blank_lines").fixable).toBe(true);
    expect(get("garbled_chars")).toMatchObject({ fixable: true, optIn: true, params: { fixable: "1" } });
    expect(get("death_before_birth").fixable).toBe(false);
    expect(r.repairable).toBe(true);
  });

  it("attaches English titles and messages with filled placeholders", () => {
    expect(get("broken_pointer").title).toBe("Broken links: 1");
    for (const it of r.issues) {
      expect(it.title).not.toMatch(/\{\w+\}/);
      expect(it.message).not.toMatch(/\{\w+\}/);
    }
  });

  it("lists the damaged name in accentSamples", () => {
    expect(r.accentSamples.map((s) => s.text)).toContain("Els /MÃ¼ller/");
  });
});

describe("more findings", () => {
  const file = (body: string, tail = "0 TRLR\r\n") => header("UTF-8") + body + tail;

  it("finds people who are their own ancestor", () => {
    const r = checkGedcom(
      file(
        "0 @I1@ INDI\r\n1 NAME A /Loop/\r\n1 FAMC @F1@\r\n1 FAMS @F2@\r\n" +
          "0 @I2@ INDI\r\n1 NAME B /Loop/\r\n1 FAMC @F2@\r\n1 FAMS @F1@\r\n" +
          "0 @F1@ FAM\r\n1 HUSB @I2@\r\n1 CHIL @I1@\r\n0 @F2@ FAM\r\n1 HUSB @I1@\r\n1 CHIL @I2@\r\n",
      ),
    );
    const it = r.issues.find((i) => i.code === "own_ancestor");
    expect(it?.count).toBe(2);
  });

  it("finds a parent younger than 12, a birth after the mother died, and people older than 120", () => {
    const r = checkGedcom(
      file(
        "0 @I1@ INDI\r\n1 NAME Mother /Test/\r\n1 BIRT\r\n2 DATE 1900\r\n1 DEAT\r\n2 DATE 5 MAY 1930\r\n1 FAMS @F1@\r\n" +
          "0 @I2@ INDI\r\n1 NAME Child /Test/\r\n1 BIRT\r\n2 DATE 1 JUN 1931\r\n1 FAMC @F1@\r\n" +
          "0 @I3@ INDI\r\n1 NAME Father /Test/\r\n1 BIRT\r\n2 DATE 1925\r\n1 DEAT\r\n2 DATE 2050\r\n1 FAMS @F1@\r\n" +
          "0 @I4@ INDI\r\n1 NAME Old /Test/\r\n1 BIRT\r\n2 DATE 1700\r\n1 DEAT\r\n2 DATE 1850\r\n" +
          "0 @F1@ FAM\r\n1 HUSB @I3@\r\n1 WIFE @I1@\r\n1 CHIL @I2@\r\n",
      ),
    );
    expect(codes(r)).toEqual(expect.arrayContaining(["born_after_mother_death", "parent_too_young", "too_old"]));
  });

  it("finds missing HEAD, missing version and text after TRLR", () => {
    const r = checkGedcom("0 @I1@ INDI\r\n1 NAME A /B/\r\n0 TRLR\r\nextra\r\n");
    expect(codes(r)).toEqual(expect.arrayContaining(["head_missing", "after_trlr"]));
    const r2 = checkGedcom("0 HEAD\r\n1 CHAR UTF-8\r\n0 TRLR\r\n");
    expect(codes(r2)).toContain("version_missing");
  });

  it("finds CONC in a 7.0 file and lines that are not GEDCOM", () => {
    const r = checkGedcom("0 HEAD\r\n1 GEDC\r\n2 VERS 7.0\r\n0 @N1@ SNOTE abc\r\n1 CONC def\r\nnot a gedcom line\r\n0 TRLR\r\n");
    expect(codes(r)).toEqual(expect.arrayContaining(["conc_in_v7", "bad_line"]));
  });

  it("reports character set findings from bytes", () => {
    const ansel = checkGedcom(bytes(header("ANSEL"), "0 @I1@ INDI\r\n1 NAME M", 0xe8, "uller /Test/\r\n0 TRLR\r\n"));
    expect(codes(ansel)).toContain("encoding_ansel");
    expect(ansel.encoding).toMatchObject({ declared: "ANSEL", used: "ANSEL" });

    const mislabeled = checkGedcom(new TextEncoder().encode(header("ANSEL") + "0 @I1@ INDI\r\n1 NAME Renée /Test/\r\n0 TRLR\r\n"));
    const it = mislabeled.issues.find((i) => i.code === "encoding_mislabeled")!;
    expect(it.message).toContain("The file says ANSEL, but the text is really UTF-8");

    const noChar = checkGedcom(bytes(header(null), "0 @I1@ INDI\r\n1 NAME Ren", 0xe9, "e /Test/\r\n0 TRLR\r\n"));
    expect(codes(noChar)).toContain("encoding_no_char");
    expect(codes(noChar)).toContain("encoding_ansi");

    const ibm = checkGedcom(bytes(header("IBMPC"), "0 @I1@ INDI\r\n1 NAME Ren", 0x82, "e /Test/\r\n0 TRLR\r\n"));
    expect(codes(ibm)).toContain("encoding_uncertain");
    expect(ibm.accentGuess).toBe(true);
  });
});

describe("repairGedcom", () => {
  it("repairs the form and leaves content alone", () => {
    const res = repairGedcom(fixture("problems.ged"));
    const changed = res.changes.map((c) => c.code);
    expect(changed).toEqual(expect.arrayContaining(["blank_removed", "trlr_added", "line_endings"]));
    expect(res.text.startsWith("﻿0 HEAD\r\n")).toBe(true);
    expect(res.text.endsWith("0 TRLR\r\n")).toBe(true);
    expect(res.text).toContain("2 DATE 2 FEB 1890");
    expect(res.text).toContain("Els /MÃ¼ller/");
    const again = checkGedcom(res.text);
    expect(codes(again)).not.toContain("trlr_missing");
    expect(codes(again)).not.toContain("blank_lines");
  });

  it("repairs garbled characters only when asked", () => {
    const res = repairGedcom(fixture("problems.ged"), { fixGarbled: true });
    expect(res.text).toContain("1 NAME Els /Müller/");
    expect(res.changes.find((c) => c.code === "garbled_fixed")?.count).toBe(1);
  });

  it("converts ANSEL to UTF-8 and fixes the CHAR line", () => {
    const res = repairGedcom(bytes(header("ANSEL"), "0 @I1@ INDI\r\n1 NAME M", 0xe8, "uller /Test/\r\n0 TRLR\r\n"));
    expect(res.text).toContain("1 CHAR UTF-8");
    expect(res.text).toContain("1 NAME Müller /Test/");
    expect(res.changes.map((c) => c.code)).toEqual(expect.arrayContaining(["converted_utf8", "char_set_utf8"]));
  });

  it("accepts an already decoded file", () => {
    const d = decodeGedcom(fixture("clean-551.ged"));
    expect(repairGedcom(d).text).toContain("1 NAME Hendrik /Peeters/");
  });
});

describe("parseDateRange", () => {
  it("reads common forms", () => {
    expect(parseDateRange("12 MAR 1850")).toEqual({ min: 18500312, max: 18500312 });
    expect(parseDateRange("ABT 1850")).toBe("approx");
    expect(parseDateRange("(unknown)")).toBe("phrase");
    expect(parseDateRange("BET 1850 AND 1855")).toEqual({ min: 18500101, max: 18551231 });
    expect(parseDateRange("31.12.1850")).toBeNull();
  });
});

it("every issue code has an English message", () => {
  for (const [code, m] of Object.entries(ISSUE_MESSAGES)) {
    expect(m.title, code).toBeTruthy();
    expect(m.message, code).toBeTruthy();
  }
});
