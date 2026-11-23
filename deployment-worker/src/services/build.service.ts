
import fs from "node:fs/promises";
import path from "node:path";

import type { ProjectDocument } from "../types/deployment.types.js";

export interface BuildConfiguration {
  framework: string;
  packageManager: "npm" | "yarn" | "pnpm";
  installCommand: string;
  buildCommand: string;
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
  outputDir: string;
} {
  const dependencies = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  if (dependencies["next"]) {
    return { name: "Next.js", outputDir: ".next" };
  }

  if (dependencies["vite"]) {
    return { name: "Vite", outputDir: "dist" };
  }

  if (dependencies["react-scripts"]) {
    return { name: "Create React App", outputDir: "build" };
  }

  if (dependencies["@angular/core"]) {
    return { name: "Angular", outputDir: "dist" };
  }

  if (dependencies["nuxt"]) {
    return { name: "Nuxt", outputDir: ".output/public" };
  }

  if (dependencies["astro"]) {
    return { name: "Astro", outputDir: "dist" };
  }

  if (dependencies["@sveltejs/kit"]) {
    return { name: "SvelteKit", outputDir: "build" };
  }

  if (dependencies["vue"]) {
    return { name: "Vue", outputDir: "dist" };
  }

  if (dependencies["express"] || dependencies["fastify"]) {
    return { name: "Node.js", outputDir: "dist" };
  }

  return { name: "Unknown", outputDir: "dist" };
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
    throw new Error("Project root directory is outside the repository.");
  }

  const packageJsonPath = path.join(projectRoot, "package.json");

  if (!(await fileExists(packageJsonPath))) {
    throw new Error("package.json was not found in the project root.");
  }

  const packageJsonContent = await fs.readFile(
    packageJsonPath,
    "utf8",
  );

  const pkg = JSON.parse(packageJsonContent) as PackageJson;

  const files = await fs.readdir(projectRoot);

  const packageManager = detectPackageManager(files);

  const framework = detectFramework(pkg);

  const buildScript = pkg.scripts?.build;

  if (!buildScript) {
    throw new Error("No build script found in package.json.");
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
    packageManager,
    installCommand,
    buildCommand: project.buildCommand || `${packageManager} run build`,
    outputDir: project.outputDir || framework.outputDir,
    rootDir,
  };
}
