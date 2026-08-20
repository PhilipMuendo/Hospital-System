/**
 * Test runner.
 *
 * Provisions an isolated database, migrates and seeds it, starts an API
 * against it on a separate port, runs the suites, and tears the server down.
 *
 * The isolation is the point. These suites register patients, settle bills and
 * chart medication; pointed at a real database they would corrupt a hospital's
 * records. `assertSafeDatabase()` refuses to run unless the target is a
 * distinct database with "test" in its name.
 *
 * Usage:
 *   npm --prefix server run test:e2e
 *   npm --prefix server run test:load
 */
// The runner reads TEST_DATABASE_URL from .env, same as the server does.
import 'dotenv/config'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { assertSafeDatabase, waitForApi } from './harness.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(here, '..')

const TEST_PORT = process.env.TEST_PORT ?? '4001'
const suites = process.argv.slice(2)

if (suites.length === 0) {
  console.error('Usage: tsx tests/run-e2e.ts <suite.ts> [...]')
  process.exit(1)
}

assertSafeDatabase()

const testEnv = {
  ...process.env,
  DATABASE_URL: process.env.TEST_DATABASE_URL!,
  NODE_ENV: 'test',
  PORT: TEST_PORT,
  // Mocked so no test can reach Safaricom, SHA or a control unit.
  MPESA_MOCK: 'true',
  SHA_MOCK: 'true',
  ETIMS_MOCK: 'true',
  MPESA_CALLBACK_SECRET: 'test-callback-secret-not-for-production-use',
  // The MLLP listener would fight for a port across parallel runs.
  HL7_MLLP_ENABLED: 'false',
}

function run(command: string, args: string[], label: string) {
  process.stdout.write(`→ ${label}… `)
  const result = spawnSync(command, args, { cwd: serverRoot, env: testEnv, shell: true, encoding: 'utf8' })
  if (result.status !== 0) {
    console.log('failed\n')
    console.error(result.stdout ?? '')
    console.error(result.stderr ?? '')
    process.exit(1)
  }
  console.log('ok')
}

console.log(`\nTest database: ${maskUrl(process.env.TEST_DATABASE_URL!)}`)
run('npx', ['prisma', 'migrate', 'deploy'], 'applying migrations')
run('npx', ['tsx', 'prisma/seed.ts'], 'seeding')

let server: ChildProcess | null = null

async function main() {
  process.stdout.write(`→ starting API on :${TEST_PORT}… `)
  server = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: serverRoot,
    env: testEnv,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Captured rather than inherited, so a stack trace from the server does not
  // interleave with test output — but kept, so a crash is diagnosable.
  const serverLog: string[] = []
  server.stdout?.on('data', (d) => serverLog.push(String(d)))
  server.stderr?.on('data', (d) => serverLog.push(String(d)))

  server.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error('\nAPI exited unexpectedly:\n' + serverLog.join(''))
    }
  })

  try {
    await waitForApi()
  } catch (err) {
    console.log('failed')
    console.error(serverLog.join(''))
    throw err
  }
  console.log('ok\n')

  const result = spawnSync(
    'npx',
    ['tsx', '--test', '--test-reporter=spec', ...suites.map((s) => `tests/${s}`)],
    { cwd: serverRoot, env: testEnv, shell: true, stdio: 'inherit' },
  )

  return result.status ?? 1
}

function shutdown() {
  if (server && !server.killed) {
    // The tree, not just the shell wrapper npx spawned.
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      server.kill('SIGTERM')
    }
  }
}

function maskUrl(url: string) {
  return url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@')
}

process.on('SIGINT', () => {
  shutdown()
  process.exit(130)
})

main()
  .then((code) => {
    shutdown()
    process.exit(code)
  })
  .catch((err) => {
    console.error(err)
    shutdown()
    process.exit(1)
  })
