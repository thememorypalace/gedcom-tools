import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { here, root } from "./helpers";

const cli = path.join(root, "dist", "cli.js");
const fx = (n: string) => path.join(here, "fixtures", n);

// The CLI is tested against the build; run `npm run build` first.
describe.skipIf(!existsSync(cli))("cli (dist/cli.js)", () => {
  it("converts a file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gedcom-tools-"));
    try {
      const out = path.join(dir, "out.ged");
      const log = execFileSync(process.execPath, [cli, "convert", fx("family-551.ged"), out], { encoding: "utf8" });
      expect(log).toContain("Converted GEDCOM 5.5.1 to 7.0");
      const text = readFileSync(out, "utf8");
      expect(text.startsWith("\ufeff0 HEAD\r\n1 GEDC\r\n2 VERS 7.0")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("checks a file and exits with 1 when there are errors", () => {
    const bad = spawnSync(process.execPath, [cli, "check", fx("problems.ged")], { encoding: "utf8" });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain("[error] broken_pointer");
    const good = spawnSync(process.execPath, [cli, "check", fx("clean-551.ged"), "--json"], { encoding: "utf8" });
    expect(good.status).toBe(0);
    expect(JSON.parse(good.stdout).people).toBe(3);
  });

  it("prints usage on an unknown command", () => {
    const r = spawnSync(process.execPath, [cli, "frobnicate"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Usage:");
  });
});
