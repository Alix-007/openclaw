// Voice Call provider HTTP clients share bounded response body readers.
import { readResponseWithLimit } from "openclaw/plugin-sdk/response-limit-runtime";

const PROVIDER_JSON_RESPONSE_MAX_BYTES = 1 * 1024 * 1024;

export async function cancelProviderResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

export async function readVoiceCallProviderJsonResponse<T>(
  response: Response,
  malformedJsonMessage: string,
): Promise<T | undefined> {
  const body = await readResponseWithLimit(response, PROVIDER_JSON_RESPONSE_MAX_BYTES, {
    onOverflow: ({ size, maxBytes }) =>
      new Error(`provider response body too large: ${size} bytes (limit: ${maxBytes} bytes)`),
  });
  if (body.byteLength === 0) {
    return undefined;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new Error(malformedJsonMessage, { cause });
  }
}
