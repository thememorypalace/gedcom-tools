import { describe, expect, it } from "vitest";
import { checkGedcom, decodeGedcom, decodeAnsel, fixMojibakeLine, looksGarbled } from "../src/index";
import { bytes, header } from "./helpers";

const NAME_RECORD = "0 @I1@ INDI\r\n1 NAME ";
const END = "/\r\n0 TRLR\r\n";

describe("decodeGedcom", () => {
  it("reads plain ASCII as ASCII", () => {
    const d = decodeGedcom(bytes(header("ASCII"), NAME_RECORD, "Jan /Peeters", END));
    expect(d.used).toBe("ASCII");
    expect(d.hasHighBytes).toBe(false);
    expect(d.mislabeled).toBe(false);
    expect(d.text).toContain("Jan /Peeters/");
  });

  it("reads UTF-8 and reports the declared character set", () => {
    const utf8 = new TextEncoder().encode(header("UTF-8") + NAME_RECORD + "Renée /Müller" + END);
    const d = decodeGedcom(utf8);
    expect(d.used).toBe("UTF-8");
    expect(d.declared).toBe("UTF-8");
    expect(d.mislabeled).toBe(false);
    expect(d.text).toContain("Renée /Müller/");
    expect(d.lineEndings).toEqual({ crlf: 8, lf: 0, cr: 0 });
  });

  it("strips a UTF-8 byte order mark", () => {
    const d = decodeGedcom(bytes([0xef, 0xbb, 0xbf], header("UTF-8"), NAME_RECORD, "Jan /Peeters", END));
    expect(d.hadBom).toBe(true);
    expect(d.text.startsWith("0 HEAD")).toBe(true);
  });

  it("accepts an ArrayBuffer", () => {
    const b = bytes(header("ASCII"), NAME_RECORD, "Jan /Peeters", END);
    const d = decodeGedcom(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    expect(d.text).toContain("Jan /Peeters/");
  });

  it("decodes ANSEL, with combining marks placed before the letter", () => {
    // ANSEL: 0xE8 = diaeresis, 0xE2 = acute, 0xF0 = cedilla, 0xB2 = o with stroke
    const d = decodeGedcom(
      bytes(header("ANSEL"), NAME_RECORD, "M", 0xe8, "uller /Fran", 0xf0, "cois", "\r\n1 NOTE Jos", 0xe2, "e and S", 0xb2, "ren", END),
    );
    expect(d.used).toBe("ANSEL");
    expect(d.mislabeled).toBe(false);
    expect(d.text).toContain("Müller /François");
    expect(d.text).toContain("José and Søren");
    expect(d.unreadable).toBe(0);
  });

  it("decodeAnsel returns NFC text", () => {
    const s = decodeAnsel(bytes("Caf", 0xe2, "e"));
    expect(s).toBe("Café");
    expect(s.length).toBe(4);
  });

  it("reads Windows-1252 when the header says ANSI", () => {
    const d = decodeGedcom(bytes(header("ANSI"), NAME_RECORD, "Ren", 0xe9, "e /Dubois", END, "0 @N1@ NOTE Price 5 ", 0x80, "\r\n"));
    expect(d.used).toBe("WINDOWS-1252");
    expect(d.mislabeled).toBe(false);
    expect(d.text).toContain("Renée /Dubois/");
    expect(d.text).toContain("Price 5 €");
  });

  it("falls back to Windows-1252 when UTF-8 is declared but the bytes are not UTF-8", () => {
    const d = decodeGedcom(bytes(header("UTF-8"), NAME_RECORD, "Ren", 0xe9, "e /Dubois", END));
    expect(d.used).toBe("WINDOWS-1252");
    expect(d.mislabeled).toBe(true);
    expect(d.text).toContain("Renée");
  });

  it("detects UTF-8 that is labelled as ANSEL", () => {
    const utf8 = new TextEncoder().encode(header("ANSEL") + NAME_RECORD + "Renée /Dubois" + END);
    const d = decodeGedcom(utf8);
    expect(d.used).toBe("UTF-8");
    expect(d.declared).toBe("ANSEL");
    expect(d.mislabeled).toBe(true);
    expect(d.text).toContain("Renée");
  });

  it("reads Windows-1252 when there is no CHAR line", () => {
    const d = decodeGedcom(bytes(header(null), NAME_RECORD, "Ren", 0xe9, "e /Dubois", END));
    expect(d.used).toBe("WINDOWS-1252");
    expect(d.declared).toBeNull();
  });

  it("reads UTF-16 little endian with a byte order mark", () => {
    const text = header("UNICODE") + NAME_RECORD + "Renée /Dubois" + END;
    const buf = new Uint8Array(2 + text.length * 2);
    buf[0] = 0xff;
    buf[1] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      buf[2 + i * 2] = c & 0xff;
      buf[3 + i * 2] = c >> 8;
    }
    const d = decodeGedcom(buf);
    expect(d.used).toBe("UTF-16LE");
    expect(d.text).toContain("Renée /Dubois/");
    expect(d.declared).toBe("UNICODE");
    expect(d.mislabeled).toBe(false);
  });

  it("reads the CHAR line of UTF-16 big endian with a byte order mark", () => {
    const text = header("UNICODE") + NAME_RECORD + "Renée /Dubois" + END;
    const buf = new Uint8Array(2 + text.length * 2);
    buf[0] = 0xfe;
    buf[1] = 0xff;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      buf[2 + i * 2] = c >> 8;
      buf[3 + i * 2] = c & 0xff;
    }
    const d = decodeGedcom(buf);
    expect(d.used).toBe("UTF-16BE");
    expect(d.declared).toBe("UNICODE");
    const r = checkGedcom(buf);
    expect(r.issues.map((i) => i.code)).not.toContain("encoding_no_char");
  });

  it("counts mixed line endings", () => {
    const d = decodeGedcom(bytes("0 HEAD\r\n1 GEDC\n2 VERS 5.5.1\r0 TRLR\r\n"));
    expect(d.lineEndings).toEqual({ crlf: 2, lf: 1, cr: 1 });
  });
});

describe("garbled characters", () => {
  it("repairs double-encoded UTF-8 exactly", () => {
    expect(fixMojibakeLine("1 NAME Els /MÃ¼ller/")).toBe("1 NAME Els /Müller/");
    expect(fixMojibakeLine("1 PLAC LiÃ¨ge")).toBe("1 PLAC Liège");
  });

  it("leaves correct text alone", () => {
    expect(fixMojibakeLine("1 NAME José /Muñoz/")).toBe("1 NAME José /Muñoz/");
  });

  it("looksGarbled accepts real accents and flags damage", () => {
    expect(looksGarbled("Müller")).toBe(false);
    expect(looksGarbled("Größe")).toBe(false);
    expect(looksGarbled("MÃ¼ller")).toBe(true);
    expect(looksGarbled("Ren�e")).toBe(true);
  });
});
