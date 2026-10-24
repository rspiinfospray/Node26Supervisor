import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export class Workspace {
  public constructor(private readonly directory: string) {}

  public async changedFiles(): Promise<string[]> {
    const { stdout } = await execute("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: this.directory, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    return stdout.split(/\r?\n/).filter(Boolean).map(line => line.slice(3).split(" -> ").at(-1)!.replaceAll("\\", "/"));
  }

  public async snapshot(): Promise<Record<string, string>> {
    const files = await this.changedFiles();
    const entries = await Promise.all(files.map(async file => [file, await this.fingerprint(file)] as const));
    return Object.fromEntries(entries);
  }

  public async changedSince(before: Record<string, string>): Promise<string[]> {
    const after = await this.snapshot();
    return Object.keys(after).filter(file => before[file] !== after[file]);
  }

  public async buildAndTest(): Promise<string> { return this.run("docker", ["compose", "build", "backend"], 20 * 60_000); }
  public async deploy(): Promise<string> { return this.run("docker", ["compose", "up", "-d", "backend"], 10 * 60_000); }

  private async run(command: string, arguments_: string[], timeout: number): Promise<string> {
    try {
      const { stdout, stderr } = await execute(command, arguments_, { cwd: this.directory, windowsHide: true, timeout, maxBuffer: 30 * 1024 * 1024 });
      return `${stdout}\n${stderr}`.trim();
    } catch (error) {
      const details = error as Error & { stdout?: string; stderr?: string };
      throw new Error(`${command} ${arguments_.join(" ")} a échoué : ${details.stderr || details.stdout || details.message}`);
    }
  }

  private async fingerprint(relativePath: string): Promise<string> {
    try { return createHash("sha256").update(await readFile(path.resolve(this.directory, relativePath))).digest("hex"); }
    catch { return "<absent>"; }
  }
}
