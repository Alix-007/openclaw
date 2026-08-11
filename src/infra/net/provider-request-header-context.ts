const sensitiveRequestHeaderNamesByOwner = new WeakMap<object, readonly string[]>();

function normalizeSensitiveHeaderNames(names: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean))].toSorted(),
  );
}

/** Records only schema-backed sensitive header names, never header values. */
export function recordProviderRequestHeaderContext<T extends object>(
  target: T,
  sensitiveRequestHeaderNames: readonly string[],
): T {
  const names = normalizeSensitiveHeaderNames(sensitiveRequestHeaderNames);
  if (names.length > 0) {
    sensitiveRequestHeaderNamesByOwner.set(target, names);
    const headers = (target as { headers?: unknown }).headers;
    if (headers && typeof headers === "object") {
      sensitiveRequestHeaderNamesByOwner.set(headers, names);
    }
  }
  return target;
}

export function getProviderRequestSensitiveHeaderNames(
  target: object,
): readonly string[] | undefined {
  return sensitiveRequestHeaderNamesByOwner.get(target);
}

/** Preserves sensitive-name provenance across a Headers or request-config reconstruction. */
export function inheritProviderRequestHeaderContext<T extends object>(
  source: object,
  target: T,
  additionalSensitiveHeaderNames: readonly string[] = [],
): T {
  return recordProviderRequestHeaderContext(target, [
    ...(getProviderRequestSensitiveHeaderNames(source) ?? []),
    ...(getProviderRequestSensitiveHeaderNames(target) ?? []),
    ...additionalSensitiveHeaderNames,
  ]);
}

/** Preserves header provenance when an owner projects one request-bearing object into another. */
export function inheritProviderRequestHeadersContext<T extends { headers?: object }>(
  source: { headers?: object },
  target: T,
): T {
  if (source.headers && target.headers && source.headers !== target.headers) {
    inheritProviderRequestHeaderContext(source.headers, target.headers);
  }
  return target;
}
