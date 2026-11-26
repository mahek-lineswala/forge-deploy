/** Result of the build stage, consumed by the static or runtime publish stage. */

interface BaseBuildResult {
  deploymentId: string;
  framework: string;
  deploymentType: "STATIC" | "RUNTIME";
  buildLogs: string;
  durationMs: number;
}

export interface StaticBuildResult extends BaseBuildResult {
  deploymentType: "STATIC";
  outputPath: string;
}

export interface RuntimeBuildResult extends BaseBuildResult {
  deploymentType: "RUNTIME";
  sourcePath: string;
  rootDir: string;
  /** Project root inside the build's workspace volume (POSIX, relative). */
  projectPath: string;
  startCommand: string;
}

export type ProcessBuildResult =
  | StaticBuildResult
  | RuntimeBuildResult;
