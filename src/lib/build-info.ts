// Server-only: runs git at render time. Never import from a "use client" file.
// With `output: "export"` the page renders once during `next build`, so production
// values are frozen to the deployed commit; `next dev` re-renders per request and
// tracks the live working tree.
import { execSync } from "node:child_process";
import pkg from "../../package.json";

export const REPO_URL = "https://github.com/redomar/ofp-planner";
export const OWNER = "Mohamed Omar";
export const FIRST_YEAR = 2026;

function git(args: string): string | null {
  try {
    const out = execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

/** Commit from CI/platform env when .git isn't available in the build. */
function envCommit(): string | null {
  const sha = process.env.SOURCE_COMMIT ?? process.env.GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA;
  return sha ? sha.slice(0, 7) : null;
}

export interface BuildInfo {
  version: string;
  commit: string | null;
  commitUrl: string | null;
  branch: string | null;
  dirty: boolean;
  builtAt: Date;
  environment: string;
}

export function getBuildInfo(): BuildInfo {
  const commit = git("rev-parse --short HEAD") ?? envCommit();
  const branch = git("rev-parse --abbrev-ref HEAD");
  // null status (no git) is treated as clean; excludes dirs build tools may write into the context
  const status = git("status --porcelain -- . ':!.nixpacks'");
  return {
    version: pkg.version,
    commit,
    commitUrl: commit ? `${REPO_URL}/commit/${commit}` : null,
    branch: branch && branch !== "HEAD" ? branch : null,
    dirty: Boolean(status),
    builtAt: new Date(),
    environment: process.env.NODE_ENV ?? "unknown",
  };
}

/** "2026-09-29 12:05 UTC" */
export function fmtBuilt(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
