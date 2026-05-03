import { execFileSync } from "node:child_process";

let pathFixed = false;

/**
 * Ensures that the process's PATH environment variable includes the directories
 * defined in the user's interactive shell (e.g., /opt/homebrew/bin).
 * 
 * GUI applications on macOS (like the Tauri bundle) do not inherit shell profile 
 * environment variables by default. This function replicates the "fix-path" logic 
 * used by Paseo and VS Code to restore a usable environment.
 */
export function fixPathEnv(): void {
  if (pathFixed || process.platform !== "darwin") {
    return;
  }

  try {
    // 1. Resolve the user's login shell. Default to zsh as it is the standard on macOS.
    const userShell = process.env.SHELL || "/bin/zsh";
    
    // 2. Run the shell in "login" and "interactive" mode to force it to load profile scripts
    // like .zshrc or .bash_profile, then print the resulting PATH.
    // -l: login shell
    // -c: run command
    const output = execFileSync(userShell, ["-lc", "echo $PATH"], {
      encoding: "utf8",
      env: { ...process.env, LANG: "en_US.UTF-8" },
      timeout: 3000,
    });

    const parsedPath = output.trim();
    
    // 3. Overwrite the process's PATH if we got a non-empty result.
    if (parsedPath) {
      process.env.PATH = parsedPath;
      pathFixed = true;
      // We don't log here yet because the logger hasn't been initialized
      // at the time this is usually called.
    }
  } catch (error) {
    // Best-effort only. If the shell fails to start or times out, 
    // we continue with the existing (limited) environment.
  }
}
