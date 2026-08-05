import { pruneMapToMaxSize } from "../infra/map-size.js";
import { escapeRegExp } from "../shared/regexp.js";

const MIN_SECRET_VALUE_LENGTH = 6;
const MAX_SECRET_VALUES = 512;

const registeredValues = new Map<string, true>();
let compiledMatcher: RegExp | undefined;
let firstChars = new Set<string>();

function rebuildProbe(): void {
  firstChars = new Set([...registeredValues.keys()].map((value) => value.charAt(0)));
  compiledMatcher = undefined;
}

function registerOneSecretValue(value: string): void {
  if (registeredValues.delete(value)) {
    registeredValues.set(value, true);
    return;
  }
  registeredValues.set(value, true);
  pruneMapToMaxSize(registeredValues, MAX_SECRET_VALUES);
  rebuildProbe();
}

function secretValueVariants(value: string): string[] {
  const variants: string[] = [];
  // Provider egress can percent-encode a configured value before a remote
  // endpoint reflects it, so keep that wire form tied to the same secret.
  const encoded = encodeURIComponent(value);
  if (encoded !== value) {
    variants.push(encoded);
  }
  // Structured error bodies escape quotes and control characters before the
  // redactor receives response text; match that serialized content too.
  const jsonEscaped = JSON.stringify(value).slice(1, -1);
  if (jsonEscaped !== value) {
    variants.push(jsonEscaped);
  }
  variants.push(value);
  return variants;
}

/** Registers one resolved secret for exact-value log redaction. */
export function registerSecretValueForRedaction(value: string): void {
  if (value.length < MIN_SECRET_VALUE_LENGTH) {
    return;
  }
  // The raw value stays newest so bounded-registry eviction cannot drop the
  // active credential while retaining only a transformed representation.
  for (const variant of secretValueVariants(value)) {
    registerOneSecretValue(variant);
  }
}

/** Redacts exact caller-supplied secrets without retaining them in process state. */
export function redactSuppliedSecretValues(
  text: string,
  values: readonly string[] | undefined,
  mask: (value: string) => string,
): string {
  if (!text || !values?.length) {
    return text;
  }
  const variants = new Set<string>();
  for (const value of values) {
    if (!value) {
      continue;
    }
    for (const variant of secretValueVariants(value)) {
      variants.add(variant);
    }
    // Form serialization is request-scoped so its extra representation cannot
    // consume capacity in the bounded process-wide secret registry.
    variants.add(new URLSearchParams([["value", value]]).toString().slice("value=".length));
  }
  if (variants.size === 0) {
    return text;
  }
  const matcher = new RegExp(
    [...variants]
      .toSorted((left, right) => right.length - left.length)
      .map(escapeRegExp)
      .join("|"),
    "g",
  );
  return text.replace(matcher, (value) => mask(value));
}

/** Returns whether a value has SecretRef provenance in the process registry. */
export function isSecretValueRegisteredForRedaction(value: string): boolean {
  return registeredValues.has(value);
}

export function hasRegisteredSecretValuesForRedaction(): boolean {
  return registeredValues.size > 0;
}

/** Replaces registered exact values while preserving the caller's mask convention. */
export function redactRegisteredSecretValues(
  text: string,
  mask: (value: string) => string,
): string {
  if (!text || registeredValues.size === 0) {
    return text;
  }
  let couldMatch = false;
  for (const firstChar of firstChars) {
    if (text.includes(firstChar)) {
      couldMatch = true;
      break;
    }
  }
  if (!couldMatch) {
    return text;
  }
  compiledMatcher ??= new RegExp(
    [...registeredValues.keys()]
      .toSorted((left, right) => right.length - left.length)
      .map(escapeRegExp)
      .join("|"),
    "g",
  );
  return text.replace(compiledMatcher, (value) => mask(value));
}

function resetSecretRedactionRegistryForTest(): void {
  registeredValues.clear();
  rebuildProbe();
}

if (process.env.VITEST || process.env.NODE_ENV === "test") {
  (globalThis as Record<PropertyKey, unknown>)[
    Symbol.for("openclaw.secretRedactionRegistryTestApi")
  ] = { resetSecretRedactionRegistryForTest };
}
