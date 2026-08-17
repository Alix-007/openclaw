import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";
import {
  installMockGateway,
  resolvePlaywrightChromiumExecutablePath,
  startControlUiE2eServer,
} from "../../ui/src/test-helpers/control-ui-e2e.ts";

const artifactDir = path.resolve(".artifacts/pr-125088-hidden-chat-proof");
const videoDir = path.join(artifactDir, "video");
const sessionKey = "agent:main:main";

async function main() {
  await rm(artifactDir, { force: true, recursive: true });
  await mkdir(videoDir, { recursive: true });

  const server = await startControlUiE2eServer(undefined, { source: true });
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    browser = await chromium.launch({
      executablePath: resolvePlaywrightChromiumExecutablePath(chromium.executablePath()),
      headless: true,
    });
    context = await browser.newContext({
      recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
      serviceWorkers: "block",
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    const gateway = await installMockGateway(page, {
      historyMessages: [
        {
          content: [{ text: "prove hidden updates", type: "text" }],
          role: "user",
          timestamp: Date.now(),
        },
      ],
      sessionKey,
    });

    await page.goto(`${server.baseUrl}chat`);
    await page.locator("openclaw-chat-pane").waitFor();
    await page.getByText("prove hidden updates").waitFor();
    await page.screenshot({ path: path.join(artifactDir, "01-visible-seed.png") });
    await page.evaluate("globalThis.__name = (target) => target;");
    const activeSessionKey = await page.evaluate(() => {
      const pane = document.querySelector("openclaw-chat-pane") as
        | (HTMLElement & { state?: { sessionKey?: string | null } })
        | null;
      return pane?.state?.sessionKey ?? "main";
    });

    await page.evaluate(() => {
      const proofWindow = window as typeof window & {
        __openclawVisibility?: DocumentVisibilityState;
        __openclawRenderProof?: { mutations: number; renders: number };
      };
      proofWindow.__openclawVisibility = "visible";
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => proofWindow.__openclawVisibility,
      });
      const pane = document.querySelector("openclaw-chat-pane") as
        | (HTMLElement & { performUpdate: () => void })
        | null;
      if (!pane) {
        throw new Error("chat pane missing");
      }
      const proof = { mutations: 0, renders: 0 };
      proofWindow.__openclawRenderProof = proof;
      const performUpdate = pane.performUpdate.bind(pane);
      pane.performUpdate = () => {
        proof.renders += 1;
        performUpdate();
      };
      new MutationObserver((records) => {
        proof.mutations += records.length;
      }).observe(pane, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      proofWindow.__openclawVisibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      proof.mutations = 0;
      proof.renders = 0;
    });

    await gateway.emitGatewayEvent("chat", {
      deltaText: "Deferred stream",
      runId: "idle-run",
      sessionKey: activeSessionKey,
      state: "delta",
    });
    await gateway.emitGatewayEvent("session.observer", {
      headline: "Hidden observer fact",
      health: "grinding",
      revision: 1,
      runId: "idle-run",
      sessionKey: activeSessionKey,
      updatedAt: Date.now(),
    });
    await gateway.emitChatFinal({
      runId: "idle-run",
      sessionKey: activeSessionKey,
      text: "Deferred final after idle events",
    });
    await gateway.emitGatewayEvent("session.operation", {
      operation: "compact",
      operationId: "idle-compact",
      phase: "start",
      sessionKey: activeSessionKey,
      ts: Date.now(),
    });
    await page.waitForTimeout(350);

    const hidden = await page.evaluate(() => {
      const proofWindow = window as typeof window & {
        __openclawRenderProof?: { mutations: number; renders: number };
      };
      const pane = document.querySelector("openclaw-chat-pane") as
        | (HTMLElement & {
            state?: {
              chatMessages?: unknown[];
              chatRunId?: string | null;
              chatStream?: string | null;
              compactionStatus?: { runId?: string | null } | null;
              observerDigest?: { headline?: string | null } | null;
            };
          })
        | null;
      return {
        canonical: {
          chatMessageCount: pane?.state?.chatMessages?.length ?? null,
          chatRunId: pane?.state?.chatRunId ?? null,
          chatStream: pane?.state?.chatStream ?? null,
          operationRunId: pane?.state?.compactionStatus?.runId ?? null,
          observerHeadline: pane?.state?.observerDigest?.headline ?? null,
        },
        finalVisible:
          document.body.textContent?.includes("Deferred final after idle events") ?? false,
        ...(proofWindow.__openclawRenderProof ?? {}),
        visibility: document.visibilityState,
      };
    });
    const hiddenCanonicalMatches =
      hidden.canonical.chatMessageCount === 2 &&
      hidden.canonical.chatRunId === null &&
      hidden.canonical.chatStream === null &&
      hidden.canonical.operationRunId === "idle-compact" &&
      hidden.canonical.observerHeadline === "Hidden observer fact";
    if (
      !hiddenCanonicalMatches ||
      hidden.renders !== 0 ||
      hidden.mutations !== 0 ||
      hidden.finalVisible
    ) {
      throw new Error(`hidden render contract failed: ${JSON.stringify(hidden)}`);
    }
    await page.screenshot({ path: path.join(artifactDir, "02-hidden-after-idle-events.png") });

    await page.evaluate(() => {
      const proofWindow = window as typeof window & {
        __openclawVisibility?: DocumentVisibilityState;
      };
      proofWindow.__openclawVisibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.locator("p", { hasText: "Deferred final after idle events" }).waitFor();
    await page.getByText("Compacting context...").waitFor();
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(artifactDir, "03-visible-reconcile.png") });

    const visible = await page.evaluate(() => {
      const proofWindow = window as typeof window & {
        __openclawRenderProof?: { mutations: number; renders: number };
      };
      return {
        compactionVisible: document.body.textContent?.includes("Compacting context...") ?? false,
        finalVisible:
          document.body.textContent?.includes("Deferred final after idle events") ?? false,
        ...(proofWindow.__openclawRenderProof ?? {}),
        visibility: document.visibilityState,
      };
    });
    if (!visible.finalVisible || !visible.compactionVisible || visible.renders < 1) {
      throw new Error(`visible reconciliation failed: ${JSON.stringify(visible)}`);
    }

    const verdict = {
      exactPrHead: "7e4575aca5b26d2e4bf4725efe43ab8e9a9e4716",
      hidden,
      visible,
    };
    await writeFile(
      path.join(artifactDir, "verdict.json"),
      `${JSON.stringify(verdict, null, 2)}\n`,
      "utf8",
    );
    console.log(JSON.stringify(verdict));
  } finally {
    await context?.close();
    await browser?.close();
    await server.close();
  }
}

void main();
