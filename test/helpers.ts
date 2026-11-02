import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "..");

export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(here, "fixtures", name)));
}

/** Builds bytes from ASCII strings and single byte values. */
export function bytes(...parts: (string | number | number[])[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === "number") out.push(p);
    else if (Array.isArray(p)) out.push(...p);
    else for (let i = 0; i < p.length; i++) out.push(p.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}

/** Lines of an output file without BOM and without the final empty line. */
export function lines(text: string): string[] {
  return text.replace(/^﻿/, "").split(/\r\n|\n/).filter((l) => l !== "");
}

/** A minimal 5.5.1 header with the given CHAR value (or none). */
export function header(char: string | null): string {
  return `0 HEAD\r\n1 GEDC\r\n2 VERS 5.5.1\r\n2 FORM LINEAGE-LINKED\r\n${char ? `1 CHAR ${char}\r\n` : ""}`;
}
