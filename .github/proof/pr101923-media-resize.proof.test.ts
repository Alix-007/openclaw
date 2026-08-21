import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MsgContext } from "../auto-reply/templating.js";
import type { OpenClawConfig } from "../config/types.js";
import type { ModelDefinitionConfig } from "../config/types.models.js";
import type { MediaAttachmentCache } from "./attachments.js";
import type { ImageDescriptionRequest, MediaUnderstandingProvider } from "./types.js";

type Observation = {
  lane: "configured" | "fallback-primary" | "fallback-secondary";
  provider: string;
  model: string;
  fileName: string;
  mime: string;
  width: number;
  height: number;
  pixels: number;
  bytes: number;
  sha256: string;
  maxBytes: number;
  maxSidePx: number;
};

const proofState = vi.hoisted(() => ({
  providers: new Map<string, MediaUnderstandingProvider>(),
}));

vi.mock("./provider-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./provider-registry.js")>();
  return {
    ...actual,
    buildMediaUnderstandingRegistry: () => proofState.providers,
  };
});

const { resolveImageCompressionModelPolicy } =
  await import("../agents/image-compression-policy.js");
const { runWithImageModelFallback } = await import("../agents/model-fallback-image.js");
const { describePreparedImageWithModel, prepareImageDescriptionInput } =
  await import("./runtime.js");
const { runProviderEntry } = await import("./runner.entries.js");
const { readImageMetadataFromHeader } = await import("../media/media-services.js");

const PROVIDER_ID = "proof-vision";
const PRIMARY_MODEL = "camera-primary";
const SECONDARY_MODEL = "camera-secondary";
const INPUT_WIDTH = 4536;
const INPUT_HEIGHT = 8064;
const INPUT_PIXELS = INPUT_WIDTH * INPUT_HEIGHT;
const DEFAULT_PROVIDER_MAX_BYTES = 10 * 1024 * 1024;

const MODEL_POLICY = {
  [PRIMARY_MODEL]: { maxBytes: 2_000_000, maxSidePx: 2576, preferredSidePx: 2576 },
  [SECONDARY_MODEL]: { maxBytes: 1_000_000, maxSidePx: 1568, preferredSidePx: 1568 },
} as const;

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function createConfig(): OpenClawConfig {
  const model = (id: keyof typeof MODEL_POLICY): ModelDefinitionConfig => ({
    id,
    name: id,
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_000,
    maxTokens: 1024,
    mediaInput: { image: MODEL_POLICY[id] },
  });
  return {
    agents: {
      defaults: {
        imageModel: {
          primary: `${PROVIDER_ID}/${PRIMARY_MODEL}`,
          fallbacks: [`${PROVIDER_ID}/${SECONDARY_MODEL}`],
        },
      },
    },
    models: {
      providers: {
        [PROVIDER_ID]: {
          api: "openai-responses",
          baseUrl: "http://127.0.0.1:9/v1",
          models: [model(PRIMARY_MODEL), model(SECONDARY_MODEL)],
        },
      },
    },
  };
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

describe("PR 101923 exact-head media-understanding resize proof", () => {
  it("resizes a real 4536x8064 JPEG before configured and CLI fallback provider hooks", async () => {
    const productSha = requireEnv("OPENCLAW_PROOF_PRODUCT_SHA");
    const harnessSha = requireEnv("OPENCLAW_PROOF_HARNESS_SHA");
    const fixturePath = requireEnv("OPENCLAW_PROOF_FIXTURE_PATH");
    const verdictPath = requireEnv("OPENCLAW_PROOF_VERDICT_PATH");
    expect(productSha).toMatch(/^[0-9a-f]{40}$/);
    expect(harnessSha).toMatch(/^[0-9a-f]{40}$/);

    const source = await readFile(fixturePath);
    const sourceMetadata = readImageMetadataFromHeader(source);
    expect(sourceMetadata).toEqual({ width: INPUT_WIDTH, height: INPUT_HEIGHT });
    expect(INPUT_PIXELS).toBe(36_578_304);
    expect(INPUT_PIXELS).toBeGreaterThan(25_000_000);
    expect(INPUT_PIXELS).toBeLessThanOrEqual(40_000_000);
    const sourceSha256 = sha256(source);
    const cfg = createConfig();
    const observations: Observation[] = [];
    let lane: Observation["lane"] = "configured";

    for (const model of [PRIMARY_MODEL, SECONDARY_MODEL] as const) {
      await expect(
        resolveImageCompressionModelPolicy({
          cfg,
          provider: PROVIDER_ID,
          model,
          agentDir: path.dirname(fixturePath),
        }),
      ).resolves.toMatchObject(MODEL_POLICY[model]);
    }

    const describeImage = async (request: ImageDescriptionRequest) => {
      const policy = MODEL_POLICY[request.model as keyof typeof MODEL_POLICY];
      expect(policy).toBeDefined();
      const metadata = readImageMetadataFromHeader(request.buffer);
      expect(metadata).not.toBeNull();
      if (!metadata || !policy) {
        throw new Error("provider hook received undecodable bytes or an unknown model");
      }
      const pixels = metadata.width * metadata.height;
      expect(Math.max(metadata.width, metadata.height)).toBeLessThanOrEqual(policy.maxSidePx);
      expect(request.buffer.length).toBeLessThanOrEqual(policy.maxBytes);
      expect(request.buffer.length).toBeLessThanOrEqual(DEFAULT_PROVIDER_MAX_BYTES);
      expect(request.buffer.length).toBeGreaterThan(0);
      expect(request.mime).toBe("image/jpeg");
      expect(request.fileName).toBe("camera.jpg");
      expect(request.buffer.equals(source)).toBe(false);
      expect(sha256(request.buffer)).not.toBe(sourceSha256);
      observations.push({
        lane,
        provider: request.provider,
        model: request.model,
        fileName: request.fileName,
        mime: request.mime ?? "",
        width: metadata.width,
        height: metadata.height,
        pixels,
        bytes: request.buffer.length,
        sha256: sha256(request.buffer),
        maxBytes: policy.maxBytes,
        maxSidePx: policy.maxSidePx,
      });
      if (lane === "fallback-primary") {
        throw Object.assign(new Error("fixture primary provider rate limit"), { status: 429 });
      }
      return { text: `${lane} described`, model: request.model };
    };

    const provider: MediaUnderstandingProvider = {
      id: PROVIDER_ID,
      capabilities: ["image"],
      describeImage,
    };
    proofState.providers = new Map([[PROVIDER_ID, provider]]);

    const cache = {
      getBuffer: vi.fn(async (params: { maxBytes: number }) => {
        expect(params.maxBytes).toBe(DEFAULT_PROVIDER_MAX_BYTES);
        return {
          buffer: source,
          fileName: "camera.jpg",
          mime: "image/jpeg",
          size: source.length,
        };
      }),
    } as unknown as MediaAttachmentCache;
    await expect(
      runProviderEntry({
        capability: "image",
        entry: { provider: PROVIDER_ID, model: PRIMARY_MODEL },
        cfg,
        ctx: {} as MsgContext,
        attachmentIndex: 0,
        cache,
        agentDir: path.dirname(fixturePath),
        providerRegistry: new Map([[PROVIDER_ID, provider]]),
      }),
    ).resolves.toMatchObject({
      kind: "image.description",
      provider: PROVIDER_ID,
      model: PRIMARY_MODEL,
      text: "configured described",
    });

    const prepared = await prepareImageDescriptionInput({
      filePath: fixturePath,
      mime: "image/jpeg",
      cfg,
    });
    expect(prepared.buffer.equals(source)).toBe(true);
    expect(prepared.fileName).toBe("camera.jpg");
    expect(prepared.mime).toBe("image/jpeg");

    const fallback = await runWithImageModelFallback({
      cfg,
      run: async (providerId, model) => {
        lane = model === PRIMARY_MODEL ? "fallback-primary" : "fallback-secondary";
        return await describePreparedImageWithModel({
          image: prepared,
          cfg,
          agentDir: path.dirname(fixturePath),
          provider: providerId,
          model,
          prompt: "Describe the camera image.",
        });
      },
    });
    expect(fallback.outcome).toBe("completed");
    expect(fallback.provider).toBe(PROVIDER_ID);
    expect(fallback.model).toBe(SECONDARY_MODEL);
    expect(fallback.result).toMatchObject({
      text: "fallback-secondary described",
      model: SECONDARY_MODEL,
    });
    expect(fallback.attempts).toHaveLength(1);
    expect(fallback.attempts[0]).toMatchObject({ provider: PROVIDER_ID, model: PRIMARY_MODEL });

    expect(observations.map((entry) => entry.lane)).toEqual([
      "configured",
      "fallback-primary",
      "fallback-secondary",
    ]);
    expect(observations[0]?.model).toBe(PRIMARY_MODEL);
    expect(observations[1]?.model).toBe(PRIMARY_MODEL);
    expect(observations[2]?.model).toBe(SECONDARY_MODEL);
    expect(observations[0]?.sha256).toBe(observations[1]?.sha256);
    expect(observations[2]?.sha256).not.toBe(observations[1]?.sha256);

    const verdict = {
      schemaVersion: 1,
      result: "pass",
      target: {
        repository: "Alix-007/openclaw",
        productSha,
        harnessSha,
      },
      fixture: {
        format: "jpeg",
        mime: "image/jpeg",
        width: INPUT_WIDTH,
        height: INPUT_HEIGHT,
        pixels: INPUT_PIXELS,
        bytes: source.length,
        sha256: sourceSha256,
      },
      contracts: {
        sourceReadMaxBytes: DEFAULT_PROVIDER_MAX_BYTES,
        providerMaxBytes: DEFAULT_PROVIDER_MAX_BYTES,
        rastermillDefaultInputPixels: 25_000_000,
        resizeOwnerInputPixels: 40_000_000,
        resizeOwnerOutputPixels: 25_000_000,
        policies: MODEL_POLICY,
      },
      configured: {
        productionEntry: "runProviderEntry",
        result: "described",
      },
      explicitFallback: {
        productionPreparation: "prepareImageDescriptionInput",
        productionAttemptOwner: "describePreparedImageWithModel",
        productionCoordinator: "runWithImageModelFallback",
        failedModel: PRIMARY_MODEL,
        selectedModel: SECONDARY_MODEL,
        attemptCount: 2,
      },
      observations,
    };
    await mkdir(path.dirname(verdictPath), { recursive: true });
    await writeFile(verdictPath, `${JSON.stringify(verdict, null, 2)}\n`, "utf8");
    process.stdout.write(
      `[pr101923 media resize proof] product=${productSha} input=${INPUT_WIDTH}x${INPUT_HEIGHT} configured=${observations[0]?.width}x${observations[0]?.height} fallback-primary=${observations[1]?.width}x${observations[1]?.height} fallback-secondary=${observations[2]?.width}x${observations[2]?.height} hooks=${observations.length} result=pass\n`,
    );
  });
});
