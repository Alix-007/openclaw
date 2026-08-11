import { describe, expect, it } from "vitest";
import {
  getGuardedResponseRequestContext,
  inheritGuardedResponseRequestContext,
  recordGuardedResponseRequestContext,
} from "../infra/net/guarded-response-request-context.js";
import { createProviderHttpError } from "./provider-http-errors.js";

type ProviderHttpErrorShape = Error & {
  code?: string;
  errorBody?: string;
  errorCode?: string;
  errorType?: string;
  requestId?: string;
};

describe("provider HTTP guarded request context", () => {
  it("redacts final header, query, and userinfo credentials without caller options", async () => {
    const bearer = "orchidRiver17glassMoth92cabin";
    const queryToken = "cobaltHarbor28silverCloud61";
    const username = "violetUser34meadow";
    const password = "amberPassword73grove";
    const response = recordGuardedResponseRequestContext(
      new Response(
        JSON.stringify({
          error: {
            message: `reflected ${bearer} ${queryToken} ${username} ${password}`,
            code: queryToken,
            type: bearer,
          },
        }),
        { status: 401, headers: { "x-request-id": password } },
      ),
      {
        headers: { authorization: `Bearer ${bearer}` },
        url: `https://${username}:${password}@api.example.test/fail?access_token=${queryToken}&page=1`,
      },
    );

    const error = (await createProviderHttpError(
      response,
      "Provider API error",
    )) as ProviderHttpErrorShape;
    const diagnostics = `${error.message}\n${JSON.stringify(error)}`;

    for (const secret of [bearer, queryToken, username, password]) {
      expect(diagnostics).not.toContain(secret);
    }
    expect(error).toMatchObject({
      code: "***",
      errorCode: "***",
      errorType: "***",
      requestId: "***",
    });
  });

  it("snapshots headers and inherits context across a reconstructed response", async () => {
    const originalSecret = "cedarOriginal46harbor";
    const replacementSecret = "mapleReplacement91summit";
    const headers = new Headers({ authorization: `Bearer ${originalSecret}` });
    const source = recordGuardedResponseRequestContext(new Response(null, { status: 401 }), {
      headers,
      url: "https://api.example.test/fail",
    });
    headers.set("authorization", `Bearer ${replacementSecret}`);
    const target = inheritGuardedResponseRequestContext(
      source,
      new Response(JSON.stringify({ error: { message: originalSecret } }), { status: 401 }),
    );
    const inheritedContext = getGuardedResponseRequestContext(target);

    const error = await createProviderHttpError(target, "Provider API error");
    const diagnostics = `${error.message}\n${JSON.stringify(error)}`;

    expect(diagnostics).not.toContain(originalSecret);
    expect(inheritedContext?.requestHeaderEntries).toContainEqual([
      "authorization",
      `Bearer ${originalSecret}`,
    ]);
    expect(inheritedContext?.requestHeaderEntries).not.toContainEqual([
      "authorization",
      `Bearer ${replacementSecret}`,
    ]);
  });

  it("unions guarded request context with explicit body credentials", async () => {
    const headerSecret = "spruceHeader83valley";
    const formSecret = "willowVerifier52ridge";
    const response = recordGuardedResponseRequestContext(
      new Response(JSON.stringify({ error: { message: `${headerSecret} ${formSecret}` } }), {
        status: 400,
      }),
      {
        headers: { "x-api-key": headerSecret },
        url: "https://api.example.test/token",
      },
    );

    const error = await createProviderHttpError(response, "OAuth exchange failed", {
      sensitiveValues: [formSecret],
    });

    const diagnostics = `${error.message}\n${JSON.stringify(error)}`;
    expect(diagnostics).not.toContain(headerSecret);
    expect(diagnostics).not.toContain(formSecret);
  });

  it("omits provider diagnostics when a sensitive URL value is too short to redact exactly", async () => {
    const response = recordGuardedResponseRequestContext(
      new Response(JSON.stringify({ error: { message: "code 1, retry in 10 seconds" } }), {
        status: 400,
        headers: { "x-request-id": "request-1" },
      }),
      {
        url: "https://api.example.test/fail?code=1",
      },
    );

    const error = (await createProviderHttpError(
      response,
      "Provider API error",
    )) as ProviderHttpErrorShape;

    expect(error.message).toContain(
      "diagnostic omitted because it may contain a short sensitive value",
    );
    expect(error.message).not.toContain("retry in");
    expect(error.errorBody).toBe(
      "[diagnostic omitted because it may contain a short sensitive value]",
    );
    expect(error.requestId).toBe(
      "[diagnostic omitted because it may contain a short sensitive value]",
    );
  });
});
