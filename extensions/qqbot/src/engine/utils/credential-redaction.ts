import { redactToolPayloadText } from "openclaw/plugin-sdk/logging-core";

/** Remove raw, serialized, and encoded request credentials before generic redaction. */
export function redactQQBotCredentialText(text: string, credential: string): string {
  if (!credential) {
    return redactToolPayloadText(text);
  }

  const credentialForms = new Set([credential, JSON.stringify(credential).slice(1, -1)]);
  credentialForms.add(
    new URLSearchParams([["credential", credential]]).toString().slice("credential=".length),
  );
  try {
    credentialForms.add(encodeURIComponent(credential));
  } catch {
    // Raw and JSON forms still cover malformed UTF-16 credentials that URI encoding rejects.
  }

  let withoutExactCredential = text;
  for (const form of [...credentialForms].filter(Boolean).toSorted((a, b) => b.length - a.length)) {
    withoutExactCredential = withoutExactCredential.replaceAll(form, "<redacted>");
  }
  return redactToolPayloadText(withoutExactCredential);
}
