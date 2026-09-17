import { Command, Option } from "commander";
import { describe, expect, it } from "vitest";
import { runGeneratedBashCompletion } from "./completion-cli.test-support.js";
import { collectShellCompletionCommandTree } from "./completion-command-tree.js";

function createShadowedOptionProgram(optional = false) {
  const program = new Command()
    .name("openclaw")
    .enablePositionalOptions()
    .option(optional ? "-m, --mode [value]" : "-m, --mode <value>");
  const group = program.command("group").option("--mode");
  const show = group
    .command("show")
    .option("--json")
    .action(() => {});
  return { program, group, show };
}

describe("completion value-option shadowing", () => {
  it.each([false, true])(
    "keeps the nearest boolean contract when the parent optional=%s",
    (optional) => {
      const { program, group, show } = createShadowedOptionProgram(optional);
      program.parse(["group", "--mode", "show", "--json"], { from: "user" });
      expect(group.opts()).toEqual({ mode: true });
      expect(show.opts()).toEqual({ json: true });

      const tree = collectShellCompletionCommandTree(program);
      expect(tree.root.valueOptions).toEqual(["-m", "--mode"]);
      expect(tree.descendants.map(({ valueOptions }) => valueOptions)).toEqual([["-m"], ["-m"]]);
    },
  );

  it("retains a local value-taking replacement without duplicating its inherited flag", () => {
    const { program, show } = createShadowedOptionProgram();
    show.addOption(new Option("--mode <value>").choices(["local"]));
    const context = collectShellCompletionCommandTree(program).descendants[1];
    expect(context?.valueOptions).toEqual(["-m", "--mode"]);
    expect(context?.valueChoices).toEqual([
      { flags: ["--mode"], choices: ["local"], requiresValue: true },
    ]);
  });

  it.skipIf(process.platform === "win32").each([false, true])(
    "completes the nested command after its boolean override when parent optional=%s",
    (optional) => {
      expect(
        runGeneratedBashCompletion(createShadowedOptionProgram(optional).program, [
          "openclaw",
          "group",
          "--mode",
          "show",
          "--j",
        ]),
      ).toEqual(["--json"]);
    },
  );

  it.skipIf(process.platform === "win32")("still consumes the unshadowed parent alias", () => {
    expect(
      runGeneratedBashCompletion(createShadowedOptionProgram().program, [
        "openclaw",
        "-m",
        "group",
        "group",
        "show",
        "--j",
      ]),
    ).toEqual(["--json"]);
  });
});
