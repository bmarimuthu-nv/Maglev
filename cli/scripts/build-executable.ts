import { dirname, isAbsolute, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_TARGETS = [
    'bun-darwin-x64',
    'bun-darwin-arm64',
    'bun-linux-x64-baseline',
    'bun-linux-x64-musl-baseline',
    'bun-linux-arm64',
    'bun-linux-arm64-musl',
    'bun-windows-x64'
];
const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'windows']);
const SUPPORTED_ARCHES = new Set(['x64', 'arm64']);
const SUPPORTED_LINUX_X64_VARIANTS = new Set(['baseline', 'modern']);
const SUPPORTED_LINUX_LIBCS = new Set(['glibc', 'musl']);

function getArg(args: string[], name: string): string | undefined {
    const idx = args.indexOf(name);
    if (idx === -1 || idx + 1 >= args.length) {
        return undefined;
    }
    return args[idx + 1];
}

function resolveHostPlatform(): string {
    if (process.platform === 'win32') {
        return 'windows';
    }
    if (process.platform === 'darwin' || process.platform === 'linux') {
        return process.platform;
    }
    throw new Error(`Unsupported host platform: ${process.platform}`);
}

function resolveHostArch(): string {
    if (SUPPORTED_ARCHES.has(process.arch)) {
        return process.arch;
    }
    throw new Error(`Unsupported host arch: ${process.arch}`);
}

function resolveDefaultTarget(): string {
    const platform = resolveHostPlatform();
    const arch = resolveHostArch();
    if (platform === 'linux' && arch === 'x64') {
        return 'bun-linux-x64-baseline';
    }
    return `bun-${platform}-${arch}`;
}

function resolveTarget(target?: string): string {
    if (!target) {
        return resolveDefaultTarget();
    }

    const parts = target.split('-');
    if (parts.length < 2 || parts.length > 5 || parts[0] !== 'bun') {
        throw new Error(`Invalid target: ${target}`);
    }

    const platformPart = parts[1];
    if (!SUPPORTED_PLATFORMS.has(platformPart)) {
        throw new Error(`Unsupported platform in target: ${target}`);
    }

    const archPart = parts[2] ?? resolveHostArch();
    if (!SUPPORTED_ARCHES.has(archPart)) {
        throw new Error(`Unsupported arch in target: ${target}`);
    }

    const extras = parts.slice(3);
    let variantPart: string | undefined;
    let libcPart: string | undefined;

    for (const extra of extras) {
        if (SUPPORTED_LINUX_X64_VARIANTS.has(extra)) {
            if (variantPart) {
                throw new Error(`Duplicate linux x64 variant in target: ${target}`);
            }
            variantPart = extra;
            continue;
        }
        if (SUPPORTED_LINUX_LIBCS.has(extra)) {
            if (libcPart) {
                throw new Error(`Duplicate libc in target: ${target}`);
            }
            libcPart = extra;
            continue;
        }
        throw new Error(`Unsupported target modifier: ${target}`);
    }

    if (libcPart && platformPart !== 'linux') {
        throw new Error(`Unsupported libc modifier in target: ${target}`);
    }

    if (variantPart && (platformPart !== 'linux' || archPart !== 'x64')) {
        throw new Error(`Unsupported linux x64 variant in target: ${target}`);
    }

    if (!variantPart && !libcPart) {
        return `bun-${platformPart}-${archPart}`;
    }

    const normalizedParts = [`bun-${platformPart}-${archPart}`];
    if (libcPart && libcPart !== 'glibc') {
        normalizedParts.push(libcPart);
    }
    if (variantPart) {
        normalizedParts.push(variantPart);
    }
    return normalizedParts.join('-');
}

function parseTarget(target: string): { platform: string; arch: string; libc: 'glibc' | 'musl' } {
    const parts = target.split('-');
    if ((parts.length < 3 || parts.length > 5) || parts[0] !== 'bun') {
        throw new Error(`Invalid target: ${target}`);
    }

    const platformPart = parts[1];
    const archPart = parts[2];

    if (!SUPPORTED_PLATFORMS.has(platformPart)) {
        throw new Error(`Unsupported platform in target: ${target}`);
    }

    if (!SUPPORTED_ARCHES.has(archPart)) {
        throw new Error(`Unsupported arch in target: ${target}`);
    }

    let libc: 'glibc' | 'musl' = 'glibc';

    for (const extra of parts.slice(3)) {
        if (SUPPORTED_LINUX_LIBCS.has(extra)) {
            if (platformPart !== 'linux') {
                throw new Error(`Unsupported libc modifier in target: ${target}`);
            }
            libc = extra as 'glibc' | 'musl';
            continue;
        }

        if (SUPPORTED_LINUX_X64_VARIANTS.has(extra)) {
            if (platformPart !== 'linux' || archPart !== 'x64') {
                throw new Error(`Unsupported variant in target: ${target}`);
            }
            continue;
        }

        throw new Error(`Unsupported target modifier: ${target}`);
    }

    return {
        platform: platformPart === 'windows' ? 'win32' : platformPart,
        arch: archPart,
        libc
    };
}

function resolveOutdir(projectRoot: string, outdir: string): string {
    if (isAbsolute(outdir)) {
        return outdir;
    }
    return join(projectRoot, outdir);
}

function writeStubEmbeddedAssets(workspaceRoot: string): void {
    const outputPath = join(workspaceRoot, 'hub', 'src', 'web', 'embeddedAssets.generated.ts');
    const contents = [
        '// This file is generated by cli/scripts/build-executable.ts when --with-web-assets is not used.',
        '// It intentionally contains no embedded assets.',
        '',
        'export interface EmbeddedWebAsset {',
        '    path: string;',
        '    sourcePath: string;',
        '    mimeType: string;',
        '}',
        '',
        'export const embeddedAssets: EmbeddedWebAsset[] = [];',
        ''
    ].join('\n');
    writeFileSync(outputPath, contents, 'utf-8');
}

function isStubEmbeddedAssets(manifestPath: string): boolean {
    try {
        const contents = readFileSync(manifestPath, 'utf-8');
        return contents.includes('intentionally contains no embedded assets');
    } catch {
        return false;
    }
}

function ensureEmbeddedAssetsManifest(workspaceRoot: string, includeWebAssets: boolean): void {
    const manifestPath = join(workspaceRoot, 'hub', 'src', 'web', 'embeddedAssets.generated.ts');
    if (includeWebAssets) {
        if (!existsSync(manifestPath)) {
            throw new Error(
                'Missing embedded web asset manifest. Run `bun run build:web` and `cd hub && bun run generate:embedded-web-assets`, or `bun run build:standalone` from the repo root.'
            );
        }
        if (isStubEmbeddedAssets(manifestPath)) {
            throw new Error(
                'Embedded web asset manifest is a stub. Run `bun run build:web` and `cd hub && bun run generate:embedded-web-assets`, or `bun run build:standalone` from the repo root.'
            );
        }
        return;
    }

    writeStubEmbeddedAssets(workspaceRoot);
}

async function buildTarget(projectRoot: string, target: string, outdir: string, name: string): Promise<void> {
    const { platform, arch, libc } = parseTarget(target);
    const outputName = platform === 'win32' ? `${name}.exe` : name;
    const outfile = join(outdir, target, outputName);
    mkdirSync(dirname(outfile), { recursive: true });

    const cmd = [
        process.execPath,
        'build',
        '--compile',
        '--no-compile-autoload-dotenv',
        `--target=${target}`,
        `--outfile=${outfile}`,
        join(projectRoot, 'src', 'bootstrap.ts')
    ];

    console.log(`[build:binary] ${cmd.join(' ')}`);

    const proc = Bun.spawn({
        cmd,
        env: process.env,
        stdout: 'inherit',
        stderr: 'inherit',
        cwd: projectRoot
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
        throw new Error(`Build failed for target ${target} (exit ${exitCode})`);
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const target = getArg(args, '--target');
    const outdirArg = getArg(args, '--outdir') ?? 'dist-exe';
    const name = getArg(args, '--name') ?? 'maglev';
    const buildAll = args.includes('--all');
    const includeWebAssets = args.includes('--with-web-assets');

    if (args.includes('--target') && !target) {
        console.error('Usage: bun run scripts/build-executable.ts [--target <bun-platform[-arch[-variant]]>] [--outdir dist-exe] [--name maglev] [--with-web-assets]');
        console.error('   or: bun run scripts/build-executable.ts --all [--outdir dist-exe] [--name maglev] [--with-web-assets]');
        process.exit(1);
    }

    if (!buildAll && !target) {
        console.log('[build:binary] No --target provided; defaulting to host platform + arch.');
    }

    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const projectRoot = join(scriptDir, '..');
    const workspaceRoot = join(projectRoot, '..');
    const outdir = resolveOutdir(projectRoot, outdirArg);
    const resolvedTarget = buildAll ? undefined : resolveTarget(target);
    const targets = buildAll ? DEFAULT_TARGETS : [resolvedTarget!];

    ensureEmbeddedAssetsManifest(workspaceRoot, includeWebAssets);

    for (const targetName of targets) {
        await buildTarget(projectRoot, targetName, outdir, name);
    }
}

main().catch((error) => {
    console.error(`[build:binary] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
