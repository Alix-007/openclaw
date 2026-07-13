// Msteams SSO tests provide real loopback-server proof that the User Token
// service response body is bounded at 16 MiB via readResponseWithLimit.
//
// Mutation contract: reverting the readResponseWithLimit call in sso.ts back to
// bare `response.json()` causes the over-cap test to turn red — the bare read
// would receive the 16 MiB+ body and either hang until OOM or parse garbage,
// but it would NOT surface the "msteams.sso" label in the error message.
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeMSTeamsSsoTokenStoreKey,
  type MSTeamsSsoStoredToken,
  type MSTeamsSsoTokenStore,
} from "./sso-token-store.js";
import { resolveMSTeamsRequestTimeoutMs } from "./request-timeout.js";
import { type MSTeamsSsoFetch, handleSigninTokenExchangeInvoke } from "./sso.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FakeServer = {
  url: string;
  close: () => Promise<void>;
};

type ObservedPromiseState =
  | { type: "pending" }
  | { type: "fulfilled" }
  | { type: "rejected"; reason: unknown };

function createMemorySsoTokenStore(): MSTeamsSsoTokenStore {
  const tokens = new Map<string, MSTeamsSsoStoredToken>();
  return {
    async get({ connectionName, userId }) {
      return tokens.get(makeMSTeamsSsoTokenStoreKey(connectionName, userId)) ?? null;
    },
    async save(token) {
      tokens.set(makeMSTeamsSsoTokenStoreKey(token.connectionName, token.userId), { ...token });
    },
    async remove({ connectionName, userId }) {
      return tokens.delete(makeMSTeamsSsoTokenStoreKey(connectionName, userId));
    },
  };
}

/**
 * Starts a loopback HTTP server on a random port and returns its base URL.
 * The caller is responsible for closing it after each test.
 */
function startFakeServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<FakeServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

function observePromiseState<T>(promise: Promise<T>): () => Promise<ObservedPromiseState> {
  let state: ObservedPromiseState = { type: "pending" };
  void promise.then(
    () => {
      state = { type: "fulfilled" };
    },
    (reason: unknown) => {
      state = { type: "rejected", reason };
    },
  );
  return async () => {
    await Promise.resolve();
    await Promise.resolve();
    return state;
  };
}

function installFakeAbortSignalTimeout(options?: { autoAbort?: boolean }) {
  const controllers: AbortController[] = [];
  const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((timeoutMs: number) => {
    const controller = new AbortController();
    controllers.push(controller);
    if (options?.autoAbort ?? true) {
      setTimeout(() => {
        controller.abort(new DOMException("The operation timed out", "TimeoutError"));
      }, timeoutMs);
    }
    return controller.signal;
  });
  return { controllers, spy };
}

function createNeverResolvingFetch() {
  return vi.fn<MSTeamsSsoFetch>((_url, init) => {
    const signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      if (!signal) {
        return;
      }
      const rejectWithAbortReason = () => {
        reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
      };
      if (signal.aborted) {
        rejectWithAbortReason();
        return;
      }
      signal.addEventListener("abort", rejectWithAbortReason, { once: true });
    });
  });
}

function createSsoDepsForServer(baseUrl: string) {
  const tokenStore = createMemorySsoTokenStore();
  const tokenProvider = {
    getAccessToken: vi.fn(async () => "fake-bearer-token"),
  };
  return {
    deps: {
      tokenProvider,
      tokenStore,
      connectionName: "TestConn",
      fetchImpl: fetch as unknown as MSTeamsSsoFetch,
      userTokenBaseUrl: baseUrl,
    },
    tokenStore,
  };
}

// ---------------------------------------------------------------------------
// request timeout: stalled User Token service calls must abort
// ---------------------------------------------------------------------------

describe("sso callUserTokenService — request timeout", () => {
  it("aborts a stalled User Token service request at the shared Teams timeout", async () => {
    vi.useFakeTimers();
    const { spy: timeoutSpy } = installFakeAbortSignalTimeout();
    try {
      const fetchImpl = createNeverResolvingFetch();
      const tokenStore = createMemorySsoTokenStore();
      const resultPromise = handleSigninTokenExchangeInvoke({
        value: { id: "flow-timeout", connectionName: "TestConn", token: "x" },
        user: { userId: "uid-timeout", channelId: "msteams" },
        deps: {
          tokenProvider: { getAccessToken: vi.fn(async () => "svc") },
          tokenStore,
          connectionName: "TestConn",
          fetchImpl,
          userTokenBaseUrl: "https://botframework.example.test",
        },
      });
      const readState = observePromiseState(resultPromise);
      await Promise.resolve();
      await Promise.resolve();

      const timeoutMs = resolveMSTeamsRequestTimeoutMs();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(timeoutSpy).toHaveBeenCalledWith(timeoutMs);
      expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
      expect(await readState()).toEqual({ type: "pending" });

      await vi.advanceTimersByTimeAsync(timeoutMs - 1);
      expect(await readState()).toEqual({ type: "pending" });

      await vi.advanceTimersByTimeAsync(1);
      const finalState = await readState();
      expect(finalState.type).toBe("rejected");
      if (finalState.type === "rejected") {
        expect(finalState.reason).toBeInstanceOf(DOMException);
        if (finalState.reason instanceof DOMException) {
          expect(finalState.reason.name).toBe("TimeoutError");
        }
      }
    } finally {
      timeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("keeps the timeout signal live while reading a stalled User Token response body", async () => {
    const { controllers, spy: timeoutSpy } = installFakeAbortSignalTimeout({ autoAbort: false });
    let server: FakeServer | undefined;
    let stalledResponse: http.ServerResponse | undefined;
    let markBodyStarted!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      markBodyStarted = resolve;
    });
    let markHeadersReady!: () => void;
    const headersReady = new Promise<void>((resolve) => {
      markHeadersReady = resolve;
    });
    try {
      server = await startFakeServer((_req, res) => {
        stalledResponse = res;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write("{");
        markBodyStarted();
      });
      const tokenStore = createMemorySsoTokenStore();
      const fetchImpl = vi.fn<MSTeamsSsoFetch>(async (url, init) => {
        const response = await fetch(url, init);
        markHeadersReady();
        return response;
      });
      const resultPromise = handleSigninTokenExchangeInvoke({
        value: { id: "flow-body-timeout", connectionName: "TestConn", token: "x" },
        user: { userId: "uid-body-timeout", channelId: "msteams" },
        deps: {
          tokenProvider: { getAccessToken: vi.fn(async () => "svc") },
          tokenStore,
          connectionName: "TestConn",
          fetchImpl,
          userTokenBaseUrl: server.url,
        },
      });
      const readState = observePromiseState(resultPromise);
      await bodyStarted;
      await headersReady;
      await Promise.resolve();
      const timeoutMs = resolveMSTeamsRequestTimeoutMs();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(timeoutSpy).toHaveBeenCalledWith(timeoutMs);
      expect(controllers).toHaveLength(1);
      expect(controllers[0]?.signal.aborted).toBe(false);
      expect(await readState()).toEqual({ type: "pending" });

      controllers[0]?.abort(new DOMException("The operation timed out", "TimeoutError"));

      const result = await resultPromise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(200);
      }
    } finally {
      timeoutSpy.mockRestore();
      stalledResponse?.destroy();
      await server?.close();
    }
  });
});

// ---------------------------------------------------------------------------
// over-cap: >16 MiB body without Content-Length must be rejected
// ---------------------------------------------------------------------------

describe("sso callUserTokenService — response size bound (real loopback server)", () => {
  let server: FakeServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("rejects a User Token service response that exceeds 16 MiB with msteams.sso label", async () => {
    // Server streams >16 MiB of syntactically invalid JSON without Content-Length.
    // readResponseWithLimit must cancel the stream and surface the labelled error.
    //
    // Mutation check: if you replace readResponseWithLimit with bare response.json(),
    // this test turns red — the error message will be "invalid JSON from User Token
    // service" (JSON.parse failure on garbage bytes) with NO "msteams.sso" label.
    server = await startFakeServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      // Emit 17 MiB of repeated 'A' bytes (not valid JSON) without Content-Length.
      const CHUNK = Buffer.alloc(64 * 1024, 0x41); // 64 KiB of 'A'
      const TOTAL_CHUNKS = 272; // 272 × 64 KiB = 17,408 KiB ≈ 17 MiB > 16 MiB
      let sent = 0;
      function writeNext() {
        if (sent >= TOTAL_CHUNKS) {
          res.end();
          return;
        }
        sent++;
        // Use drain/write to avoid blocking the server event loop.
        const ok = res.write(CHUNK);
        if (ok) {
          setImmediate(writeNext);
        } else {
          res.once("drain", writeNext);
        }
      }
      writeNext();
    });

    const { deps } = createSsoDepsForServer(server.url);

    const result = await handleSigninTokenExchangeInvoke({
      value: { id: "flow-1", connectionName: "TestConn", token: "tok-1" },
      user: { userId: "uid-1", channelId: "msteams" },
      deps,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The error must come from our onOverflow handler, which embeds the
      // "msteams.sso" label.  Bare response.json() would not produce this.
      expect(result.message).toContain("msteams.sso");
    }
  });

  // ---------------------------------------------------------------------------
  // under-cap: normal SSO token response must parse successfully
  // ---------------------------------------------------------------------------

  it("parses a valid Bot Framework token response under the size cap (under-cap)", async () => {
    const TOKEN_BODY = JSON.stringify({
      channelId: "msteams",
      connectionName: "TestConn",
      token: "real-delegated-token",
      expiration: "2030-12-31T23:59:59Z",
    });

    server = await startFakeServer((_req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(TOKEN_BODY)),
      });
      res.end(TOKEN_BODY);
    });

    const { deps, tokenStore } = createSsoDepsForServer(server.url);

    const result = await handleSigninTokenExchangeInvoke({
      value: { id: "flow-2", connectionName: "TestConn", token: "tok-2" },
      user: { userId: "uid-2", channelId: "msteams" },
      deps,
    });

    expect(result).toEqual({
      ok: true,
      token: "real-delegated-token",
      expiresAt: "2030-12-31T23:59:59Z",
    });

    const stored = await tokenStore.get({
      connectionName: "TestConn",
      userId: "uid-2",
    });
    expect(stored?.token).toBe("real-delegated-token");
  });
});
