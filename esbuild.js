const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const config = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    sourcemap: watch ? 'inline' : false,
    minify: !watch,
    logLevel: 'info',
};

async function main() {
    if (watch) {
        const ctx = await esbuild.context(config);
        await ctx.watch();
        console.log('esbuild watching...');
    } else {
        await esbuild.build(config);
        console.log('esbuild done');
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});