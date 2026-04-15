import type { EmbeddedWebAsset } from './embeddedAssets.generated';

let embeddedAssetMap: Map<string, EmbeddedWebAsset> | null = null;

export type { EmbeddedWebAsset };

export async function loadEmbeddedAssetMap(): Promise<Map<string, EmbeddedWebAsset>> {
    if (embeddedAssetMap) {
        return embeddedAssetMap;
    }

    // Bun build resolves the generated source reliably with the explicit extension here.
    // @ts-expect-error Runtime import path intentionally includes .ts for Bun bundling.
    const { embeddedAssets } = await import('./embeddedAssets.generated.ts');
    embeddedAssetMap = new Map(embeddedAssets.map((asset) => [asset.path, asset]));
    return embeddedAssetMap;
}
