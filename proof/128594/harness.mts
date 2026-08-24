import { execFileSync } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.env.OPENCLAW_PROOF_REPO;
const expectedHead = process.env.OPENCLAW_PROOF_HEAD;
if (!repoRoot || !expectedHead) {
  throw new Error("OPENCLAW_PROOF_REPO and OPENCLAW_PROOF_HEAD are required");
}

const productHead = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
if (productHead !== expectedHead) {
  throw new Error(`product head mismatch: expected ${expectedHead}, received ${productHead}`);
}

const proofRoot = await mkdtemp(join(tmpdir(), "openclaw-pr-128594-proof-"));
const stateDir = join(proofRoot, "state");
const workspaceDir = join(proofRoot, "workspace");
process.env.OPENCLAW_STATE_DIR = stateDir;
process.env.OPENCLAW_CONFIG_PATH = join(stateDir, "openclaw.json");

try {
  const { createOpenClawTools } = await import(
    pathToFileURL(join(repoRoot, "src/agents/openclaw-tools.ts")).href
  );
  const { validateToolArguments } = await import(
    pathToFileURL(join(repoRoot, "src/plugin-sdk/llm.ts")).href
  );
  const tool = createOpenClawTools({
    workspaceDir,
    config: {},
    disablePluginTools: true,
    disableMessageTool: true,
  }).find((candidate) => candidate.name === "skill_workshop");
  if (!tool) {
    throw new Error("skill_workshop was not exposed by createOpenClawTools");
  }

  const args = {
    action: "create" as const,
    name: "Long Description",
    description: "x".repeat(161),
    proposal_content: "# Long Description\n",
  };
  const call = {
    type: "toolCall" as const,
    id: "proof-call-128594",
    name: tool.name,
    arguments: args,
  };

  validateToolArguments(tool, call);
  let outcomeMessage = "";
  try {
    await tool.execute(call.id, args);
  } catch (error) {
    outcomeMessage = error instanceof Error ? error.message : String(error);
  }

  const expectedMessage = "Skill proposal description is too large (161 bytes, max 160).";
  let proposalStateWritten = true;
  try {
    await access(join(stateDir, "skill-workshop"));
  } catch {
    proposalStateWritten = false;
  }
  const assertions = {
    exactProductHead: productHead === expectedHead,
    registryToolExposed: tool.name === "skill_workshop",
    schemaValidationAccepted: true,
    serviceReturnedByteAwareError: outcomeMessage === expectedMessage,
    rejectedBeforeProposalStateWrite: !proposalStateWritten,
  };
  if (Object.values(assertions).some((value) => !value)) {
    throw new Error(`proof assertion failed: ${JSON.stringify(assertions)}`);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        proof: "skill_workshop real tool call",
        productHead,
        node: process.version,
        boundary: "createOpenClawTools -> validateToolArguments -> skill_workshop.execute",
        input: {
          action: args.action,
          descriptionCharacters: args.description.length,
          descriptionBytes: Buffer.byteLength(args.description, "utf8"),
        },
        outcome: { kind: "error", message: outcomeMessage },
        state: { proposalStateWritten },
        assertions,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(proofRoot, { recursive: true, force: true });
}
