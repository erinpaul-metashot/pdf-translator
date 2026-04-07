import type { NormalizedMuPdfPage } from './types';

export function createDownload(content: BlobPart, type: string, fileName: string): void {
  const blob = new Blob([content], { type });
  const blobUrl = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(blobUrl);
}

export function buildPortableHtml(pages: NormalizedMuPdfPage[]): string {
  const uniqueMuPdfStyles = Array.from(new Set(pages.flatMap((page) => page.headStyleCssBlocks)));
  const muPdfStyleTags = uniqueMuPdfStyles
    .map((cssText) => ['  <style>', cssText, '  </style>'].join('\n'))
    .join('\n');

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '  <meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; font-src data: blob:; connect-src \'none\'; media-src \'none\'; frame-src \'none\';" />',
    '  <title>Converted PDF HTML</title>',
    '  <style>',
    '    body { margin: 0; padding: 24px; background: #e2e8f0; font-family: Helvetica, Arial, sans-serif; }',
    '    .pdf-document { display: grid; gap: 24px; justify-content: center; }',
    '    .pdf-page { overflow: hidden; border-radius: 8px; }',
    '    .pdf-page { position: relative; margin: 0 auto 20px auto; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12); background: white; }',
    '    body.show-edited-text .pdf-page [data-edited="true"], body.show-edited-text .pdf-page [data-edited="true"] * { background: #fef08a !important; }',
    '    .pdf-page-underlay { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }',
    '    .pdf-page-underlay > svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }',
    '    .pdf-page p { position: absolute; z-index: 1; margin: 0; white-space: pre; }',
    '    .pdf-page img { position: absolute; z-index: 1; max-width: none; }',
    '    .pdf-page > svg { position: absolute; z-index: 1; overflow: visible; }',
    '  </style>',
    muPdfStyleTags,
    '</head>',
    '<body>',
    '  <div class="pdf-document">',
    pages.map((page) => page.pageHtml).join('\n'),
    '  </div>',
    '</body>',
    '</html>',
  ].join('\n');
}

export function buildPdfPrintHtml(sourceHtml: string, documentTitle: string): string {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(sourceHtml, 'text/html');

  parsed.title = documentTitle;

  const printStyle = parsed.createElement('style');
  printStyle.textContent = [
    '@page { margin: 0; }',
    'html, body { margin: 0 !important; padding: 0 !important; background: #ffffff !important; }',
    'body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }',
    '.pdf-document { display: block !important; gap: 0 !important; }',
    '.pdf-page { margin: 0 auto !important; box-shadow: none !important; border-radius: 0 !important; break-after: page; page-break-after: always; }',
    '.pdf-page:last-child { break-after: auto; page-break-after: auto; }',
  ].join('\n');

  parsed.head.appendChild(printStyle);

  return ['<!doctype html>', parsed.documentElement.outerHTML].join('\n');
}

export function printHtmlWithHiddenIframe(printableHtml: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.top = '0';
    iframe.style.left = '0';
    iframe.style.width = '100vw';
    iframe.style.height = '100vh';
    iframe.style.visibility = 'hidden';
    iframe.style.opacity = '0';
    iframe.style.zIndex = '-1';
    iframe.style.border = '0';
    iframe.style.pointerEvents = 'none';

    let hasTriggeredPrint = false;
    let hasFinalized = false;
    let hasSettled = false;
    let fallbackTimeout: ReturnType<typeof setTimeout> | null = null;
    let loadFallbackTimeout: ReturnType<typeof setTimeout> | null = null;
    let printEventTarget: Window | null = null;

    const finalize = (error?: Error) => {
      if (hasFinalized) {
        return;
      }

      hasFinalized = true;

      if (fallbackTimeout) {
        clearTimeout(fallbackTimeout);
        fallbackTimeout = null;
      }

      if (loadFallbackTimeout) {
        clearTimeout(loadFallbackTimeout);
        loadFallbackTimeout = null;
      }

      if (printEventTarget) {
        printEventTarget.removeEventListener('afterprint', handleAfterPrint);
      }

      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }

      if (error && !hasSettled) {
        hasSettled = true;
        reject(error);
      }
    };

    const handleAfterPrint = () => {
      finalize();
    };

    const waitForFrameAssets = async (frameDoc: Document): Promise<void> => {
      const imagePromises = Array.from(frameDoc.images).map((image) => {
        if (image.complete) {
          return Promise.resolve();
        }

        return new Promise<void>((assetResolve) => {
          const handleDone = () => assetResolve();
          image.addEventListener('load', handleDone, { once: true });
          image.addEventListener('error', handleDone, { once: true });
        });
      });

      const fontsReadyPromise =
        'fonts' in frameDoc && frameDoc.fonts
          ? frameDoc.fonts.ready.then(() => undefined).catch(() => undefined)
          : Promise.resolve();

      await Promise.all([fontsReadyPromise, ...imagePromises]);

      await new Promise<void>((nextFrame) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            nextFrame();
          });
        });
      });
    };

    const triggerPrint = async () => {
      if (hasTriggeredPrint) {
        return;
      }

      hasTriggeredPrint = true;

      const frameWindow = iframe.contentWindow;
      const frameDoc = iframe.contentDocument;

      if (!frameWindow || !frameDoc) {
        finalize(new Error('Unable to access print frame.'));
        return;
      }

      await waitForFrameAssets(frameDoc);

      try {
        frameWindow.focus();
        frameWindow.print();
      } catch {
        finalize(new Error('Unable to open print dialog.'));
        return;
      }

      if (!hasSettled) {
        hasSettled = true;
        resolve();
      }

      fallbackTimeout = setTimeout(() => {
        finalize();
      }, 120000);
    };

    iframe.addEventListener(
      'load',
      () => {
        if (!printEventTarget) {
          printEventTarget = iframe.contentWindow ?? window;
          printEventTarget.addEventListener('afterprint', handleAfterPrint, { once: true });
        }

        void triggerPrint();
      },
      { once: true }
    );

    document.body.appendChild(iframe);

    iframe.srcdoc = printableHtml;

    loadFallbackTimeout = setTimeout(() => {
      if (!printEventTarget) {
        printEventTarget = iframe.contentWindow ?? window;
        printEventTarget.addEventListener('afterprint', handleAfterPrint, { once: true });
      }

      void triggerPrint();
    }, 1500);
  });
}
