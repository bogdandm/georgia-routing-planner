import { fileURLToPath } from 'node:url';

import {
  createBenchmarkScenarios,
  runTerrariumBenchmark,
  type TerrariumBenchmarkReport,
} from './terrariumBenchmark';

function readIntegerArgument(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative integer.`);
  return value;
}

function formatTable(report: TerrariumBenchmarkReport): string {
  const rows = report.scenarios.map((scenario) => ({
    scenario: scenario.name,
    referenceMedian: scenario.reference.medianMs.toFixed(2),
    candidateMedian: scenario.candidate.medianMs.toFixed(2),
    referenceP95: scenario.reference.p95Ms.toFixed(2),
    candidateP95: scenario.candidate.p95Ms.toFixed(2),
  }));
  return [
    'Terrarium filter benchmark (milliseconds per tile)',
    consoleTable(rows),
    `Combined median improvement: ${report.combined.medianImprovementPercent.toFixed(1)}%`,
    `Maximum scenario p95 regression: ${report.combined.maximumP95RegressionPercent.toFixed(1)}%`,
  ].join('\n');
}

function consoleTable(rows: readonly Readonly<Record<string, string>>[]): string {
  const columns = [
    'scenario',
    'referenceMedian',
    'candidateMedian',
    'referenceP95',
    'candidateP95',
  ] as const;
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => row[column]?.length ?? 0)),
  );
  const line = (row: Readonly<Record<string, string>>) =>
    columns
      .map((column, index) => (row[column] ?? '').padEnd(widths[index] ?? 0))
      .join('  ');
  return [
    line(Object.fromEntries(columns.map((column) => [column, column]))),
    ...rows.map(line),
  ].join('\n');
}

export function main(): void {
  const iterations = readIntegerArgument('--iterations', 30);
  if (iterations < 30) throw new RangeError('--iterations must be at least 30.');
  const warmupIterations = readIntegerArgument('--warmup', 5);
  const seed = readIntegerArgument('--seed', 2_026_072_000);
  const report = runTerrariumBenchmark(
    createBenchmarkScenarios(seed),
    iterations,
    warmupIterations,
  );
  process.stderr.write(`${formatTable(report)}\n`);
  process.stdout.write(
    `${JSON.stringify(report, null, process.argv.includes('--json') ? 2 : 0)}\n`,
  );
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1])
  main();
