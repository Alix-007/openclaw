import { Command } from "commander";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { registerFleetCli } = await import(
  pathToFileURL(path.resolve("src/cli/fleet-cli/register.ts")).href
);
const program = new Command();
program.name("openclaw");
registerFleetCli(program);
await program.parseAsync(["fleet", "status", ...process.argv.slice(2)], { from: "user" });
