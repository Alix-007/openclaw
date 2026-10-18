import { expect, it, type Mock } from "vitest";

export function registerModelsAuthEncodingTests(fixture: {
  pipeInput: (input: Buffer) => void;
  commands: { kind: string; field: string; run: () => Promise<void> }[];
  mocks: {
    clackPassword: Mock;
    upsertAuthProfileWithLock: Mock;
    updateConfig: Mock;
    callGateway: Mock;
  };
}) {
  const { pipeInput, commands, mocks } = fixture;
  it.each(commands)("rejects malformed UTF-8 before saving a piped $kind", async ({ run }) => {
    pipeInput(
      Buffer.concat([Buffer.from("synthetic-before-"), Buffer.from([0xff]), Buffer.from("-after")]),
    );
    await expect(run()).rejects.toThrow("Piped auth input must be valid UTF-8.");
    expect(mocks.clackPassword).not.toHaveBeenCalled();
    expect(mocks.upsertAuthProfileWithLock).not.toHaveBeenCalled();
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    expect(mocks.callGateway).not.toHaveBeenCalled();
  });
  it.each(commands)(
    "keeps existing normalization for a valid UTF-8 piped $kind",
    async ({ run, field }) => {
      pipeInput(Buffer.from("\uFEFFsynthetic-é-value\r\n"));
      await run();
      expect(mocks.upsertAuthProfileWithLock).toHaveBeenCalledWith(
        expect.objectContaining({
          credential: expect.objectContaining({ [field]: "synthetic-é-value" }),
        }),
      );
    },
  );
}

export function withInteractiveStdin() {
  const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean };
  const hadOwnIsTTY = Object.hasOwn(stdin, "isTTY");
  const previousIsTTYDescriptor = Object.getOwnPropertyDescriptor(stdin, "isTTY");
  Object.defineProperty(stdin, "isTTY", {
    configurable: true,
    enumerable: true,
    get: () => true,
  });
  return () => {
    if (previousIsTTYDescriptor) {
      Object.defineProperty(stdin, "isTTY", previousIsTTYDescriptor);
    } else if (!hadOwnIsTTY) {
      delete (stdin as { isTTY?: boolean }).isTTY;
    }
  };
}

export function withPipedStdin(input: string | Buffer) {
  const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean };
  const restoreInteractive = withInteractiveStdin();
  const previousAsyncIteratorDescriptor = Object.getOwnPropertyDescriptor(
    stdin,
    Symbol.asyncIterator,
  );
  Object.defineProperty(stdin, "isTTY", {
    configurable: true,
    enumerable: true,
    get: () => false,
  });
  Object.defineProperty(stdin, Symbol.asyncIterator, {
    configurable: true,
    async *value() {
      yield input;
    },
  });
  return () => {
    if (previousAsyncIteratorDescriptor) {
      Object.defineProperty(stdin, Symbol.asyncIterator, previousAsyncIteratorDescriptor);
    } else {
      Reflect.deleteProperty(stdin, Symbol.asyncIterator);
    }
    restoreInteractive();
  };
}
