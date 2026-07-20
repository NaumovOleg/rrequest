const esbuild = require('esbuild')
const fs = require('node:fs')
const watch = process.argv.includes('--watch')

const options = {
  entryPoints: ['src/extension/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['vscode', 'bufferutil', 'utf-8-validate', '@grpc/grpc-js', '@grpc/proto-loader'],
  outfile: 'dist/extension.js',
  sourcemap: true,
}

function copyCodicons() {
  fs.mkdirSync('media', { recursive: true })
  const src = 'node_modules/@vscode/codicons/dist'
  fs.copyFileSync(`${src}/codicon.css`, 'media/codicon.css')
  fs.copyFileSync(`${src}/codicon.ttf`, 'media/codicon.ttf')
}

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options)
    await ctx.watch()
    copyCodicons()
    console.log('esbuild watching...')
  } else {
    await esbuild.build(options)
    copyCodicons()
    console.log('esbuild done')
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
