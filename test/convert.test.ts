import { describe, expect, it } from "vitest";
import {
  ageTo7,
  convertGedcom,
  convertTo551,
  convertTo7,
  dateTo7,
  defaultTarget,
  filePathTo551,
  filePathTo7,
  isDate7,
} from "../src/index";
import { bytes, fixture, header, lines } from "./helpers";

const family = () => convertTo7(fixture("family-551.ged"));

/** Lines of `text` contain `block` (lines separated by \n) as consecutive lines. */
function hasBlock(text: string, block: string): boolean {
  return ("\n" + lines(text).join("\n") + "\n").includes("\n" + block + "\n");
}

describe("convertTo7 on a typical 5.5.1 file", () => {
  it("writes a 7.0 header without CHAR, FORM or FILE", () => {
    const { text } = family();
    expect(text.startsWith("\ufeff0 HEAD\r\n1 GEDC\r\n2 VERS 7.0\r\n")).toBe(true);
    expect(text.endsWith("0 TRLR\r\n")).toBe(true);
    expect(text).not.toMatch(/^1 CHAR/m);
    expect(text).not.toMatch(/^2 FORM LINEAGE-LINKED/m);
    expect(text).not.toMatch(/^1 FILE family-551\.ged/m);
    expect(hasBlock(text, "1 LANG en")).toBe(true);
  });

  it("produces only well-formed 7.0 lines", () => {
    const { text } = family();
    for (const l of lines(text)) expect(l).toMatch(/^(0|[1-9]\d*) (?:@[A-Z0-9_]+@ )?[A-Z0-9_]+(?: .*)?$/);
    expect(text).not.toMatch(/^\d+ CONC/m);
  });

  it("renames invalid IDs and updates every pointer", () => {
    const { text, report } = family();
    expect(text).toContain("0 @I_1@ INDI");
    expect(text).toContain("1 HUSB @I_1@");
    expect(text).toContain("1 ASSO @I_1@");
    expect(text).not.toContain("@I-1@");
    expect(report.changes.xref_renamed).toBe(1);
  });

  it("converts calendars and dual years, keeping the original as PHRASE", () => {
    const { text } = family();
    expect(hasBlock(text, "2 DATE JULIAN 12 MAR 1649\n3 PHRASE @@#DJULIAN@ 12 MAR 1648/9")).toBe(true);
  });

  it("moves interpreted date text to PHRASE", () => {
    expect(hasBlock(family().text, "2 DATE 1652\n3 PHRASE around the time of the great flood")).toBe(true);
  });

  it("joins CONC and turns NOTE records into SNOTE", () => {
    const { text } = family();
    expect(text).toContain("0 @N1@ SNOTE Pieter was a baker. His shop stood near the market square and he was known for rye bread.\r\n1 CONT Second line of the note.");
    expect(text).toContain("1 SNOTE @N1@");
  });

  it("turns inline media into an OBJE record with a URL and a media type", () => {
    const { text } = family();
    expect(text).toMatch(/^1 OBJE @O\d+@$/m);
    expect(hasBlock(text, "1 FILE file:///C:/Photos/pieter.jpg\n2 FORM image/jpeg\n2 TITL Portrait of Pieter")).toBe(true);
  });

  it("turns written-out sources into SOUR records", () => {
    const { text } = family();
    const id = text.match(/^1 SOUR @(S\d+)@$/m)?.[1];
    expect(id).toBeTruthy();
    expect(hasBlock(text, `0 @${id}@ SOUR\n1 TITL Parish register of Leuven, 1649`)).toBe(true);
  });

  it("converts RIN and AFN to EXID", () => {
    const { text } = family();
    expect(hasBlock(text, "1 EXID 101\n2 TYPE https://gedcom.io/terms/v7/RIN#ExampleSoft")).toBe(true);
    expect(hasBlock(text, "1 EXID ABCD-123\n2 TYPE https://gedcom.io/terms/v7/AFN")).toBe(true);
  });

  it("converts RELA to ROLE, age words, enumerations and @ escaping", () => {
    const { text } = family();
    expect(hasBlock(text, "2 ROLE GODP\n3 PHRASE Godfather")).toBe(true);
    expect(hasBlock(text, "2 AGE < 1y\n3 PHRASE Infant")).toBe(true);
    expect(text).toContain("2 PEDI BIRTH");
    expect(text).toContain("1 EMAIL submitter@example.org");
  });

  it("reports what changed and what could not be kept", () => {
    const { report } = family();
    expect(report.fromVersion).toBe("5.5.1");
    expect(report.to).toBe("7.0");
    expect(report.records).toMatchObject({ INDI: 3, FAM: 1, SOUR: 1, OBJE: 1, NOTE: 1, SUBM: 1 });
    expect(report.changes).toMatchObject({ conc_joined: 1, dates_dual: 1, dates_calendar: 1, exid: 2, media_records: 1, source_records: 1 });
    const codes = report.warnings.map((w) => w.code);
    expect(codes).toContain("subn_removed");
    expect(codes).toContain("head_file_removed");
    for (const w of report.warnings) expect(w.message.length).toBeGreaterThan(10);
    expect(report.changeList.find((c) => c.code === "conc_joined")?.message).toBe("1 CONC lines joined");
  });
});

describe("options and inputs", () => {
  it("accepts a string as input", () => {
    const text = new TextDecoder().decode(fixture("family-551.ged"));
    expect(convertTo7(text).text).toBe(family().text);
  });

  it("can write without BOM and with LF line endings", () => {
    const { text } = convertTo7(fixture("family-551.ged"), { bom: false, lineEnding: "\n" });
    expect(text.startsWith("0 HEAD\n")).toBe(true);
    expect(text).not.toContain("\r");
  });

  it("chooses the obvious direction when no target is given", () => {
    const seven = family().text;
    expect(defaultTarget(seven)).toBe("5.5.1");
    expect(convertGedcom(seven).report.to).toBe("5.5.1");
    expect(convertGedcom(fixture("family-551.ged")).report.to).toBe("7.0");
  });

  it("converts ANSEL input to UTF-8 output", () => {
    const res = convertTo7(bytes(header("ANSEL"), "0 @I1@ INDI\r\n1 NAME M", 0xe8, "uller /Fran", 0xf0, "cois/\r\n0 TRLR\r\n"));
    expect(res.report.encoding).toBe("ANSEL");
    expect(res.report.changes.encoding).toBe(1);
    expect(res.text).toContain("1 NAME M\u00fcller /Fran\u00e7ois/");
  });
});

describe("convertTo551", () => {
  it("round-trips the 5.5.1 fixture through 7.0", () => {
    const back = convertTo551(family().text).text;
    expect(back).toContain("2 VERS 5.5.1\r\n2 FORM LINEAGE-LINKED\r\n1 CHAR UTF-8");
    expect(back).toContain("2 DATE @#DJULIAN@ 12 MAR 1648/9");
    expect(back).toContain("2 DATE INT 1652 (around the time of the great flood)");
    expect(back).toContain("2 RELA Godfather");
    expect(back).toContain("2 AGE INFANT");
    expect(back).toContain("2 PEDI birth");
    expect(back).toContain("1 RIN 101");
    expect(back).toContain("1 AFN ABCD-123");
    expect(back).toContain("1 FILE C:\\Photos\\pieter.jpg\r\n2 FORM jpg");
    expect(back).toContain("1 EMAIL submitter@@example.org");
    expect(back).toContain("0 @N1@ NOTE Pieter was a baker.");
  });

  it("splits long lines with CONC, never next to a space", () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const seven = `0 HEAD\r\n1 GEDC\r\n2 VERS 7.0\r\n0 @N1@ SNOTE ${words}\r\n0 TRLR\r\n`;
    const res = convertTo551(seven);
    const out = lines(res.text);
    for (const l of out) expect(l.length).toBeLessThanOrEqual(255);
    const concs = out.filter((l) => l.startsWith("1 CONC "));
    expect(concs.length).toBeGreaterThan(0);
    expect(res.report.changes.long_lines_split).toBeGreaterThan(0);
    const joined = out.filter((l) => /^(0 @N1@ NOTE |1 CONC )/.test(l)).map((l) => l.replace(/^0 @N1@ NOTE |^1 CONC /, "")).join("");
    expect(joined).toBe(words);
  });

  it("adds a submitter, which 5.5.1 requires", () => {
    const res = convertTo551("0 HEAD\r\n1 GEDC\r\n2 VERS 7.0\r\n0 @I1@ INDI\r\n1 SEX X\r\n0 TRLR\r\n");
    expect(res.text).toContain("1 SUBM @SUBM1@");
    expect(res.text).toContain("0 @SUBM1@ SUBM");
    expect(res.text).toContain("1 SEX U");
    expect(res.report.warnings.map((w) => w.code)).toContain("sex_lost");
  });
});

describe("helpers", () => {
  it("dateTo7", () => {
    expect(dateTo7("12 MAR 1850")).toEqual({ value: "12 MAR 1850", phrase: null });
    expect(dateTo7("abt 1850")).toEqual({ value: "ABT 1850", phrase: null });
    expect(dateTo7("about 1850").value).toBe("ABT 1850");
    expect(dateTo7("12 March 1850").value).toBe("12 MAR 1850");
    expect(dateTo7("(unknown, before the war)")).toEqual({ value: "", phrase: "unknown, before the war" });
    expect(dateTo7("BET 1860 AND 1850").value).toBe("BET 1850 AND 1860");
    expect(dateTo7("44 B.C.").value).toBe("44 BCE");
    expect(dateTo7("@#DFRENCH R@ 1 VEND 0002").value).toBe("FRENCH_R 1 VEND 0002");
    expect(dateTo7("31.12.1850")).toEqual({ value: "", phrase: "31.12.1850" });
  });

  it("isDate7", () => {
    expect(isDate7("BET JULIAN 1700 AND 1710")).toBe(true);
    expect(isDate7("12 MAR 1850")).toBe(true);
    expect(isDate7("1850/51")).toBe(false);
  });

  it("ageTo7", () => {
    expect(ageTo7("CHILD")).toEqual({ value: "< 8y", phrase: "Child", ok: true });
    expect(ageTo7("<10y 3m")).toEqual({ value: "< 10y 3m", phrase: null, ok: true });
    expect(ageTo7("42").value).toBe("42y");
    expect(ageTo7("about forty").ok).toBe(false);
  });

  it("file paths to URLs and back", () => {
    expect(filePathTo7("C:\\My Photos\\a b.jpg")).toBe("file:///C:/My%20Photos/a%20b.jpg");
    expect(filePathTo7("/home/user/scan.png")).toBe("file:///home/user/scan.png");
    expect(filePathTo7("photos/scan 1.png")).toBe("photos/scan%201.png");
    expect(filePathTo7("https://example.org/x.jpg")).toBe("https://example.org/x.jpg");
    expect(filePathTo551("file:///C:/My%20Photos/a%20b.jpg")).toBe("C:\\My Photos\\a b.jpg");
  });
});
