import { Command } from "commander";
import { addJsonOption } from "../../utils/command-options.js";
import { runIdentityShowCommand } from "./show.js";

export function createIdentityCommand(): Command {
  const identity = new Command("identity").description("Manage your ottie root identity");

  addJsonOption(identity.command("show").description("Show the root identity for this $OTTIE_HOME"))
    .option("--home <path>", "Ottie home directory (default: ~/.ottie)")
    .action(runIdentityShowCommand);

  return identity;
}
