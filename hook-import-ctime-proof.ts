import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXPECTED_HEAD = "d5fdcb76fb00cb38210699c4915f8e835aa396ca";
const INITIAL_SOURCE = 'export default () => "before";\n';
const EDITED_SOURCE = 'export default () => "after!";\n';

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function redactImportUrl(value: string): string {
  const parsed = new URL(value);
  return `file://<redacted>/handler.mjs${parsed.search}`;
}

async function main(): Promise<void> {
  const outputDir = process.argv[2];
  if (!outputDir) {
    throw new Error("usage: hook-import-ctime-proof.ts <output-dir>");
  }

  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(head, EXPECTED_HEAD, "proof must run against the reviewed PR head");
  assert.equal(Buffer.byteLength(INITIAL_SOURCE), Buffer.byteLength(EDITED_SOURCE));

  const productionModuleUrl = pathToFileURL(
    path.join(process.cwd(), "src/hooks/import-url.ts"),
  ).href;
  const { buildImportUrl } = (await import(productionModuleUrl)) as {
    buildImportUrl(handlerPath: string, source: "openclaw-workspace"): string;
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-hook-proof-"));
  const handlerPath = path.join(tempDir, "handler.mjs");

  try {
    fs.writeFileSync(handlerPath, INITIAL_SOURCE);
    const fixedTime = new Date("2026-01-01T00:00:00.000Z");
    fs.utimesSync(handlerPath, fixedTime, fixedTime);
    const initialStat = fs.statSync(handlerPath);
    const initialUrl = buildImportUrl(handlerPath, "openclaw-workspace");
    const initialHandler = (await import(initialUrl)).default as () => string;
    const initialResult = initialHandler();

    let editedStat = initialStat;
    for (let attempt = 0; attempt < 100 && editedStat.ctimeMs === initialStat.ctimeMs; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      fs.writeFileSync(handlerPath, EDITED_SOURCE);
      fs.utimesSync(handlerPath, initialStat.atime, initialStat.mtime);
      editedStat = fs.statSync(handlerPath);
    }
    assert.notEqual(editedStat.ctimeMs, initialStat.ctimeMs, "ctime did not advance");

    const editedUrl = buildImportUrl(handlerPath, "openclaw-workspace");
    const editedHandler = (await import(editedUrl)).default as () => string;
    const editedResult = editedHandler();
    const observation = {
      schemaVersion: 1,
      pr: 128477,
      headSha: head,
      generatedAt: new Date().toISOString(),
      node: process.version,
      credentialMode: "none",
      harnessSha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
      initial: {
        sourceSha256: sha256(INITIAL_SOURCE),
        handlerResult: initialResult,
        stat: {
          size: initialStat.size,
          mtimeMs: initialStat.mtimeMs,
          ctimeMs: initialStat.ctimeMs,
        },
        importUrl: redactImportUrl(initialUrl),
      },
      edited: {
        sourceSha256: sha256(EDITED_SOURCE),
        handlerResult: editedResult,
        stat: {
          size: editedStat.size,
          mtimeMs: editedStat.mtimeMs,
          ctimeMs: editedStat.ctimeMs,
        },
        importUrl: redactImportUrl(editedUrl),
      },
      invariants: {
        sameBytes: editedStat.size === initialStat.size,
        sameMtime: editedStat.mtimeMs === initialStat.mtimeMs,
        ctimeChanged: editedStat.ctimeMs !== initialStat.ctimeMs,
        importUrlChanged: editedUrl !== initialUrl,
        behaviorChanged: initialResult === "before" && editedResult === "after!",
      },
      redaction: "Temporary paths are replaced with <redacted>; no credentials or user data used.",
      pass: true,
    };
    assert.deepEqual(observation.invariants, {
      sameBytes: true,
      sameMtime: true,
      ctimeChanged: true,
      importUrlChanged: true,
      behaviorChanged: true,
    });

    const log = [
      `head=${observation.headSha}`,
      `node=${observation.node}`,
      `initial.source.sha256=${observation.initial.sourceSha256}`,
      `edited.source.sha256=${observation.edited.sourceSha256}`,
      `initial.stat=${JSON.stringify(observation.initial.stat)}`,
      `edited.stat=${JSON.stringify(observation.edited.stat)}`,
      `initial.url=${observation.initial.importUrl}`,
      `edited.url=${observation.edited.importUrl}`,
      `handler.before=${initialResult}`,
      `handler.after=${editedResult}`,
      `invariants=${JSON.stringify(observation.invariants)}`,
      "result=PASS",
      "",
    ].join("\n");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, "observation.json"),
      `${JSON.stringify(observation, null, 2)}\n`,
    );
    fs.writeFileSync(path.join(outputDir, "proof.log"), log);
    process.stdout.write(log);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

void main();
