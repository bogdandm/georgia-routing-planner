const command = process.argv[2] ?? 'requested command';

process.stderr.write(
  `Catalog ${command} is intentionally unavailable until Phase 2. No files were changed.\n`,
);
process.exitCode = 2;
