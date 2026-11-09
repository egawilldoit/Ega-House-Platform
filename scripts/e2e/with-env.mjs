import { spawn } from "node:child_process";
import { readLocalEnvironment } from "./local-env.cjs";

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("Pass a command to run against the disposable backend.");
const child = spawn(command, args, { stdio: "inherit", env: { ...process.env, ...readLocalEnvironment() } });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", () => { process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
