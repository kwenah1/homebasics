/**
 * Report tests that only passed on a retry (M10).
 *
 * CI retries twice, which is what keeps the pipeline usable - but a retried test is a test
 * that failed once, and without a report those failures are invisible until one of them
 * fails three times in a row and blocks a release. This turns them into a visible list in
 * the job summary, so flakiness is tracked rather than absorbed.
 *
 *   node scripts/flaky-report.mjs results/report.json
 */
import { appendFileSync, readFileSync } from 'node:fs'

const file = process.argv[2] ?? 'results/report.json'

let report
try {
  report = JSON.parse(readFileSync(file, 'utf8'))
} catch (error) {
  console.log(`no JSON report at ${file} (${error.code ?? error.message}) - nothing to report`)
  process.exit(0)
}

/** Walk the suite tree; Playwright nests suites per file and describe block. */
function* tests(suite, trail = []) {
  for (const child of suite.suites ?? []) yield* tests(child, [...trail, child.title])
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      yield { title: [...trail, spec.title].join(' › '), test, file: spec.file }
    }
  }
}

const flaky = []
for (const suite of report.suites ?? []) {
  for (const { title, test, file } of tests(suite)) {
    // 'flaky' is Playwright's own verdict: it failed, then passed on a retry.
    if (test.status === 'flaky') {
      const failures = test.results.filter((r) => r.status !== 'passed').length
      flaky.push({ title, file, project: test.projectName, failures })
    }
  }
}

const summary = process.env.GITHUB_STEP_SUMMARY
const lines = flaky.length
  ? [
      `### ⚠️ ${flaky.length} flaky test${flaky.length === 1 ? '' : 's'}`,
      '',
      'Passed only after a retry. Each one is a real failure that happened to go away.',
      '',
      '| Test | Project | Failed attempts |',
      '|---|---|---|',
      ...flaky.map((f) => `| \`${f.title}\` | ${f.project} | ${f.failures} |`),
    ]
  : ['### ✅ No flaky tests', '', 'Every test passed on its first attempt.']

console.log(lines.join('\n'))
if (summary) appendFileSync(summary, `${lines.join('\n')}\n`)

// Reporting only: a flake shouldn't fail a build that otherwise passed. The nightly
// flake hunt (repeat-each) is what turns a pattern of flakiness into a red build.
process.exit(0)
