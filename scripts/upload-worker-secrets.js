import {readFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {parseEnv} from 'node:util'

const devVarsPath = new URL('../.dev.vars', import.meta.url)

async function main() {
    const args = process.argv.slice(2).filter((arg) => arg !== '--')
    const dryRunIndex = args.indexOf('--dry-run')
    const dryRun = dryRunIndex !== -1
    if (dryRun) {
        args.splice(dryRunIndex, 1)
    }

    let contents
    try {
        contents = await readFile(devVarsPath, 'utf8')
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error('Missing .dev.vars. Copy .dev.vars.example to .dev.vars and fill in the provider values first.')
        }
        throw error
    }

    const secrets = Object.fromEntries(Object.entries(parseEnv(contents))
        .filter(([, value]) => String(value).trim()))
    const names = Object.keys(secrets)

    if (names.length === 0) {
        throw new Error('No non-empty variables were found in .dev.vars.')
    }

    if (dryRun) {
        console.log(`Would upload ${names.length} Worker secret(s): ${names.join(', ')}`)
        return
    }

    console.log(`Uploading ${names.length} Worker secret(s): ${names.join(', ')}`)
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    const result = spawnSync(pnpm, ['exec', 'wrangler', 'secret', 'bulk', ...args], {
        input: JSON.stringify(secrets),
        stdio: ['pipe', 'inherit', 'inherit'],
    })

    if (result.error) {
        throw result.error
    }
    if (result.status !== 0) {
        throw new Error(`Wrangler exited with status ${result.status}`)
    }
}

main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
})
