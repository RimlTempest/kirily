/**
 * A job that builds the wasm also installs the thing that builds it.
 *
 * `mise.toml` pins rust, but not `wasm-pack` — that comes from
 * `cargo install`. CI's `typecheck` and `e2e` jobs both have that line;
 * `deploy` did not, and `bun run wasm:build` exited 127 on it.
 *
 * It survived because **deploy is `workflow_dispatch` only.** A workflow
 * nobody runs until they need it is a workflow that is broken exactly when it
 * is needed. Nothing else in the repo was ever going to notice, so the check
 * has to be static.
 *
 * Scoped to the job, not the file: jobs get their own runner, so a
 * `cargo install` in a sibling job installs nothing here.
 *
 * Run with: bun run tools/check-workflow-tools.ts
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type Problem = {
  readonly file: string
  readonly line: number
  readonly message: string
}

export type Job = {
  readonly name: string
  /** 1-based, of the `<name>:` line. */
  readonly line: number
  readonly body: string
}

/** What a job has to have run before it may run the left-hand command. */
const NEEDS: readonly (readonly [needle: string, provider: string])[] = [
  ['bun run wasm:build', 'cargo install wasm-pack'],
]

/**
 * Splits a workflow into its jobs by indentation.
 *
 * A real YAML parser would be better, and would be a dependency added for one
 * check over two files whose shape is fixed by GitHub (ADR-0009 — every
 * dependency is a way in). The structure being relied on is the one GitHub
 * requires: a top-level `jobs:` mapping whose keys are the job ids.
 */
export const splitJobs = (source: string): readonly Job[] => {
  const lines = source.split('\n')
  const start = lines.findIndex((text) => /^jobs:\s*$/.test(text))
  if (start < 0) return []

  const jobs: Job[] = []
  let current: { name: string; line: number; body: string[] } | null = null

  const close = (): void => {
    if (current !== null) jobs.push({ ...current, body: current.body.join('\n') })
    current = null
  }

  for (let index = start + 1; index < lines.length; index++) {
    const text = lines[index] ?? ''
    // Back to column 0 with content: `jobs:` is over.
    if (/^\S/.test(text)) break
    const header = /^ {2}(?<name>[\w-]+):\s*(?:#.*)?$/.exec(text)
    if (header?.groups?.['name'] !== undefined) {
      close()
      current = { name: header.groups['name'], line: index + 1, body: [] }
      continue
    }
    current?.body.push(text)
  }
  close()
  return jobs
}

/**
 * Order matters. Installing wasm-pack *after* the build that needs it is the
 * same failure with a longer log, so the provider has to come first.
 */
export const checkWorkflow = (file: string, source: string): readonly Problem[] => {
  const problems: Problem[] = []
  for (const job of splitJobs(source)) {
    for (const [needle, provider] of NEEDS) {
      const used = job.body.indexOf(needle)
      if (used < 0) continue
      const installed = job.body.indexOf(provider)
      if (installed >= 0 && installed < used) continue
      problems.push({
        file,
        line: job.line,
        message:
          installed < 0
            ? `job "${job.name}" runs \`${needle}\` without \`${provider}\`. It will exit 127.`
            : `job "${job.name}" runs \`${provider}\` after \`${needle}\`, which is too late.`,
      })
    }
  }
  return problems
}

const main = async (): Promise<void> => {
  const directory = '.github/workflows'
  const files = (await readdir(directory)).filter((name) => name.endsWith('.yml'))

  const problems: Problem[] = []
  let jobs = 0
  for (const name of files) {
    const path = join(directory, name)
    const source = await readFile(path, 'utf8')
    jobs += splitJobs(source).length
    problems.push(...checkWorkflow(path, source))
  }

  for (const problem of problems) {
    console.error(`::error file=${problem.file},line=${problem.line}::${problem.message}`)
  }
  if (problems.length > 0) {
    console.error(`${problems.length} job(s) are missing a tool they use.`)
    process.exit(1)
  }
  console.log(`${jobs} job(s) install what they run.`)
}

if (import.meta.main) await main()
