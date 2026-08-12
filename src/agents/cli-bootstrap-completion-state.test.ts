import { describe, expect, it } from "vitest";
import {
  consumeCliBootstrapCompletionCallerOwnership,
  markCliBootstrapCompletionCallerOwned,
  markPreparedCliBootstrapCompletion,
  takePreparedCliBootstrapCompletion,
} from "./cli-bootstrap-completion-state.js";
import type { PreparedCliRunContext, RunCliAgentParams } from "./cli-runner/types.js";

describe("CLI bootstrap completion state", () => {
  it("binds one-shot ownership to exact run and prepared-context identities", () => {
    const params = {} as RunCliAgentParams;
    markCliBootstrapCompletionCallerOwned(params);

    expect(consumeCliBootstrapCompletionCallerOwnership({ ...params })).toBe(false);
    expect(consumeCliBootstrapCompletionCallerOwnership(params)).toBe(true);
    expect(consumeCliBootstrapCompletionCallerOwnership(params)).toBe(false);

    const context = {} as PreparedCliRunContext;
    markPreparedCliBootstrapCompletion(context, "caller");

    expect(takePreparedCliBootstrapCompletion({ ...context })).toBeUndefined();
    expect(takePreparedCliBootstrapCompletion(context)).toEqual({ transcriptOwner: "caller" });
    expect(takePreparedCliBootstrapCompletion(context)).toBeUndefined();
  });
});
