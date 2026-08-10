import { pruneMapToMaxSize } from "../infra/map-size.js";
import { escapeRegExp } from "../shared/regexp.js";

const MIN_SECRET_VALUE_LENGTH = 6;
const MAX_SECRET_VALUES = 512;
const MIN_TRUNCATED_SENSITIVE_PREFIX_LENGTH = 6;

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

type SuppliedSecretCandidate = {
  candidate: string;
  percentEscapesCaseInsensitive: boolean;
};

function collectSuppliedSecretCandidates(
  values: readonly string[] | undefined,
): SuppliedSecretCandidate[] {
  const candidates = new Map<string, boolean>();
  const addCandidate = (candidate: string, percentEscapesCaseInsensitive: boolean) => {
    if (!candidate) {
      return;
    }
    candidates.set(candidate, candidates.get(candidate) === true || percentEscapesCaseInsensitive);
  };
  const addJsonLayers = (value: string, percentEscapesCaseInsensitive: boolean) => {
    let candidate = value;
    for (let depth = 0; depth < 3; depth += 1) {
      addCandidate(candidate, percentEscapesCaseInsensitive);
      const escaped = JSON.stringify(candidate).slice(1, -1);
      if (escaped === candidate) {
        break;
      }
      candidate = escaped;
    }
  };

  for (const value of values ?? []) {
    if (!value) {
      continue;
    }
    addJsonLayers(value, false);
    try {
      addJsonLayers(encodeURIComponent(value), true);
    } catch {
      // Lone UTF-16 surrogates cannot be URL encoded; raw and JSON forms still apply.
    }
    const formEncoded = new URLSearchParams([["value", value]]).toString().slice("value=".length);
    addJsonLayers(formEncoded, true);
  }

  return [...candidates].map(([candidate, percentEscapesCaseInsensitive]) => ({
    candidate,
    percentEscapesCaseInsensitive,
  }));
}

function buildPercentEscapeCaseInsensitivePattern(candidate: string): RegExp {
  const source = escapeRegExp(candidate).replace(
    /%([0-9A-Fa-f])([0-9A-Fa-f])/gu,
    (_match, first: string, second: string) => {
      const hexPattern = (character: string) => {
        const upper = character.toUpperCase();
        return /[A-F]/u.test(upper) ? `[${upper}${upper.toLowerCase()}]` : upper;
      };
      return `%${hexPattern(first)}${hexPattern(second)}`;
    },
  );
  return new RegExp(source, "gu");
}

function normalizePercentEscapeHexCase(value: string): string {
  return value.replace(/%([0-9A-Fa-f]{1,2})/gu, (_escape, hex: string) => `%${hex.toUpperCase()}`);
}

function redactTruncatedSuppliedSecretSuffix(
  text: string,
  candidates: readonly SuppliedSecretCandidate[],
): string {
  let longestPartialSuffix = 0;
  const normalizedText = normalizePercentEscapeHexCase(text);
  for (const candidate of candidates) {
    if (candidate.candidate.length < 2) {
      continue;
    }
    const comparableText = candidate.percentEscapesCaseInsensitive ? normalizedText : text;
    const comparableCandidate = candidate.percentEscapesCaseInsensitive
      ? normalizePercentEscapeHexCase(candidate.candidate)
      : candidate.candidate;
    // Complete values are already redacted. Require a meaningful prefix so an
    // ordinary one-character suffix does not suppress an otherwise safe diagnostic.
    if (comparableText.endsWith(comparableCandidate)) {
      continue;
    }
    const minimumPrefixLength = Math.min(
      MIN_TRUNCATED_SENSITIVE_PREFIX_LENGTH,
      comparableCandidate.length - 1,
    );
    const maxPrefixLength = Math.min(comparableCandidate.length - 1, comparableText.length);
    for (
      let prefixLength = maxPrefixLength;
      prefixLength >= minimumPrefixLength && prefixLength > longestPartialSuffix;
      prefixLength -= 1
    ) {
      if (comparableText.endsWith(comparableCandidate.slice(0, prefixLength))) {
        longestPartialSuffix = prefixLength;
        break;
      }
    }
  }
  if (longestPartialSuffix === 0) {
    return text;
  }
  return `${text.slice(0, -longestPartialSuffix)}[truncated diagnostic omitted because it ended with a partial sensitive value]`;
}

/** Redacts exact caller-supplied secrets without retaining them in process state. */
export function redactSuppliedSecretValues(
  text: string,
  values: readonly string[] | undefined,
  options?: { sourceTruncated?: boolean },
): string {
  if (!text || !values?.length) {
    return text;
  }
  const candidates = collectSuppliedSecretCandidates(values).toSorted(
    (left, right) => right.candidate.length - left.candidate.length,
  );
  let redacted = text;
  for (const candidate of candidates) {
    redacted = candidate.percentEscapesCaseInsensitive
      ? redacted.replace(buildPercentEscapeCaseInsensitivePattern(candidate.candidate), () => "***")
      : redacted.replaceAll(candidate.candidate, () => "***");
  }
  return options?.sourceTruncated
    ? redactTruncatedSuppliedSecretSuffix(redacted, candidates)
    : redacted;
}

/** Registers one resolved secret for exact-value log redaction. */
export function registerSecretValueForRedaction(value: string): void {
  if (value.length < MIN_SECRET_VALUE_LENGTH) {
    return;
  }
  // URL egress percent-encodes injected values; redact that surface form too.
  const encoded = encodeURIComponent(value);
  if (encoded !== value) {
    registerOneSecretValue(encoded);
  }
  // Captured structured payloads are serialized before persistence, so retain
  // the JSON string-content form for credentials with escaped characters.
  const jsonEscaped = JSON.stringify(value).slice(1, -1);
  if (jsonEscaped !== value) {
    registerOneSecretValue(jsonEscaped);
  }
  // Keep the raw value newest so bounded-registry eviction cannot drop the
  // active credential while retaining only a transformed representation.
  registerOneSecretValue(value);
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
