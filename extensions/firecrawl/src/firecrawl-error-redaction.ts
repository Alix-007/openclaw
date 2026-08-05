import { redactToolPayloadText } from "openclaw/plugin-sdk/logging-core";
import { truncateSanitizedExternalContent } from "openclaw/plugin-sdk/security-runtime";

export function safeFirecrawlError(
  detail: string,
  apiKey: string | undefined,
  maxChars: number,
): string {
  return truncateSanitizedExternalContent(
    redactToolPayloadText(detail, apiKey ? [apiKey] : undefined),
    maxChars,
  ).text;
}
