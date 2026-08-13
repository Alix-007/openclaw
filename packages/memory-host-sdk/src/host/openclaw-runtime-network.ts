// Narrow network/runtime facade re-exported for memory remote HTTP helpers.

export { fetchWithSsrFGuard } from "../../../../src/infra/net/fetch-guard.js";
export {
  getProviderRequestSensitiveHeaderNames,
  inheritProviderRequestHeaderContext,
  recordProviderRequestHeaderContext,
} from "../../../../src/infra/net/provider-request-header-context.js";
export { shouldUseEnvHttpProxyForUrl } from "../../../../src/infra/net/proxy-env.js";
export { ssrfPolicyFromHttpBaseUrlAllowedHostname } from "../../../../src/infra/net/ssrf.js";
export type { SsrFPolicy } from "../../../../src/infra/net/ssrf.js";
