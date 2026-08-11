import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import {
  applyToolSearchCatalog,
  createToolSearchCatalogRef,
  createToolSearchTools,
  resolveToolSearchConfig,
  TOOL_CALL_RAW_TOOL_NAME,
  TOOL_DESCRIBE_RAW_TOOL_NAME,
  TOOL_SEARCH_CODE_MODE_TOOL_NAME,
  TOOL_SEARCH_RAW_TOOL_NAME,
} from "../src/agents/tool-search.js";
import type { AnyAgentTool } from "../src/agents/tools/common.js";

function requireProof(condition: unknown, code: string): asserts condition {
  if (!condition) {
    throw new Error(`electron tool-search proof failed: ${code}`);
  }
}

function reportStage(stage: string): void {
  process.stdout.write(`[electron tool-search proof] stage=${stage}\n`);
}

function readDetails(result: { details?: unknown }): Record<string, unknown> {
  requireProof(result.details && typeof result.details === "object", "result-details");
  return result.details as Record<string, unknown>;
}

async function main(): Promise<void> {
  reportStage("main-start");
  const targetSha = process.env.OPENCLAW_PROOF_HEAD_SHA;
  const artifactDir = process.env.OPENCLAW_PROOF_ARTIFACT_DIR;
  requireProof(targetSha?.match(/^[0-9a-f]{40}$/u), "exact-target-sha");
  requireProof(artifactDir, "artifact-directory");
  requireProof(typeof process.versions.electron === "string", "actual-electron-runtime");
  requireProof(process.type === "browser", "electron-browser-process");
  requireProof(process.defaultApp === true, "electron-default-app");

  const config = { tools: { toolSearch: { enabled: true } } } as never;
  const resolved = resolveToolSearchConfig(config);
  requireProof(resolved.mode === "tools", "electron-fallback-mode");
  reportStage("fallback-resolved");

  const catalogRef = createToolSearchCatalogRef();
  let targetCalls = 0;
  const targetTool: AnyAgentTool = {
    name: "proof_echo",
    label: "Proof Echo",
    description: "Return an exact structured Tool Search proof marker",
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
    execute: async (_toolCallId, input) => {
      targetCalls += 1;
      return {
        content: [{ type: "text", text: "structured-call-complete" }],
        details: { input, marker: "STRUCTURED_CALL_COMPLETE" },
      };
    },
  };
  const controls = createToolSearchTools({ config, catalogRef });
  reportStage("controls-created");
  const compacted = applyToolSearchCatalog({
    tools: [...controls, targetTool],
    config,
    catalogRef,
  });
  reportStage("catalog-applied");
  const visibleNames = compacted.tools.map((tool) => tool.name).toSorted();
  requireProof(!visibleNames.includes(TOOL_SEARCH_CODE_MODE_TOOL_NAME), "code-control-hidden");
  for (const controlName of [
    TOOL_SEARCH_RAW_TOOL_NAME,
    TOOL_DESCRIBE_RAW_TOOL_NAME,
    TOOL_CALL_RAW_TOOL_NAME,
  ]) {
    requireProof(visibleNames.includes(controlName), `structured-control-${controlName}`);
  }

  const searchTool = controls.find((tool) => tool.name === TOOL_SEARCH_RAW_TOOL_NAME);
  const callTool = controls.find((tool) => tool.name === TOOL_CALL_RAW_TOOL_NAME);
  requireProof(searchTool && callTool, "structured-controls-created");
  const searchResult = await searchTool.execute("electron-proof-search", {
    query: "structured proof echo",
    limit: 3,
  });
  reportStage("search-complete");
  const candidates = readDetails(searchResult) as unknown as Array<{
    id?: unknown;
    name?: unknown;
  }>;
  requireProof(Array.isArray(candidates) && candidates.length > 0, "search-candidates");
  const candidate = candidates.find((value) => value.name === targetTool.name);
  requireProof(typeof candidate?.id === "string", "target-candidate");

  const callResult = await callTool.execute("electron-proof-call", {
    id: candidate.id,
    args: { value: "electron-structured-proof" },
  });
  reportStage("call-complete");
  const callDetails = readDetails(callResult);
  const nestedResult = callDetails.result as { details?: { marker?: unknown } } | undefined;
  requireProof(targetCalls === 1, "target-called-once");
  requireProof(nestedResult?.details?.marker === "STRUCTURED_CALL_COMPLETE", "call-result-marker");

  const verdict = {
    schemaVersion: 1,
    verdict: "pass",
    targetSha,
    boundary: [
      "actual-electron-main-process",
      "production-tool-search-config-resolution",
      "production-tool-search-catalog-compaction",
      "production-structured-search-control",
      "production-structured-call-control",
    ],
    runtime: {
      electron: process.versions.electron,
      node: process.versions.node,
      processType: process.type,
      defaultApp: process.defaultApp,
      execPathSha256: createHash("sha256").update(process.execPath).digest("hex"),
    },
    assertions: {
      actualElectronRuntime: true,
      actualElectronBrowserProcess: true,
      defaultCodeRequestFellBackToTools: true,
      codeControlHidden: true,
      structuredSearchVisible: true,
      structuredDescribeVisible: true,
      structuredCallVisible: true,
      structuredSearchReturnedAuthorizedTarget: true,
      structuredCallExecutedAuthorizedTargetOnce: true,
      structuredCallResultObserved: true,
    },
    observations: {
      resolvedMode: resolved.mode,
      visibleControls: visibleNames,
      catalogToolCount: compacted.catalogToolCount,
      targetCalls,
    },
    redaction: {
      credentialsIncluded: false,
      filesystemPathsIncluded: false,
      toolPayloadIncluded: false,
    },
  };
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, "proof-electron-tool-search.json"),
    `${JSON.stringify(verdict, null, 2)}\n`,
  );
  process.stdout.write(
    `[electron tool-search proof] electron=${process.versions.electron} node=${process.versions.node} mode=${resolved.mode} search=true call=true code-control=false\n`,
  );
}

reportStage("runtime-start");
try {
  await main();
  app.exit(0);
} catch (error) {
  console.error(error);
  app.exit(1);
}
