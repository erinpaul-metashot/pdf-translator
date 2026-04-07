const fs = require('fs');
const path = require('path');

// Dynamically set MuPDF WASM base path
global.$libmupdf_wasm_Module = {
  locateFile: (fileName) => path.join(__dirname, 'public/mupdf', fileName),
  printErr: () => {} // suppress warnings
};

(async () => {
  try {
    // Load MuPDF
    const mupdf = await import(path.join(__dirname, 'public/mupdf/mupdf.js'));
    const runtime = mupdf.default;

    // Load PDF
    const pdfPath = path.join(__dirname, 'testpdf.pdf');
    const pdfBuffer = fs.readFileSync(pdfPath);
    const doc = runtime.Document.openDocument(new Uint8Array(pdfBuffer), 'application/pdf');

    // Test 1: Current flag (text=path, no no-reuse-images)
    console.log('=== Test 1: text=path (no no-reuse-images) ===');
    testSvgGeneration(runtime, doc, 0, 'text=path');

    // Test 2: Original flag (text=text,no-reuse-images)
    console.log('\n=== Test 2: text=text,no-reuse-images (original) ===');
    testSvgGeneration(runtime, doc, 0, 'text=text,no-reuse-images');

    // Test 3: Default (empty string)
    console.log('\n=== Test 3: Empty options (default) ===');
    testSvgGeneration(runtime, doc, 0, '');

    doc.destroy();
  } catch (error) {
    console.error('Error:', error);
  }
})();

function testSvgGeneration(mupdf, doc, pageIndex, options) {
  try {
    const page = doc.loadPage(pageIndex);
    const svgBuffer = new mupdf.Buffer();
    const writer = new mupdf.DocumentWriter(svgBuffer, 'svg', options);

    const device = writer.beginPage(page.getBounds());
    page.run(device, mupdf.Matrix.identity);
    writer.endPage();
    writer.close();

    const svgContent = svgBuffer.asString();

    // Count image elements
    const imageCount = (svgContent.match(/<image\s/g) || []).length;
    const imageWithHref = (svgContent.match(/<image[^>]*(?:href|xlink:href)="/g) || []).length;
    const base64Count = (svgContent.match(/data:image\//g) || []).length;
    const maskElements = (svgContent.match(/<mask\s/g) || []).length;

    console.log(`Options: "${options}"`);
    console.log(`  Total <image> elements: ${imageCount}`);
    console.log(`  <image> with href/xlink:href: ${imageWithHref}`);
    console.log(`  Base64 data URIs: ${base64Count}`);
    console.log(`  <mask> elements: ${maskElements}`);

    if (imageCount > 0 && imageWithHref === 0) {
      console.log('  ⚠️  PROBLEM: Images exist but have NO href/xlink:href attributes');
    } else if (imageWithHref > 0 && base64Count === 0) {
      console.log('  ⚠️  WARNING: Images have href but NO base64 data');
    } else if (base64Count > 0) {
      console.log('  ✅ SUCCESS: Images have base64 data URIs');
    }

    device.destroy();
    writer.destroy();
    svgBuffer.destroy();
    page.destroy();
  } catch (error) {
    console.error(`  Error with options "${options}":`, error.message);
  }
}
