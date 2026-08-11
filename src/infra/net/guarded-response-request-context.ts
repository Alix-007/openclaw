import { isSensitiveUrlQueryParamName } from "@openclaw/net-policy/redact-sensitive-url";

export type GuardedResponseRequestContext = {
  requestHeaderEntries: readonly (readonly [string, string])[];
  sensitiveRequestHeaderNames: readonly string[];
  sensitiveUrlValues: readonly string[];
};

const guardedResponseRequestContexts = new WeakMap<Response, GuardedResponseRequestContext>();

function decodeUrlCredential(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractSensitiveRequestUrlValues(url: string): readonly string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const values = new Set<string>();
  for (const credential of [parsed.username, parsed.password]) {
    const value = decodeUrlCredential(credential).trim();
    if (value) {
      values.add(value);
    }
  }
  for (const [name, rawValue] of parsed.searchParams) {
    const value = rawValue.trim();
    if (value && isSensitiveUrlQueryParamName(name)) {
      values.add(value);
    }
  }
  return Object.freeze([...values]);
}

export function recordGuardedResponseRequestContext(
  response: Response,
  request: {
    headers?: HeadersInit;
    sensitiveRequestHeaderNames?: readonly string[];
    url: string;
  },
): Response {
  const headers = new Headers(request.headers);
  const requestHeaderEntries = Object.freeze(
    [...headers.entries()].map(([name, value]) => Object.freeze([name, value] as const)),
  );
  const sensitiveRequestHeaderNames = Object.freeze(
    [
      ...new Set(
        request.sensitiveRequestHeaderNames
          ?.map((name) => name.trim().toLowerCase())
          .filter((name) => name && headers.has(name)),
      ),
    ].toSorted(),
  );
  // Keep only the immutable request facts needed by the error normalizer. In
  // particular, never retain the complete final URL on a long-lived Response.
  guardedResponseRequestContexts.set(
    response,
    Object.freeze({
      requestHeaderEntries,
      sensitiveRequestHeaderNames,
      sensitiveUrlValues: extractSensitiveRequestUrlValues(request.url),
    }),
  );
  return response;
}

export function inheritGuardedResponseRequestContext(source: Response, target: Response): Response {
  const context = guardedResponseRequestContexts.get(source);
  if (context && source !== target) {
    guardedResponseRequestContexts.set(target, context);
  }
  return target;
}

export function getGuardedResponseRequestContext(
  response: Response,
): GuardedResponseRequestContext | undefined {
  return guardedResponseRequestContexts.get(response);
}
