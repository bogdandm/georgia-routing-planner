import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const viteCli = fileURLToPath(
  new URL('../../node_modules/vite/bin/vite.js', import.meta.url),
);
const playwrightCli = fileURLToPath(
  new URL('../../node_modules/@playwright/test/cli.js', import.meta.url),
);
const basePath = '/georgia-routing-planner/';
const previewUrl = `http://127.0.0.1:4173${basePath}`;

function runCommand(command: string, arguments_: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: projectRoot,
      env: { ...process.env, BASE_PATH: basePath },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${String(code)}.`));
      }
    });
  });
}

async function waitForPreview(child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Vite preview exited early with code ${String(child.exitCode)}.`);
    }

    try {
      const response = await fetch(previewUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // The preview server is still starting.
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  throw new Error(`Vite preview did not become ready at ${previewUrl}.`);
}

async function stopPreview(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => {
      resolve();
    });
  });
  child.kill();
  await exited;
}

async function main(): Promise<void> {
  await runCommand(process.execPath, [viteCli, 'build']);
  const preview = spawn(
    process.execPath,
    [viteCli, 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
    {
      cwd: projectRoot,
      env: { ...process.env, BASE_PATH: basePath },
      stdio: 'inherit',
    },
  );

  try {
    await waitForPreview(preview);
    await runCommand(process.execPath, [playwrightCli, 'test']);
  } finally {
    await stopPreview(preview);
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Unknown Playwright runner failure.'}\n`,
  );
  process.exitCode = 1;
}
