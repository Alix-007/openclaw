import fs from "node:fs";

const originalFetch = globalThis.fetch;
const logPath = process.env.OPENCLAW_QUOTA_PROOF_FETCH_LOG;

function record(url, init) {
  if (!logPath) {
    return;
  }
  const headers = new Headers(init?.headers);
  fs.appendFileSync(
    logPath,
    `${JSON.stringify({
      host: url.host,
      pathname: url.pathname,
      authorizationPresent: headers.has("authorization"),
    })}\n`,
  );
}

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href === "https://chatgpt.com/backend-api/wham/usage") {
    record(url, init);
    const nowSeconds = Math.floor(Date.now() / 1000);
    return Response.json({
      plan_type: "Plus",
      rate_limit: {
        limit_reached: false,
        primary_window: {
          limit_window_seconds: 18_000,
          used_percent: 71,
          reset_at: nowSeconds + 14_400,
        },
        secondary_window: {
          limit_window_seconds: 604_800,
          used_percent: 37,
          reset_at: nowSeconds + 345_600,
        },
      },
    });
  }
  if (url.href === "https://api.anthropic.com/api/oauth/usage") {
    record(url, init);
    return Response.json({
      five_hour: {
        utilization: 22,
        resets_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      },
      seven_day: {
        utilization: 25,
        resets_at: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
  }
  return await originalFetch(input, init);
};
