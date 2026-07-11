// Minimal stub so modules that `import * as vscode from 'vscode'` can be
// loaded under Vitest, where the real `vscode` module (only available inside
// the VS Code extension host) does not exist. Only pure functions from those
// modules (e.g. panel.ts's buildHtml) are unit-tested; anything that actually
// touches the vscode API is exercised at runtime (F5), not here.
export {}
