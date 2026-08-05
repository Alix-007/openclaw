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

const runtime = await import(
  pathToFileURL(path.join(targetRoot, "extensions/matrix/src/runtime.ts")).href
);
const syncStores = new Map<string, Map<string, unknown>>();
const logger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
runtime.setMatrixRuntime({
  logging: {
    shouldLogVerbose: () => false,
    getChildLogger: () => logger,
  },
  state: {
    resolveStateDir: () => process.env.OPENCLAW_STATE_DIR,
    openSyncKeyedStore: ({ namespace }: { namespace: string }) => {
      const values = syncStores.get(namespace) ?? new Map<string, unknown>();
      syncStores.set(namespace, values);
      return {
        register: (key: string, value: unknown) => values.set(key, value),
        registerIfAbsent: (key: string, value: unknown) => {
          if (values.has(key)) {
            return false;
          }
          values.set(key, value);
          return true;
        },
        lookup: (key: string) => values.get(key),
        consume: (key: string) => {
          const value = values.get(key);
          values.delete(key);
          return value;
        },
        delete: (key: string) => values.delete(key),
        entries: () => [...values].map(([key, value]) => ({ key, value, createdAt: Date.now() })),
        clear: () => values.clear(),
      };
    },
  },
});

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

  assert.equal(firstLease.client, repeatedFirstLease.client);
  assert.notEqual(firstLease.client, secondLease.client);

  await firstLease.release({ mode: "discard" });
  const firstStillHeld = await shared.acquireSharedMatrixClient({
    auth: firstAuth,
    startClient: false,
  });
  assert.equal(firstStillHeld.client, repeatedFirstLease.client);
  await firstStillHeld.release({ mode: "discard" });
  await repeatedFirstLease.release({ mode: "discard" });

  const firstReplacement = await shared.acquireSharedMatrixClient({
    auth: firstAuth,
    startClient: false,
  });
  assert.notEqual(firstReplacement.client, repeatedFirstLease.client);
  await firstReplacement.release({ mode: "discard" });

  await secondLease.release({ mode: "discard" });
  const secondReplacement = await shared.acquireSharedMatrixClient({
    auth: secondAuth,
    startClient: false,
  });
  assert.notEqual(secondReplacement.client, secondLease.client);
  await secondReplacement.release({ mode: "discard" });

  console.log(
    "[matrix shared-client proof] real-client=true distinct=true same-auth-reused=true first-release-held=true first-release-final=true second-release-final=true secret-output=false",
  );
} finally {
  await Promise.allSettled([
    shared.stopSharedClientForAccount(firstAuth),
    shared.stopSharedClientForAccount(secondAuth),
  ]);
  await fs.rm(runtimeRoot, { recursive: true, force: true });
}
