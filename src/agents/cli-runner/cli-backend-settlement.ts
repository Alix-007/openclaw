import { assertAgentRunLifecycleGenerationCurrent } from "../../infra/agent-events.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { takePreparedCliBootstrapCompletion } from "../cli-bootstrap-completion-state.js";
import { finalizeRunnerOwnedPendingCliBootstrapCompletion } from "../cli-bootstrap-completion.js";
import type { EmbeddedAgentRunResult } from "../embedded-agent-runner.js";
import { coerceToFailoverError } from "../failover-error.js";
import type { ClaudeCliRunDiagnosticLifecycle } from "./run-diagnostics.js";
import type { PreparedCliRunContext } from "./types.js";

const log = createSubsystemLogger("agents/cli-runner");

function settleCliBackendOutcome(params: {
  runResult: EmbeddedAgentRunResult | undefined;
  runError: unknown;
  runFailed: boolean;
  cleanupFailed: boolean;
  cleanupError: unknown;
  deliveredMessagingSideEffect: boolean;
  diagnosticLifecycle?: ClaudeCliRunDiagnosticLifecycle;
  failoverContext: { provider: string; model: string; sessionId: string; lane?: string };
}): EmbeddedAgentRunResult {
  const {
    cleanupError,
    cleanupFailed,
    deliveredMessagingSideEffect,
    diagnosticLifecycle,
    failoverContext,
    runError,
    runFailed,
    runResult,
  } = params;
  if (cleanupFailed) {
    if (!deliveredMessagingSideEffect) {
      if (runFailed) {
        log.warn(`CLI run also failed before backend cleanup: ${formatErrorMessage(runError)}`);
      }
      diagnosticLifecycle?.setPhase("cleanup");
      throw cleanupError;
    }
    log.warn(
      `CLI backend cleanup failed after confirmed message delivery: ${formatErrorMessage(cleanupError)}`,
    );
  }
  if (runFailed) {
    throw coerceToFailoverError(runError, failoverContext) ?? runError;
  }
  if (!runResult) {
    throw new Error("CLI run completed without a result");
  }
  return runResult;
}

/** Settles backend cleanup before releasing runner-owned bootstrap completion. */
export async function settleCliBackendExecution(params: {
  context: PreparedCliRunContext;
  diagnosticLifecycle?: ClaudeCliRunDiagnosticLifecycle;
  failoverContext: { provider: string; model: string; sessionId: string; lane?: string };
  getDeliveredMessagingSideEffect: () => boolean;
  run: () => Promise<EmbeddedAgentRunResult>;
}): Promise<EmbeddedAgentRunResult> {
  let runResult: EmbeddedAgentRunResult | undefined;
  let runError: unknown;
  let runFailed = false;
  let cleanupSucceeded = true;
  try {
    runResult = await params.run();
  } catch (error) {
    runFailed = true;
    runError = error;
  }
  let cleanupError: unknown;
  try {
    await params.context.preparedBackend.cleanup?.();
  } catch (error) {
    cleanupSucceeded = false;
    cleanupError = error;
  }
  try {
    const settledResult = settleCliBackendOutcome({
      runResult,
      runError,
      runFailed,
      cleanupFailed: !cleanupSucceeded,
      cleanupError,
      deliveredMessagingSideEffect: params.getDeliveredMessagingSideEffect(),
      diagnosticLifecycle: params.diagnosticLifecycle,
      failoverContext: params.failoverContext,
    });
    const runParams = params.context.params;
    void finalizeRunnerOwnedPendingCliBootstrapCompletion({
      result: settledResult,
      transcriptStable: cleanupSucceeded,
      isStillEligible: () => {
        if (runParams.abortSignal?.aborted === true) {
          return false;
        }
        if (runParams.lifecycleGeneration) {
          assertAgentRunLifecycleGenerationCurrent(runParams.lifecycleGeneration);
        }
        return true;
      },
    });
    return settledResult;
  } finally {
    takePreparedCliBootstrapCompletion(params.context);
  }
}
