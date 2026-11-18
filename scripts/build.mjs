// Builds dist/hypeblock-chrome.zip and dist/hypeblock-firefox.zip. No dependencies; needs the `zip` CLI.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const files = ["src", "popup", "icons"];
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

rmSync(dist, { recursive: true, force: true });

for (const target of ["chrome", "firefox"]) {
  const out = join(dist, target);
  mkdirSync(out, { recursive: true });
  for (const f of files) cpSync(join(root, f), join(out, f), { recursive: true });
  const m = structuredClone(manifest);
  if (target === "chrome") {
    delete m.browser_specific_settings; // Chrome warns on unknown keys
    delete m.background.scripts;
  } else {
    delete m.background.service_worker; // Firefox uses an event page
  }
  writeFileSync(join(out, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
  execFileSync("zip", ["-qr", join(dist, `hypeblock-${target}.zip`), "."], { cwd: out });
  console.log(`dist/hypeblock-${target}.zip`);
}
