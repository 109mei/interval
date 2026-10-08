import { afterAll, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Count a scenario or input-plus-validation-contract once, never its expect calls. */
export type QualityCase = {
  id: string;
  category: string;
  inputs: unknown;
  assertions: readonly string[];
};

export type QualityResult = QualityCase & {
  status: "not-run" | "passed" | "failed";
  durationMs?: number;
  failure?: string;
};

/**
 * Individual Vitest names and this ledger share stable scenario IDs. A filtered
 * run records excluded scenarios as not-run, never as passed. No retry adds a
 * scenario to the manifest. Files default to /tmp, outside the source tree.
 */
export function createCaseLedger(suite: string) {
  const manifest: QualityCase[] = [];
  const results: QualityResult[] = [];
  const ids = new Set<string>();
  function registerCase(spec: QualityCase, run: () => void | Promise<void>) {
    if (ids.has(spec.id)) throw new Error(`Duplicate quality case: ${spec.id}`);
    if (!spec.assertions.length)
      throw new Error(`No assertion contract: ${spec.id}`);
    ids.add(spec.id);
    manifest.push(spec);
    const result: QualityResult = { ...spec, status: "not-run" };
    results.push(result);
    it(`${spec.id} | ${spec.category}`, async () => {
      const start = performance.now();
      try {
        await run();
        result.status = "passed";
      } catch (error) {
        result.status = "failed";
        result.failure =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        throw error;
      } finally {
        result.durationMs =
          Math.round((performance.now() - start) * 1000) / 1000;
      }
    });
  }

  afterAll(() => {
    const directory =
      process.env.QUALITY_LEDGER_DIR ?? "/tmp/interval-quality-ledgers";
    mkdirSync(directory, { recursive: true });
    const categories: Record<
      string,
      { registered: number; passed: number; failed: number; notRun: number }
    > = {};
    for (const result of results) {
      const summary = (categories[result.category] ??= {
        registered: 0,
        passed: 0,
        failed: 0,
        notRun: 0,
      });
      summary.registered++;
      if (result.status === "not-run") summary.notRun++;
      else summary[result.status]++;
    }
    writeFileSync(
      join(directory, `${suite}.json`),
      JSON.stringify(
        {
          schemaVersion: 1,
          suite,
          generatedAt: new Date().toISOString(),
          counting:
            "One unique scenario or input-plus-validation-contract per stable ID; individual expect assertions, transitions, and reruns are not extra cases.",
          count: manifest.length,
          categories,
          results,
        },
        null,
        2,
      ) + "\n",
    );
  });

  return { registerCase, manifest, results };
}
