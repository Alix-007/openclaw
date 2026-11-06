import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = path.resolve(process.argv[2]);
const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
assert.equal(pkg.name, "openclaw");
assert.equal(pkg.version, "2026.11.1");
const profileModule = "dist/user-profiles-8MUD1kjG.mjs";
const preferenceModule = "dist/user-preferences-CGgtRmWh.mjs";
const { n: ensureProfileForEmail } = await import(pathToFileURL(path.join(packageRoot, profileModule)));
const { r: write, t: read } = await import(pathToFileURL(path.join(packageRoot, preferenceModule)));
assert.equal(ensureProfileForEmail.name, "ensureProfileForEmail");
assert.equal(write.name, "setCanonicalUserPreferences");
assert.equal(read.name, "getCanonicalUserPreferences");
const profile = ensureProfileForEmail("operator@example.test");
const other = ensureProfileForEmail("other-operator@example.test");
const entries = {
  "ui.theme": "claw",
  "ui.themeMode": "light",
  "ui.railShortcuts": ["route:usage"],
  "proof.existingPreference": { enabled: true, marker: "created-by-published-stable-2026.11.1" },
};
const otherEntries = { "ui.theme": "claw", "proof.otherProfile": "untouched" };
assert.equal((await write(profile.id, entries)).ok, true);
assert.equal((await write(other.id, otherEntries)).ok, true);
assert.deepEqual((await read(profile.id)).entries, entries);
assert.deepEqual((await read(other.id)).entries, otherEntries);
console.log(JSON.stringify({ version: pkg.version, profileModule, preferenceModule, profileId: profile.id, otherProfileId: other.id, entries, otherEntries }));
// The isolated released writer exits only after its durable writes and independent reads settle.
process.exit(0);
