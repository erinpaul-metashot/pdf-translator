import type { MuPdfRuntime } from './types';

function getPublicAssetPrefix(): string {
  const nextData = (globalThis as { __NEXT_DATA__?: { assetPrefix?: string } }).__NEXT_DATA__;
  const assetPrefix = nextData?.assetPrefix ?? '';
  if (assetPrefix) {
    return assetPrefix.endsWith('/') ? assetPrefix.slice(0, -1) : assetPrefix;
  }

  if (typeof window === 'undefined') {
    return '';
  }

  const currentPath = window.location.pathname.replace(/\/+$/, '');
  const routePath = '/pdf-to-editable-html';
  if (currentPath === routePath || currentPath.endsWith(routePath)) {
    return currentPath.slice(0, -routePath.length);
  }

  return '';
}

export async function loadMuPdfRuntime(): Promise<MuPdfRuntime> {
  const assetPrefix = getPublicAssetPrefix();
  const mupdfBasePath = `${assetPrefix}/mupdf`;

  globalThis.$libmupdf_wasm_Module = {
    locateFile: (fileName: string) => `${mupdfBasePath}/${fileName}`,
    printErr: (...args: unknown[]) => {
      const message = args.map(String).join(' ');
      if (message.includes('Actualtext with no position')) {
        return;
      }
      console.warn(message);
    },
  };

  const mupdfModule = (await import(
    /* webpackIgnore: true */ `${mupdfBasePath}/mupdf.js`
  )) as {
    default: MuPdfRuntime;
  };

  return mupdfModule.default;
}
