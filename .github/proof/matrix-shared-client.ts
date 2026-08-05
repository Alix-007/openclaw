import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const targetRoot = process.cwd();
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-matrix-proof-"));
process.env.HOME = path.join(runtimeRoot, "home");
process.env.OPENCLAW_STATE_DIR = path.join(runtimeRoot, "state");
await fs.mkdir(process.env.HOME, { recursive: true });
await fs.mkdir(process.env.OPENCLAW_STATE_DIR, { recursive: true });

const shared = await import(
  pathToFileURL(path.join(targetRoot, "extensions/matrix/src/matrix/client/shared.ts")).href
);

const common = {
  accountId: "proof",
  accessToken: "proof-token-not-a-real-secret", // pragma: allowlist secret
  encryption: false,
  allowPrivateNetwork: true,
};
const firstAuth = {
  ...common,
  homeserver: "http://127.0.0.1:18789/base|@alice",
  userId: "@bob:example.org",
};
const secondAuth = {
  ...common,
  homeserver: "http://127.0.0.1:18789/base",
  userId: "@alice|@bob:example.org",
};

try {
  const firstLease = await shared.acquireSharedMatrixClient({
    auth: firstAuth,
    startClient: false,
  });
  const repeatedFirstLease = await shared.acquireSharedMatrixClient({
    auth: firstAuth,
    startClient: false,
  });
  const secondLease = await shared.acquireSharedMatrixClient({
    auth: secondAuth,
    startClient: false,
  });

  assert.equal(firstLease, repeatedFirstLease);
  assert.notEqual(firstLease, secondLease);
  const firstHeld = await shared.releaseSharedClientInstance(firstLease, "discard");
  const firstFinal = await shared.releaseSharedClientInstance(repeatedFirstLease, "discard");
  const secondFinal = await shared.releaseSharedClientInstance(secondLease, "discard");
  assert.equal(firstHeld, false);
  assert.equal(firstFinal, true);
  assert.equal(secondFinal, true);

  console.log(
    "[matrix shared-client proof] real-client=true distinct=true same-auth-reused=true first-release-held=true first-release-final=true second-release-final=true secret-output=false",
  );
} finally {
  shared.stopSharedClient();
  await fs.rm(runtimeRoot, { recursive: true, force: true });
}
