// Msteams plugin module implements http error behavior.
import { createProviderHttpError } from "openclaw/plugin-sdk/provider-http";

type MSTeamsHttpErrorOptions = NonNullable<Parameters<typeof createProviderHttpError>[2]>;

export async function createMSTeamsHttpError(
  response: Response,
  label: string,
  options?: MSTeamsHttpErrorOptions,
): Promise<Error> {
  return await createProviderHttpError(response, label, options);
}
