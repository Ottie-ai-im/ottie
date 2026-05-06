import type { Command } from "commander";
import chalk from "chalk";
import { loadRootIdentity, resolveOttieHome } from "@ottie/server";

interface IdentityShowOptions {
  home?: string;
  json?: boolean;
}

export async function runIdentityShowCommand(
  options: IdentityShowOptions,
  command: Command,
): Promise<void> {
  // Subcommand --json (via addJsonOption) AND the global --json on the root
  // program both have to be honored — `optsWithGlobals` walks the parent
  // chain and merges. `--format json` (global) is also accepted as an alias.
  const merged = command.optsWithGlobals();
  const wantJson =
    options.json === true ||
    merged.json === true ||
    (typeof merged.format === "string" && merged.format.toLowerCase() === "json");

  const env = options.home ? { ...process.env, OTTIE_HOME: options.home } : process.env;
  const ottieHome = resolveOttieHome(env);

  let bundle: ReturnType<typeof loadRootIdentity> = null;
  let loadError: Error | null = null;
  try {
    bundle = loadRootIdentity(ottieHome);
  } catch (err) {
    loadError = err instanceof Error ? err : new Error(String(err));
  }

  if (wantJson) {
    if (loadError) {
      console.log(
        JSON.stringify({
          state: "load-failed",
          ottieHome,
          error: loadError.message,
        }),
      );
      process.exitCode = 1;
      return;
    }
    if (!bundle) {
      console.log(JSON.stringify({ state: "uninitialized", ottieHome }));
      return;
    }
    console.log(
      JSON.stringify({
        state: "loaded",
        ottieHome,
        v: bundle.stored.v,
        displayName: bundle.stored.displayName,
        rootSignPublicKeyB64: bundle.stored.signPublicKeyB64,
        createdAt: bundle.stored.createdAt,
      }),
    );
    return;
  }

  // Human-readable output
  console.log(chalk.dim(`Ottie home: ${ottieHome}`));

  if (loadError) {
    console.log();
    console.log(chalk.red("State: load-failed"));
    console.log(`  ${loadError.message}`);
    console.log();
    console.log(
      chalk.yellow("The daemon will not auto-regenerate your identity. Inspect or remove"),
    );
    console.log(chalk.yellow(`the corrupt file manually at ${ottieHome}/identity/root.json.`));
    process.exitCode = 1;
    return;
  }

  if (!bundle) {
    console.log();
    console.log(chalk.yellow("State: uninitialized"));
    console.log();
    console.log("No identity yet. Open the ottie app and finish onboarding to create one.");
    return;
  }

  const fingerprint = bundle.stored.signPublicKeyB64.slice(0, 8);
  console.log();
  console.log(
    `${chalk.bold("Display name:")}  ${bundle.stored.displayName} ${chalk.dim(`(${fingerprint})`)}`,
  );
  console.log(`${chalk.bold("Root pubkey:")}   ${bundle.stored.signPublicKeyB64}`);
  console.log(`${chalk.bold("Created:")}       ${bundle.stored.createdAt}`);
}
