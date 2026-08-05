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
