import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type JsonRpcResponse = {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
    tools?: Array<{ name?: string }>;
  };
  error?: { message?: string };
};

const targetSha = process.env.OPENCLAW_PROOF_HEAD_SHA?.trim() ?? "";
const artifactDir = path.resolve(process.env.OPENCLAW_PROOF_ARTIFACT_DIR?.trim() || ".");
const proofRoot = await mkdtemp(path.join(os.tmpdir(), "openclaw-terminal-mcp-proof-"));
const stateDir = path.join(proofRoot, "state");
const workspaceDir = path.join(proofRoot, "workspace");
const configPath = path.join(stateDir, "openclaw.json");

await mkdir(workspaceDir, { recursive: true });
await mkdir(stateDir, { recursive: true });
await mkdir(artifactDir, { recursive: true });
await writeFile(
  configPath,
  JSON.stringify({
    agents: { defaults: { workspace: workspaceDir } },
    gateway: { terminal: { enabled: true, shell: "/bin/sh" } },
    tools: { allow: ["terminal"] },
  }),
  "utf8",
);

process.env.HOME = proofRoot;
process.env.OPENCLAW_CONFIG_PATH = configPath;
process.env.OPENCLAW_STATE_DIR = stateDir;
process.env.OPENCLAW_SKIP_CHANNELS = "1";
process.env.OPENCLAW_SKIP_PROVIDERS = "1";
process.env.OPENCLAW_TEST_MINIMAL_GATEWAY = "1";

const [
  { TerminalSessionManager },
  { spawnTerminalPty },
  { setFallbackGatewayContext },
  { ensureMcpLoopbackServer, closeMcpLoopbackServer },
  { getActiveMcpLoopbackRuntime },
  {
    activateMcpLoopbackClientGrantCapture,
    mintMcpLoopbackClientGrant,
    revokeMcpLoopbackClientGrant,
  },
  { beginMcpLoopbackToolCallCapture, clearMcpLoopbackToolCallCapture },
  { createTaskRecord, markTaskTerminalById },
  { getTaskRegistryObservers },
  { startGatewayEventSubscriptions },
  {
    createChatRunState,
    createSessionEventSubscriberRegistry,
    createSessionMessageSubscriberRegistry,
    createToolEventRecipientRegistry,
  },
] = await Promise.all([
  import("../src/gateway/terminal/session-manager.js"),
  import("../src/process/terminal-pty.js"),
  import("../src/gateway/server-plugin-fallback-context.js"),
  import("../src/gateway/mcp-http.js"),
  import("../src/gateway/mcp-http.loopback-runtime.js"),
  import("../src/gateway/mcp-grant-store.js"),
  import("../src/gateway/mcp-http.loopback-runtime.js"),
  import("../src/tasks/task-registry.js"),
  import("../src/tasks/task-registry.store.js"),
  import("../src/gateway/server-runtime-subscriptions.js"),
  import("../src/gateway/server-chat-state.js"),
]);

const spawnedPids: number[] = [];
const emittedEvents: string[] = [];
const manager = new TerminalSessionManager({
  emit: (_connId, event) => emittedEvents.push(event),
  spawn: async (params) => {
    const pty = await spawnTerminalPty(params);
    spawnedPids.push(pty.pid);
    return pty;
  },
});

const noop = () => {};
const logger = {
  subsystem: "proof/gateway-terminal-mcp",
  isEnabled: () => false,
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  raw: noop,
  child: () => logger,
};

const subscriptions = startGatewayEventSubscriptions({
  log: logger,
  broadcast: noop,
  broadcastToConnIds: noop,
  nodeSendToSession: noop,
  agentRunSeq: new Map(),
  chatRunState: createChatRunState(),
  toolEventRecipients: createToolEventRecipientRegistry(),
  sessionEventSubscribers: createSessionEventSubscriberRegistry(),
  sessionMessageSubscribers: createSessionMessageSubscriberRegistry(),
  chatAbortControllers: new Map(),
  restartRecoveryCandidates: new Map(),
  terminalSessions: manager,
});

const waitUntil = async (predicate: () => boolean | Promise<boolean>, label: string) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${label}`);
};

await waitUntil(() => Boolean(getTaskRegistryObservers()?.onEvent), "task observer registration");

const clearFallback = setFallbackGatewayContext({
  terminalSessions: manager,
  isTerminalEnabled: () => true,
  resolveTerminalLaunchPolicy: () => ({
    ok: true,
    plan: { agentId: "main", cwd: workspaceDir, shell: "/bin/sh", args: [] },
  }),
} as never);

const childSessionKey = "agent:main:proof-shared-child";
const makeTask = (runId: string, task: string) =>
  createTaskRecord({
    runtime: "cli",
    requesterSessionKey: childSessionKey,
    ownerKey: childSessionKey,
    scopeKind: "session",
    childSessionKey,
    agentId: "main",
    requesterAgentId: "main",
    runId,
    task,
    status: "running",
    deliveryStatus: "not_applicable",
    notifyPolicy: "silent",
    startedAt: Date.now(),
  });

const task1 = makeTask("proof-run-1", "terminal proof sibling one");
const task2 = makeTask("proof-run-2", "terminal proof sibling two");
if (!task1 || !task2 || task1.taskId === task2.taskId) {
  throw new Error("failed to create distinct production task records");
}

const server = await ensureMcpLoopbackServer(0);
const runtime = getActiveMcpLoopbackRuntime();
if (!runtime || runtime.port !== server.port) {
  throw new Error("MCP loopback runtime was not registered");
}

const captures = new Map<string, Array<{ toolName: string; outcome: string }>>();
const grants = [
  { runId: "proof-run-1", captureKey: "proof-capture-1" },
  { runId: "proof-run-2", captureKey: "proof-capture-2" },
].map(({ runId, captureKey }) => {
  const outcomes: Array<{ toolName: string; outcome: string }> = [];
  captures.set(captureKey, outcomes);
  beginMcpLoopbackToolCallCapture({
    captureKey,
    onToolCallResult: (call) => outcomes.push({ toolName: call.toolName, outcome: call.outcome }),
  });
  const grant = mintMcpLoopbackClientGrant({
    runtimeOwnerToken: runtime.ownerToken,
    context: {
      sessionKey: childSessionKey,
      runtimePolicySessionKey: childSessionKey,
      agentId: "main",
      runId,
      workspaceDir,
      cwd: workspaceDir,
      toolsAllow: ["terminal"],
      senderIsOwner: true,
    },
  });
  if (
    !activateMcpLoopbackClientGrantCapture({
      token: grant.token,
      runtimeOwnerToken: runtime.ownerToken,
      captureKey,
    })
  ) {
    throw new Error(`failed to activate ${captureKey}`);
  }
  return { ...grant, captureKey, runId };
});

let nextRequestId = 1;
const rpc = async (
  grant: (typeof grants)[number],
  method: string,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> => {
  const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${grant.token}`,
      "content-type": "application/json",
      "x-openclaw-cli-capture-key": grant.captureKey,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextRequestId++, method, params }),
  });
  if (response.status !== 200) {
    throw new Error(`MCP ${method} returned HTTP ${response.status}`);
  }
  return (await response.json()) as JsonRpcResponse;
};

const terminalCall = async (
  grant: (typeof grants)[number],
  args: Record<string, unknown>,
  options: { allowError?: boolean } = {},
) => {
  const payload = await rpc(grant, "tools/call", { name: "terminal", arguments: args });
  if (payload.error) {
    throw new Error(payload.error.message ?? "MCP JSON-RPC error");
  }
  const text = payload.result?.content?.find((entry) => entry.type === "text")?.text ?? "";
  if (payload.result?.isError && !options.allowError) {
    throw new Error(`terminal MCP error: ${text}`);
  }
  if (payload.result?.isError) {
    return { error: text, value: undefined };
  }
  return { error: undefined, value: JSON.parse(text) as Record<string, unknown> };
};

const listed = await rpc(grants[0], "tools/list");
const toolNames = listed.result?.tools?.map((tool) => tool.name).filter(Boolean) ?? [];
if (toolNames.length !== 1 || toolNames[0] !== "terminal") {
  throw new Error(`unexpected exact grant tool list: ${JSON.stringify(toolNames)}`);
}

const opened1 = await terminalCall(grants[0], {
  action: "open",
  command: "printf 'PROOF_ONE_READY\\n'",
  show: false,
});
const opened2 = await terminalCall(grants[1], {
  action: "open",
  command: "printf 'PROOF_TWO_READY\\n'",
  show: false,
});
const session1 = String(opened1.value?.sessionId ?? "");
const session2 = String(opened2.value?.sessionId ?? "");
if (!session1 || !session2 || session1 === session2 || manager.size !== 2) {
  throw new Error("real terminal sessions did not open distinctly");
}
if (spawnedPids.length !== 2 || spawnedPids.some((pid) => !Number.isInteger(pid) || pid <= 0)) {
  throw new Error("real node-pty processes were not observed");
}

const readText = async (grant: (typeof grants)[number], sessionId: string) => {
  const result = await terminalCall(grant, { action: "read", sessionId });
  return String(result.value?.text ?? "");
};
await waitUntil(
  async () => (await readText(grants[0], session1)).includes("PROOF_ONE_READY"),
  "first real PTY output",
);
await waitUntil(
  async () => (await readText(grants[1], session2)).includes("PROOF_TWO_READY"),
  "second real PTY output",
);

const terminalized = markTaskTerminalById({
  taskId: task2.taskId,
  status: "succeeded",
  endedAt: Date.now(),
  terminalSummary: "proof task complete",
});
if (!terminalized) {
  throw new Error("production task terminal transition failed");
}
await waitUntil(() => manager.size === 1, "task-scoped terminal cleanup");

const closedSibling = await terminalCall(
  grants[1],
  { action: "read", sessionId: session2 },
  { allowError: true },
);
if (!closedSibling.error?.includes("not owned")) {
  throw new Error(`terminalized task remained reachable: ${closedSibling.error ?? "no error"}`);
}

const writeAlive = await terminalCall(grants[0], {
  action: "input",
  sessionId: session1,
  data: "printf 'PROOF_ONE_ALIVE\\n'\r",
});
if (writeAlive.value?.ok !== true) {
  throw new Error("sibling terminal was no longer writable");
}
await waitUntil(
  async () => (await readText(grants[0], session1)).includes("PROOF_ONE_ALIVE"),
  "sibling PTY output after task cleanup",
);

const remaining = manager.listAgent(childSessionKey);
if (remaining.length !== 1 || remaining[0]?.sessionId !== session1) {
  throw new Error("task cleanup closed the wrong shared-session terminal");
}

const verdict = {
  schemaVersion: 1,
  verdict: "pass",
  targetSha,
  boundary: [
    "real-loopback-http-/mcp",
    "bound-runId-grant",
    "production-gateway-tool-resolver",
    "production-terminal-tool",
    "real-node-pty",
    "production-task-registry-observer-cleanup",
  ],
  assertions: {
    exactGrantPublishedOnlyTerminal: true,
    distinctTasksSharedChildSession: true,
    distinctRealPtyProcesses: true,
    completedTaskTerminalClosed: true,
    siblingTerminalRemainedWritable: true,
    siblingOutputObservedAfterCleanup: true,
  },
  observations: {
    httpStatus: 200,
    taskCount: 2,
    ptyProcessCount: spawnedPids.length,
    sessionCountBeforeCleanup: 2,
    sessionCountAfterCleanup: remaining.length,
    capturedTerminalCalls: [...captures.values()].flat().length,
    emittedTerminalEvents: emittedEvents.length,
  },
  redaction: {
    bearerTokensIncluded: false,
    filesystemPathsIncluded: false,
    terminalOutputIncluded: false,
  },
};

await writeFile(
  path.join(artifactDir, "proof-gateway-terminal-mcp.json"),
  `${JSON.stringify(verdict, null, 2)}\n`,
  "utf8",
);
console.log(
  "[gateway terminal MCP proof] http=true bound-run-id=true resolver=true real-node-pty=true exact-task-cleanup=true sibling-alive=true",
);

for (const grant of grants) {
  revokeMcpLoopbackClientGrant(grant.token);
  clearMcpLoopbackToolCallCapture(grant.captureKey);
}
markTaskTerminalById({ taskId: task1.taskId, status: "succeeded", endedAt: Date.now() });
manager.disposeAll();
clearFallback();
await closeMcpLoopbackServer();
await subscriptions.taskUnsub();
subscriptions.agentUnsub();
subscriptions.heartbeatUnsub();
subscriptions.transcriptUnsub();
subscriptions.lifecycleUnsub();
await rm(proofRoot, { force: true, recursive: true });
