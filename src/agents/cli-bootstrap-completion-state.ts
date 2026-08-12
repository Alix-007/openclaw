import type { PreparedCliRunContext, RunCliAgentParams } from "./cli-runner/types.js";

type PreparedCliBootstrapCompletion = {
  transcriptOwner: "caller" | "runner";
};

const callerOwnedRuns = new WeakSet<RunCliAgentParams>();
const preparedCompletions = new WeakMap<PreparedCliRunContext, PreparedCliBootstrapCompletion>();

/** Marks the exact run whose post-run caller owns transcript settlement. */
export function markCliBootstrapCompletionCallerOwned(params: RunCliAgentParams): void {
  callerOwnedRuns.add(params);
}

/** Consumes caller ownership while preparing the exact marked run object. */
export function consumeCliBootstrapCompletionCallerOwnership(params: RunCliAgentParams): boolean {
  return callerOwnedRuns.delete(params);
}

/** Records completion ownership on the exact prepared context that established it. */
export function markPreparedCliBootstrapCompletion(
  context: PreparedCliRunContext,
  transcriptOwner: PreparedCliBootstrapCompletion["transcriptOwner"],
): void {
  preparedCompletions.set(context, { transcriptOwner });
}

/** Transfers and clears completion ownership at result settlement. */
export function takePreparedCliBootstrapCompletion(
  context: PreparedCliRunContext,
): PreparedCliBootstrapCompletion | undefined {
  const completion = preparedCompletions.get(context);
  preparedCompletions.delete(context);
  return completion;
}
