import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const testsDir = path.join(rootDir, "src", "__tests__");
const vitestCli = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const nextPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTestFiles(nextPath)));
      continue;
    }
    if (/\.test\.(ts|tsx)$/.test(entry.name)) {
      files.push(nextPath);
    }
  }

  return files.sort();
}

async function runVitestFile(testFile) {
  const relativePath = path.relative(rootDir, testFile);
  process.stdout.write(`\n[vitest] ${relativePath}\n`);

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vitestCli, "run", relativePath], {
      cwd: rootDir,
      env: process.env,
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Vitest failed for ${relativePath} with exit code ${code ?? "unknown"}.`));
    });

    child.on("error", reject);
  });
}

const testFiles = await collectTestFiles(testsDir);
for (const testFile of testFiles) {
  await runVitestFile(testFile);
}
