import assert from "node:assert/strict";
import fs from "node:fs";

const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const log = fs.readFileSync(process.argv[3], "utf8").replace(/\u001b\[[0-9;]*m/g, "");
assert.equal(report.numTotalTests, 7);
assert.equal(report.numFailedTests, 4);
assert.equal(report.numPassedTests, 3);
assert.equal(report.numPendingTests, 0);
const expectedFailures = new Map([
  ["shows the recorded docker runtime", "docker"],
  ["shows the recorded podman runtime", "podman"],
  ["does not confuse runtime identity with container state missing", "podman"],
  ["does not confuse runtime identity with container state unknown", "podman"],
]);
const expectedPasses = new Set([
  "leaves docker JSON unchanged",
  "leaves podman JSON unchanged",
  "preserves service errors without emitting a partial status",
]);
const assertions = report.testResults.flatMap((suite) => suite.assertionResults);
assert.equal(assertions.length, 7);
for (const result of assertions) {
  const runtime = expectedFailures.get(result.title);
  if (runtime) {
    assert.equal(result.status, "failed", result.title);
    assert.equal(result.failureMessages.length, 1, result.title);
    const message = result.failureMessages[0];
    assert.match(message, /AssertionError/);
    assert.match(message, /to (?:deeply equal|include)/);
    if (result.title.startsWith("shows the recorded")) {
      // JSON reporter abbreviates array values; retain the console diff as the cause evidence.
      assert.match(message, /commands\.status-runtime\.test\.ts:42:31/);
      assert.match(log, new RegExp(`-\\s+"Runtime: ${runtime}",`));
    } else {
      assert.ok(message.includes(`Runtime: ${runtime}`), message);
      assert.match(message, /commands\.status-runtime\.test\.ts:78:33/);
    }
    expectedFailures.delete(result.title);
  } else {
    assert.ok(expectedPasses.delete(result.title), result.title);
    assert.equal(result.status, "passed", result.title);
    assert.deepEqual(result.failureMessages, []);
  }
}
assert.equal(expectedFailures.size, 0);
assert.equal(expectedPasses.size, 0);
console.log("Verified four missing Runtime assertion failures and three unchanged-contract passes.");
