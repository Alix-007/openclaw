import { redactToolPayloadText } from "openclaw/plugin-sdk/logging-core";

const PERCENT_ESCAPE_RE = /%[0-9a-f]{2}/gi;
const REDACTED_CREDENTIAL = "<redacted>";

interface CredentialForms {
  literal: readonly string[];
  encoded: readonly string[];
}

function canonicalizePercentEscapes(text: string): string {
  return text.replace(PERCENT_ESCAPE_RE, (escape) => escape.toUpperCase());
}

function resolveCredentialForms(credential: string): CredentialForms {
  const jsonEscaped = JSON.stringify(credential).slice(1, -1);
  const literal = new Set([credential, jsonEscaped, jsonEscaped.replaceAll("/", "\\/")]);
  const encoded = new Set([
    new URLSearchParams([["credential", credential]]).toString().slice("credential=".length),
  ]);
  try {
    encoded.add(encodeURIComponent(credential));
  } catch {
    // Raw and JSON forms still cover malformed UTF-16 credentials that URI encoding rejects.
  }
  const longestFirst = (left: string, right: string) => right.length - left.length;
  return {
    literal: [...literal].filter(Boolean).toSorted(longestFirst),
    encoded: [...encoded].filter(Boolean).map(canonicalizePercentEscapes).toSorted(longestFirst),
  };
}

function redactCredentialForms(text: string, forms: CredentialForms): string {
  let redacted = text;
  for (const form of forms.literal) {
    redacted = redacted.replaceAll(form, REDACTED_CREDENTIAL);
  }
  redacted = canonicalizePercentEscapes(redacted);
  for (const form of forms.encoded) {
    redacted = redacted.replaceAll(form, REDACTED_CREDENTIAL);
  }
  return redacted;
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

/** Remove raw, serialized, and encoded request credentials before generic redaction. */
export function redactQQBotCredentialText(text: string, credential: string): string {
  if (!credential) {
    return redactToolPayloadText(text);
  }

  const credentialForms = resolveCredentialForms(credential);
  const withoutExactCredential =
    redactJsonCredentialText(text, credentialForms) ?? redactCredentialForms(text, credentialForms);
  return redactToolPayloadText(withoutExactCredential);
}
