/**
 * Detects framework, deployment type (STATIC/RUNTIME), package manager and the
 * install/build/start commands from package.json and project settings.
 */
import fs from "node:fs/promises";
import path from "node:path";

import type { ProjectDocument } from "../../types/deployment.types.js";
import { NonRetryableError } from "../../utils/errors.js";

export type DeploymentType = "STATIC" | "RUNTIME";

export interface BuildConfiguration {
  framework: string;
  deploymentType: DeploymentType;
  packageManager: "npm" | "yarn" | "pnpm";
  installCommand: string;
  buildCommand: string;
  startCommand: string | null;
  outputDir: string;
  rootDir: string;
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function detectPackageManager(
  files: string[],
): BuildConfiguration["packageManager"] {
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";

  return "npm";
}

function detectFramework(pkg: PackageJson): {
  name: string;
  deploymentType: DeploymentType;
  outputDir: string;
} {
  const dependencies = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  if (dependencies["next"]) {
    return {
      name: "Next.js",
      deploymentType: "RUNTIME",
      outputDir: ".next",
    };
  }

  if (dependencies["vite"]) {
    return {
      name: "Vite",
      deploymentType: "STATIC",
      outputDir: "dist",
    };
  }

  if (dependencies["react-scripts"]) {
    return {
      name: "Create React App",
      deploymentType: "STATIC",
      outputDir: "build",
    };
  }

  if (dependencies["@angular/core"]) {
    return {
      name: "Angular",
      deploymentType: "STATIC",
      outputDir: "dist",
    };
  }

  if (dependencies["nuxt"]) {
    return {
      name: "Nuxt",
      deploymentType: "RUNTIME",
      outputDir: ".output",
    };
  }

  if (dependencies["astro"]) {
    return {
      name: "Astro",
      deploymentType: "STATIC",
      outputDir: "dist",
    };
  }

  if (dependencies["@sveltejs/kit"]) {
    return {
      name: "SvelteKit",
      deploymentType: "RUNTIME",
      outputDir: "build",
    };
  }

  if (dependencies["vue"]) {
    return {
      name: "Vue",
      deploymentType: "STATIC",
      outputDir: "dist",
    };
  }

  if (dependencies["express"] || dependencies["fastify"]) {
    return {
      name: "Node.js",
      deploymentType: "RUNTIME",
      outputDir: "dist",
    };
  }

  return {
    name: "Unknown",
    deploymentType: "STATIC",
    outputDir: "dist",
  };
}

export async function detectBuildConfiguration(
  sourceDir: string,
  project: ProjectDocument,
): Promise<BuildConfiguration> {
  const rootDir = project.rootDir || ".";
  const projectRoot = path.resolve(sourceDir, rootDir);
  const relative = path.relative(path.resolve(sourceDir), projectRoot);

  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new NonRetryableError(
      "Project root directory is outside the repository.",
    );
  }

  const packageJsonPath = path.join(projectRoot, "package.json");

  if (!(await fileExists(packageJsonPath))) {
    throw new NonRetryableError(
      "package.json was not found in the project root.",
    );
  }

  const packageJsonContent = await fs.readFile(packageJsonPath, "utf8");

  let pkg: PackageJson;

  try {
    pkg = JSON.parse(packageJsonContent) as PackageJson;
  } catch {
    throw new NonRetryableError("package.json is not valid JSON.");
  }

  const files = await fs.readdir(projectRoot);
  const packageManager = detectPackageManager(files);
  const framework = detectFramework(pkg);

  const buildCommand =
  project.buildCommand ||
  (pkg.scripts?.build ? `${packageManager} run build` : "true");

  const startCommand =
    project.startCommand || pkg.scripts?.start || null;

  if (framework.deploymentType === "RUNTIME" && !startCommand) {
    throw new NonRetryableError(
      "Runtime application requires a start command. Configure one in project settings or package.json.",
    );
  }

  if (framework.deploymentType === "STATIC" && !pkg.scripts?.build) {
    throw new NonRetryableError(
      "No build script found in package.json.",
    );
  }

  let installCommand: string;

  switch (packageManager) {
    case "pnpm":
      installCommand = files.includes("pnpm-lock.yaml")
        ? "corepack pnpm install --frozen-lockfile"
        : "corepack pnpm install";
      break;

    case "yarn":
      installCommand = files.includes("yarn.lock")
        ? "corepack yarn install --immutable"
        : "corepack yarn install";
      break;

    default:
      installCommand = files.includes("package-lock.json")
        ? "npm ci"
        : "npm install";
  }

  return {
    framework: project.framework || framework.name,
    deploymentType: framework.deploymentType,
    packageManager,
    installCommand,
    buildCommand,
    startCommand,
    outputDir: project.outputDir || framework.outputDir,
    rootDir,
  };
}
