const PERCENT_ESCAPE_RE = /%[0-9A-F]{2}/g;

export function lowercasePercentEscapes(value: string): string {
  return value.replace(PERCENT_ESCAPE_RE, (escape) => escape.toLowerCase());
}

export function percentEncodeEveryUtf8Byte(value: string): string {
  return Array.from(
    new TextEncoder().encode(value),
    (byte) => `%${byte.toString(16).padStart(2, "0").toUpperCase()}`,
  ).join("");
}

export function stringifyWithSlashEscapedCredential(value: unknown, credential: string): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("expected a JSON-serializable credential reflection fixture");
  }
  return serialized.replaceAll(credential, credential.replaceAll("/", "\\/"));
}
