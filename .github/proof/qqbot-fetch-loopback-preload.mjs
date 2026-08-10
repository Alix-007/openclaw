const PATCH_MARKER = Symbol.for("openclaw.qqbot-proof.fetch-loopback");

if (!globalThis[PATCH_MARKER]) {
  const loopbackBase = process.env.OPENCLAW_QQBOT_PROOF_HTTP_BASE?.replace(/\/+$/u, "");
  if (!loopbackBase) {
    throw new Error("OPENCLAW_QQBOT_PROOF_HTTP_BASE is required");
  }

  const originalFetch = globalThis.fetch.bind(globalThis);
  const proofFetch = async (input, init) => {
    const sourceUrl = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const shouldRoute =
      sourceUrl.hostname === "bots.qq.com" || sourceUrl.hostname === "api.sgroup.qq.com";
    if (!shouldRoute) {
      return await originalFetch(input, init);
    }

    const targetUrl = new URL(`${sourceUrl.pathname}${sourceUrl.search}`, loopbackBase);
    const { dispatcher: _dispatcher, ...forwardInit } = init ?? {};
    return await originalFetch(targetUrl, forwardInit);
  };

  // The guarded-fetch owner recognizes an explicitly installed test fetch and
  // keeps the fixed public hostname policy while the proof transport stays local.
  Object.defineProperty(proofFetch, "mock", { value: Object.freeze({}) });
  globalThis.fetch = proofFetch;
  globalThis[PATCH_MARKER] = true;
}
