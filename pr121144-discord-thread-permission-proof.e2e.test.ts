import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChannelType, PermissionFlagsBits, Routes } from "discord-api-types/v10";
import { expect, it } from "vitest";
import { RequestClient } from "../../../../extensions/discord/src/internal/discord.js";
import { sendMessageDiscord } from "../../../../extensions/discord/src/send.js";
import { startQaGatewayChild } from "../../../../extensions/qa-lab/src/gateway-child.js";
import { startQaProviderServer } from "../../../../extensions/qa-lab/src/providers/server-runtime.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const expectedHead = process.env.PR121144_EXPECTED_HEAD;
const proofDir = process.env.PR121144_PROOF_DIR;

type TraceEvent = {
  at: string;
  boundary: string;
  event: string;
  details?: Record<string, unknown>;
};

function normalizeSyntheticRoute(route: string): string {
  return route
    .replaceAll("thread1", "<thread>")
    .replaceAll("parent1", "<parent>")
    .replaceAll("guild1", "<guild>")
    .replaceAll("bot1", "<bot>");
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections();
  });
}

async function startSyntheticDiscordRest(trace: TraceEvent[]): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  observedRoutes: string[];
}> {
  const observedRoutes: string[] = [];
  const threadPermissions =
    PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessagesInThreads;
  const responses = new Map<string, { body: unknown; status: number }>([
    [
      `GET /v10${Routes.channel("thread1")}`,
      {
        status: 200,
        body: {
          id: "thread1",
          guild_id: "guild1",
          parent_id: "parent1",
          type: ChannelType.GuildPublicThread,
        },
      },
    ],
    [
      `POST /v10${Routes.channelMessages("thread1")}`,
      { status: 403, body: { code: 50013, message: "Missing Permissions" } },
    ],
    [
      `GET /v10${Routes.channel("parent1")}`,
      {
        status: 200,
        body: {
          id: "parent1",
          guild_id: "guild1",
          type: ChannelType.GuildText,
          permission_overwrites: [
            {
              id: "guild1",
              deny: PermissionFlagsBits.ViewChannel.toString(),
              allow: "0",
            },
          ],
        },
      },
    ],
    [`GET /v10${Routes.user("@me")}`, { status: 200, body: { id: "bot1" } }],
    [
      `GET /v10${Routes.guild("guild1")}`,
      {
        status: 200,
        body: {
          id: "guild1",
          roles: [{ id: "guild1", permissions: threadPermissions.toString() }],
        },
      },
    ],
    [`GET /v10${Routes.guildMember("guild1", "bot1")}`, { status: 200, body: { roles: [] } }],
  ]);
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const requestKey = `${request.method ?? "UNKNOWN"} ${request.url ?? ""}`;
    observedRoutes.push(normalizeSyntheticRoute(requestKey));
    const result = responses.get(requestKey) ?? {
      status: 404,
      body: { code: 10003, message: "Unknown Channel" },
    };
    trace.push({
      at: new Date().toISOString(),
      boundary: "synthetic-discord-rest",
      event: "request",
      details: {
        method: request.method ?? null,
        route: normalizeSyntheticRoute(request.url ?? ""),
        status: result.status,
        ...(result.status === 403 ? { discordCode: 50013 } : {}),
      },
    });
    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(JSON.stringify(result.body));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("synthetic Discord REST server did not bind to loopback");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    observedRoutes,
    close: async () => await closeServer(server),
  };
}

async function writeProofArtifact(fileName: string, value: unknown): Promise<void> {
  if (!proofDir) {
    throw new Error("PR121144_PROOF_DIR is required");
  }
  await fs.mkdir(proofDir, { recursive: true });
  const output = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(path.join(proofDir, fileName), output, "utf8");
}

it(
  "proves Discord parent-overwrite diagnostics through production REST and an ephemeral Gateway",
  { timeout: 180_000 },
  async () => {
    const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    if (!expectedHead || headSha !== expectedHead) {
      throw new Error(`expected exact head ${expectedHead ?? "<missing>"}, got ${headSha}`);
    }

    const trace: TraceEvent[] = [
      {
        at: new Date().toISOString(),
        boundary: "proof",
        event: "start",
        details: { headSha },
      },
    ];
    const provider = await startQaProviderServer("mock-openai");
    if (!provider) {
      throw new Error("mock OpenAI provider did not start");
    }
    let gateway: Awaited<ReturnType<typeof startQaGatewayChild>> | undefined;
    let discord: Awaited<ReturnType<typeof startSyntheticDiscordRest>> | undefined;
    let proofFailure: Error | undefined;
    let observation: Record<string, unknown> | undefined;

    try {
      gateway = await startQaGatewayChild({
        repoRoot,
        useRepoCli: true,
        providerBaseUrl: `${provider.baseUrl}/v1`,
        providerMode: "mock-openai",
        transportBaseUrl: "http://127.0.0.1",
        controlUiEnabled: false,
      });
      const health = await gateway.call("health", {});
      const gatewayHealthRpc = Boolean(
        health && typeof health === "object" && !Array.isArray(health),
      );
      trace.push({
        at: new Date().toISOString(),
        boundary: "ephemeral-gateway",
        event: "authenticated-health-rpc",
        details: { pass: gatewayHealthRpc, providerMode: "mock-openai" },
      });

      discord = await startSyntheticDiscordRest(trace);
      const rest = new RequestClient("synthetic-proof-token", {
        baseUrl: discord.baseUrl,
        queueRequests: false,
        timeout: 5_000,
      });
      let sendError: unknown;
      try {
        await sendMessageDiscord("channel:thread1", "synthetic proof message", {
          rest,
          token: "synthetic-proof-token",
          cfg: { channels: { discord: { token: "synthetic-proof-token" } } },
        });
      } catch (error) {
        sendError = error;
      }
      const errorRecord =
        sendError && typeof sendError === "object"
          ? (sendError as Record<string, unknown>)
          : ({} as Record<string, unknown>);
      const missingPermissions = Array.isArray(errorRecord.missingPermissions)
        ? errorRecord.missingPermissions.filter(
            (permission): permission is string => typeof permission === "string",
          )
        : [];
      const diagnostic = String(sendError);
      const requiredRouteFragments = [
        "POST /v10/channels/<thread>/messages",
        "GET /v10/channels/<thread>",
        "GET /v10/channels/<parent>",
        "GET /v10/users/%40me",
        "GET /v10/guilds/<guild>",
        "GET /v10/guilds/<guild>/members/<bot>",
      ];
      const requiredProductionRoutesObserved = requiredRouteFragments.every((fragment) =>
        discord?.observedRoutes.includes(fragment),
      );
      const staleSendMessagesClaim =
        missingPermissions.includes("SendMessages") ||
        diagnostic.includes("ViewChannel/SendMessages/");
      observation = {
        headSha,
        generatedAt: new Date().toISOString(),
        gatewayHealthRpc,
        providerMode: "mock-openai",
        sendResult: "HTTP 403 / Discord code 50013",
        diagnosticChannelId: errorRecord.channelId ?? null,
        discordCode: errorRecord.discordCode ?? null,
        status: errorRecord.status ?? null,
        missingPermissions,
        staleSendMessagesClaim,
        requiredProductionRoutesObserved,
        observedRoutes: discord.observedRoutes,
      };
      trace.push({
        at: new Date().toISOString(),
        boundary: "discord-diagnostic",
        event: "production-send-error",
        details: {
          channelId: errorRecord.channelId ?? null,
          discordCode: errorRecord.discordCode ?? null,
          status: errorRecord.status ?? null,
          missingPermissions,
          staleSendMessagesClaim,
          requiredProductionRoutesObserved,
        },
      });

      const pass =
        gatewayHealthRpc &&
        errorRecord.channelId === "thread1" &&
        errorRecord.discordCode === 50013 &&
        errorRecord.status === 403 &&
        missingPermissions.length === 1 &&
        missingPermissions[0] === "ViewChannel" &&
        !staleSendMessagesClaim &&
        requiredProductionRoutesObserved;
      const verdict = {
        schemaVersion: 1,
        pr: 121144,
        headSha,
        generatedAt: new Date().toISOString(),
        proofKind: "synthetic-discord-rest+mock-provider+ephemeral-gateway",
        exactHeadVerified: true,
        credentialMode: "none",
        boundaries: {
          gateway: "real ephemeral loopback Gateway with authenticated health RPC",
          provider: "repository mock-openai provider",
          channel: "production sendMessageDiscord and RequestClient against synthetic Discord REST",
          diagnostic: "production 50013 wrapper and parent-channel permission resolution",
        },
        scenario: {
          targetType: "public-thread",
          sendResult: "HTTP 403 / Discord code 50013",
          permissionOwner: "parent-channel-overwrite",
          parentDenied: ["ViewChannel"],
          threadGrantRetained: ["SendMessagesInThreads"],
          operatorDiagnosticChannelId: errorRecord.channelId ?? null,
          missingPermissions,
          staleSendMessagesClaim,
          requiredProductionRoutesObserved,
          gatewayHealthRpc,
        },
        redaction:
          "No credentials, real Discord IDs, message contents, local ports, or local runtime paths recorded.",
        pass,
      };
      await writeProofArtifact("observation.json", observation);
      await writeProofArtifact(
        "trace.jsonl",
        `${trace.map((event) => JSON.stringify(event)).join("\n")}\n`,
      );
      await writeProofArtifact("verdict.json", verdict);
      console.log(`[pr121144-proof] ${JSON.stringify(verdict)}`);

      expect(pass).toBe(true);
    } catch (error) {
      proofFailure = error instanceof Error ? error : new Error(String(error));
      if (observation) {
        await writeProofArtifact("observation.json", observation);
      }
    }

    const cleanup = await Promise.allSettled([discord?.close(), gateway?.stop(), provider.stop()]);
    const cleanupFailures = cleanup.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (proofFailure && cleanupFailures.length > 0) {
      throw new AggregateError(
        [proofFailure, ...cleanupFailures],
        "Discord production-boundary proof and cleanup failed",
      );
    }
    if (proofFailure) {
      throw proofFailure;
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(cleanupFailures, "Discord production-boundary cleanup failed");
    }
  },
);
