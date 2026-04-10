export { convertPdfToHtml } from './converter';
export { extractEditableTextFromHtml, applyEditedTextToHtml } from './editable';
export {
  createDownload,
  buildPortableHtml,
  buildPdfPrintHtml,
  printHtmlWithHiddenIframe,
} from './html-utils';
export type {
  ConversionConfidenceDiagnostics,
  ConversionConfidenceOptions,
  ConversionConfidencePageDiagnostic,
  ConversionConfidenceThresholds,
  ConvertPdfToHtmlOptions,
  ConvertPdfToHtmlResult,
  PdfToHtmlProgress,
} from './types';
