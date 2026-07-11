const esbuild = require('esbuild')
const watch = process.argv.includes('--watch')

const options = {
  entryPoints: ['src/extension/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: true,
}

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options)
    await ctx.watch()
    console.log('esbuild watching...')
  } else {
    await esbuild.build(options)
    console.log('esbuild done')
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
