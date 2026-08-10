import { redactToolPayloadText } from "openclaw/plugin-sdk/logging-core";

const PERCENT_ESCAPE_RE = /%[0-9a-f]{2}/gi;
const UNICODE_ESCAPE_RE = /\\+u([0-9a-f]{4})/gi;
const REDACTED_CREDENTIAL = "<redacted>";

interface CredentialForms {
  literal: readonly string[];
  mixedPercent: readonly (readonly CredentialUnit[])[];
}

interface CredentialUnit {
  literal: string;
  percentEncoded: string;
  formEncoded?: string;
}

function canonicalizePercentEscapes(text: string): string {
  return text.replace(PERCENT_ESCAPE_RE, (escape) => escape.toUpperCase());
}

function percentEncodeEveryUtf8Byte(text: string): string {
  // encodeURIComponent leaves unreserved characters literal, but providers
  // can reflect credentials with every UTF-8 byte percent-encoded.
  return Array.from(
    new TextEncoder().encode(text),
    (byte) => `%${byte.toString(16).padStart(2, "0")}`,
  ).join("");
}

function resolveCredentialUnits(text: string): readonly CredentialUnit[] {
  return Array.from(text, (literal) => ({
    literal,
    percentEncoded: canonicalizePercentEscapes(percentEncodeEveryUtf8Byte(literal)),
    ...(literal === " " ? { formEncoded: "+" } : {}),
  }));
}

function matchCredentialUnits(
  text: string,
  start: number,
  units: readonly CredentialUnit[],
): number | undefined {
  let offsets = new Set([start]);
  for (const unit of units) {
    const nextOffsets = new Set<number>();
    for (const offset of offsets) {
      if (text.startsWith(unit.literal, offset)) {
        nextOffsets.add(offset + unit.literal.length);
      }
      const percentCandidate = text.slice(offset, offset + unit.percentEncoded.length);
      if (canonicalizePercentEscapes(percentCandidate) === unit.percentEncoded) {
        nextOffsets.add(offset + unit.percentEncoded.length);
      }
      if (unit.formEncoded && text.startsWith(unit.formEncoded, offset)) {
        nextOffsets.add(offset + unit.formEncoded.length);
      }
    }
    if (nextOffsets.size === 0) {
      return undefined;
    }
    // A literal "%" and its encoded form share a prefix. Keep both positions
    // so partially encoded credentials cannot escape the exact-secret boundary.
    offsets = nextOffsets;
  }
  return Math.max(...offsets);
}

function redactMixedPercentCredentialForms(
  text: string,
  forms: readonly (readonly CredentialUnit[])[],
): string {
  let redacted = "";
  let copiedThrough = 0;
  let offset = 0;
  while (offset < text.length) {
    const matchEnd = forms
      .map((form) => matchCredentialUnits(text, offset, form))
      .find((end): end is number => end !== undefined);
    if (matchEnd === undefined) {
      offset += 1;
      continue;
    }
    redacted += `${text.slice(copiedThrough, offset)}${REDACTED_CREDENTIAL}`;
    copiedThrough = matchEnd;
    offset = matchEnd;
  }
  return copiedThrough === 0 ? text : redacted + text.slice(copiedThrough);
}

function resolveCredentialForms(credentials: readonly string[]): CredentialForms {
  const literal = new Set<string>();
  for (const credential of credentials) {
    if (!credential) {
      continue;
    }
    const jsonEscaped = JSON.stringify(credential).slice(1, -1);
    literal.add(credential);
    literal.add(jsonEscaped);
    literal.add(jsonEscaped.replaceAll("/", "\\/"));
  }
  const longestFirst = (left: string, right: string) => right.length - left.length;
  return {
    literal: [...literal].filter(Boolean).toSorted(longestFirst),
    mixedPercent: [...literal].filter(Boolean).toSorted(longestFirst).map(resolveCredentialUnits),
  };
}

function redactDirectCredentialForms(text: string, forms: CredentialForms): string {
  let redacted = text;
  for (const form of forms.literal) {
    redacted = redacted.replaceAll(form, REDACTED_CREDENTIAL);
  }
  return redactMixedPercentCredentialForms(redacted, forms.mixedPercent);
}

function redactCredentialForms(text: string, forms: CredentialForms): string {
  const directlyRedacted = redactDirectCredentialForms(text, forms);
  const unicodeCanonicalized = directlyRedacted.replace(
    UNICODE_ESCAPE_RE,
    (_escape, codeUnit: string) => String.fromCharCode(Number.parseInt(codeUnit, 16)),
  );
  if (unicodeCanonicalized === directlyRedacted) {
    return directlyRedacted;
  }

  const canonicalizedRedaction = redactDirectCredentialForms(unicodeCanonicalized, forms);
  // Preserve unrelated escaped diagnostic text unless decoding it reveals a
  // request credential that must be removed before parsing or presentation.
  return canonicalizedRedaction === unicodeCanonicalized
    ? directlyRedacted
    : canonicalizedRedaction;
}

function redactJsonCredentialText(text: string, forms: CredentialForms): string | undefined {
  try {
    // Decode valid JSON before matching so alternate escapes cannot reconstruct
    // the credential when a caller parses the presented body downstream.
    const parsed = JSON.parse(text) as unknown;
    const serialized = JSON.stringify(parsed, (_key, value: unknown) =>
      typeof value === "string" ? redactCredentialForms(value, forms) : value,
    );
    return serialized === undefined ? undefined : redactCredentialForms(serialized, forms);
  } catch {
    return undefined;
  }
}

/** Remove raw, serialized, and encoded credentials before generic redaction. */
export function redactQQBotCredentialText(text: string, ...credentials: readonly string[]): string {
  const credentialForms = resolveCredentialForms(credentials);
  if (credentialForms.literal.length === 0) {
    return redactToolPayloadText(text);
  }

  const withoutExactCredential =
    redactJsonCredentialText(text, credentialForms) ?? redactCredentialForms(text, credentialForms);
  return redactToolPayloadText(withoutExactCredential);
}
