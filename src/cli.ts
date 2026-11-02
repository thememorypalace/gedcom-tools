#!/usr/bin/env node
/**
 * Small command line wrapper around the library. The only file that uses fs.
 *
 *   gedcom-tools convert in.ged out.ged [--to 7.0|5.5.1] [--no-bom] [--lf]
 *   gedcom-tools check file.ged [--json]
 *   gedcom-tools repair in.ged out.ged [--fix-garbled]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { checkGedcom, convertGedcom, decodeGedcom, repairGedcom } from "./index.js";
import type { ConvertTarget } from "./index.js";

declare const __VERSION__: string;

const USAGE = `gedcom-tools ${typeof __VERSION__ === "string" ? __VERSION__ : ""}

Usage:
  gedcom-tools convert <in.ged> <out.ged> [--to 7.0|5.5.1] [--no-bom] [--lf]
      Convert between GEDCOM 5.5.1 and 7.0. Without --to, a 7.0 file goes to
      5.5.1 and anything else goes to 7.0. Output is always UTF-8.
  gedcom-tools check <file.ged> [--json]
      Check a file and list the findings. Exit code 1 when there are errors.
  gedcom-tools repair <in.ged> <out.ged> [--fix-garbled]
      Write a copy with a repaired form (UTF-8, header, line endings).
  gedcom-tools --help | --version
`;

function fail(msg: string): never {
  process.stderr.write(`gedcom-tools: ${msg}\n\n${USAGE}`);
  process.exit(2);
}

function readBytes(path: string): Uint8Array {
  try {
    return new Uint8Array(readFileSync(path));
  } catch (e) {
    fail(`cannot read ${path}: ${(e as Error).message}`);
  }
}

function main(argv: string[]): number {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const pos: string[] = [];
  let to: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--to") {
      to = argv[++i];
      continue;
    }
    if (a.startsWith("--to=")) {
      to = a.slice(5);
      continue;
    }
    if (!a.startsWith("--")) pos.push(a);
  }
  if (flags.has("--version")) {
    process.stdout.write(`${typeof __VERSION__ === "string" ? __VERSION__ : "unknown"}\n`);
    return 0;
  }
  const [cmd, a, b] = pos;
  if (!cmd || flags.has("--help")) {
    process.stdout.write(USAGE);
    return cmd || flags.has("--help") ? 0 : 2;
  }

  if (cmd === "convert") {
    if (!a || !b) fail("convert needs an input and an output file");
    if (to !== undefined && to !== "7.0" && to !== "5.5.1") fail(`--to must be 7.0 or 5.5.1, not ${to}`);
    const res = convertGedcom(decodeGedcom(readBytes(a)), {
      target: to as ConvertTarget | undefined,
      bom: !flags.has("--no-bom"),
      lineEnding: flags.has("--lf") ? "\n" : "\r\n",
    });
    writeFileSync(b, res.text, "utf8");
    const r = res.report;
    process.stdout.write(`Converted GEDCOM ${r.fromVersion ?? "(no version)"} to ${r.to} (read as ${r.encoding}): ${r.linesIn} lines in, ${r.linesOut} lines out.\n`);
    for (const c of r.changeList) process.stdout.write(`  changed: ${c.message}\n`);
    for (const w of r.warnings) {
      process.stdout.write(`  warning: ${w.title} (${w.count})\n`);
      for (const ex of w.examples) process.stdout.write(`    ${ex.line ? `line ${ex.line}: ` : ""}${ex.text}\n`);
    }
    return 0;
  }

  if (cmd === "check") {
    if (!a) fail("check needs a file");
    const res = checkGedcom(readBytes(a));
    if (flags.has("--json")) {
      process.stdout.write(JSON.stringify(res, null, 2) + "\n");
      return res.errors > 0 ? 1 : 0;
    }
    process.stdout.write(
      `${a}: GEDCOM ${res.version ?? "(no version)"}, read as ${res.encoding.used}, ${res.people} people, ${res.families} families, ${res.lines} lines.\n`,
    );
    if (!res.issues.length) process.stdout.write("No findings.\n");
    for (const it of res.issues) {
      process.stdout.write(`\n[${it.severity}] ${it.code}: ${it.title}\n  ${it.message}\n`);
      for (const ex of it.examples.slice(0, 5)) {
        const who = ex.who ? ` @${ex.who.id}@${ex.who.name ? ` ${ex.who.name}` : ""}` : "";
        process.stdout.write(`    ${ex.line ? `line ${ex.line}` : "file"}${who}${ex.text ? `: ${ex.text}` : ""}\n`);
      }
      if (it.examples.length > 5) process.stdout.write(`    and ${it.count - 5} more\n`);
    }
    process.stdout.write(`\n${res.errors} errors, ${res.warnings} warnings.${res.repairable ? " Run gedcom-tools repair to fix the form of the file." : ""}\n`);
    return res.errors > 0 ? 1 : 0;
  }

  if (cmd === "repair") {
    if (!a || !b) fail("repair needs an input and an output file");
    const res = repairGedcom(readBytes(a), { fixGarbled: flags.has("--fix-garbled") });
    writeFileSync(b, res.text, "utf8");
    if (!res.changes.length) process.stdout.write("Nothing to repair in the form of this file.\n");
    for (const c of res.changes) process.stdout.write(`  ${c.code}: ${c.count}\n`);
    return 0;
  }

  fail(`unknown command ${cmd}`);
}

process.exitCode = main(process.argv.slice(2));
