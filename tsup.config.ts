import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    target: "es2020",
    platform: "neutral",
    sourcemap: false,
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    target: "node18",
    platform: "node",
    define: { __VERSION__: JSON.stringify(version) },
    external: ["./index.js"],
    sourcemap: false,
  },
]);
