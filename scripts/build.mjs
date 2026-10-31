import { build } from 'esbuild';
await build({ entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode', 'sharp'], sourcemap: true });
console.log('Built dist/extension.js (sharp stays packaged as a runtime dependency)');
