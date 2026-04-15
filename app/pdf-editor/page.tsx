'use client';

import React, { useCallback, useState } from 'react';
import SourcePane from '../components/SourcePane';
import TranslatedPane from '../components/TranslatedPane';
import WorkflowPreviewPane from '../components/WorkflowPreviewPane';
import FloatingControlBar from '../components/FloatingControlBar';
import ApiSettingsModal from '@/app/components/ApiSettingsModal';
import { usePdfDocument } from '../hooks/usePdfDocument';
import { validatePdfFile, validatePageCount, validateScope } from '../lib/validators';
import type { Language, TextEdit, TranslationScope } from '../lib/types';
import { convertPdfToHtml, buildPdfPrintHtml, printHtmlWithHiddenIframe } from '@/lib/pdf-to-html-engine';
import { extractPagesByScope, reconstructPortableHtml, conversionAbortController, resetAbortSignal } from '@/lib/pdf-utilities';
import { translateConvertedPages } from '@/lib/pdf-editor-translation-engine';

const initialScope: TranslationScope = { mode: 'full' };

type SharedPaneZoomState = {
	mode: 'fit' | 'manual';
	manualZoom: number;
};

type WorkflowStage =
	| 'idle'
	| 'sourceReady'
	| 'processing'
	| 'convertedReady'
	| 'translating'
	| 'translatedReady'
	| 'convertingPdf'
	| 'pdfReady';

interface PdfEditorState {
	stage: WorkflowStage;
	file: File | null;
	fileUrl: string | null;
	totalPages: number;
	scopedPageNumbers: number[];
	targetLanguage: Language | null;
	translationMode: 'translated' | 'skipped' | null;
	scope: TranslationScope;
	convertedPages: string[];
	convertedRevision: number;
	translatedPages: string[];
	finalPdfPages: string[];
	edits: TextEdit[];
	error: string | null;
}

type SelectionMappingState = {
	pageIndex: number;
	translatedText: string;
	originalText: string;
	token: number;
};

const initialState: PdfEditorState = {
	stage: 'idle',
	file: null,
	fileUrl: null,
	totalPages: 0,
	scopedPageNumbers: [],
	targetLanguage: null,
	translationMode: null,
	scope: initialScope,
	convertedPages: [],
	convertedRevision: 0,
	translatedPages: [],
	finalPdfPages: [],
	edits: [],
	error: null,
};

function getScopedPages(totalPages: number, scope: TranslationScope): number[] {
	if (totalPages <= 0) {
		return [];
	}

	if (scope.mode === 'selected') {
		return (scope.pages || [])
			.filter((page) => page >= 1 && page <= totalPages)
			.sort((a, b) => a - b);
	}

	if (scope.mode === 'range') {
		const start = scope.startPage;
		const end = scope.endPage;

		if (start === undefined || end === undefined || start < 1 || end < start || end > totalPages) {
			return [];
		}

		return Array.from({ length: end - start + 1 }, (_, index) => start + index);
	}

	return Array.from({ length: totalPages }, (_, index) => index + 1);
}

function mapAbsoluteToScopedIndex(absolutePage: number, scopedPages: number[]): number {
	if (scopedPages.length === 0) {
		return Math.max(1, absolutePage);
	}

	const exactIndex = scopedPages.indexOf(absolutePage);
	if (exactIndex >= 0) {
		return exactIndex + 1;
	}

	let closestIndex = 0;
	let closestDistance = Number.POSITIVE_INFINITY;

	for (let index = 0; index < scopedPages.length; index += 1) {
		const distance = Math.abs(scopedPages[index] - absolutePage);
		if (distance < closestDistance) {
			closestDistance = distance;
			closestIndex = index;
		}
	}

	return closestIndex + 1;
}

function mapScopedIndexToAbsolutePage(scopedIndex: number, scopedPages: number[]): number {
	if (scopedPages.length === 0) {
		return Math.max(1, scopedIndex);
	}

	const clampedIndex = Math.max(1, Math.min(scopedIndex, scopedPages.length));
	return scopedPages[clampedIndex - 1];
}

function extractPageNumberFromHtml(pageHtml: string): number | null {
	const pageMatch = pageHtml.match(/data-page="(\d+)"/);
	if (!pageMatch) {
		return null;
	}

	const parsedPage = Number.parseInt(pageMatch[1], 10);
	return Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : null;
}

function getPrimaryActionLabel(stage: WorkflowStage): string {
	switch (stage) {
		case 'sourceReady':
		case 'idle':
			return 'PROCESS PDF';
		case 'convertedReady':
			return 'TRANSLATE HTML';
		case 'translatedReady':
			return 'CONVERT TO PDF';
		case 'pdfReady':
			return 'NEW PDF';
		default:
			return 'PROCESSING...';
	}
}

function getCanPrimaryAction(state: PdfEditorState): boolean {
	if (state.stage === 'idle' || state.stage === 'sourceReady') {
		return state.file !== null && state.totalPages > 0;
	}

	if (state.stage === 'convertedReady') {
		return state.targetLanguage !== null && state.convertedPages.length > 0;
	}

	if (state.stage === 'translatedReady') {
		return state.translatedPages.length > 0;
	}

	return state.stage === 'pdfReady';
}

function getPanelLayout(stage: WorkflowStage): 'source' | 'convert' | 'translate' | 'final' {
	switch (stage) {
		case 'convertedReady':
		case 'translating':
			return 'convert';
		case 'translatedReady':
		case 'convertingPdf':
			return 'translate';
		case 'pdfReady':
			return 'final';
		default:
			return 'source';
	}
}

export default function PdfEditorPage() {
	const [state, setState] = useState<PdfEditorState>(initialState);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [sharedHtmlZoomState, setSharedHtmlZoomState] = useState<SharedPaneZoomState>({ mode: 'fit', manualZoom: 100 });
	const [sharedHtmlViewMode, setSharedHtmlViewMode] = useState<'preview' | 'code'>('preview');
	const [sharedHtmlScrollRatio, setSharedHtmlScrollRatio] = useState(0);
	const [isConvertedDesignMode, setIsConvertedDesignMode] = useState(false);
	const [selectionMapping, setSelectionMapping] = useState<SelectionMappingState | null>(null);
	const lastHandledConvertedRevisionRef = React.useRef(0);

	const sourceDoc = usePdfDocument();
	const convertedDoc = usePdfDocument();
	const translatedDoc = usePdfDocument();
	const finalPdfDoc = usePdfDocument();

	const syncFromSourcePage = useCallback(
		(sourcePage: number) => {
			sourceDoc.goToPage(sourcePage);
			const scopedIndex = mapAbsoluteToScopedIndex(sourcePage, state.scopedPageNumbers);
			convertedDoc.goToPage(scopedIndex);
			translatedDoc.goToPage(scopedIndex);
			finalPdfDoc.goToPage(scopedIndex);
		},
		[sourceDoc, convertedDoc, translatedDoc, finalPdfDoc, state.scopedPageNumbers]
	);

	const syncFromScopedPage = useCallback(
		(scopedPage: number) => {
			const safeScopedPage = Number.isFinite(scopedPage) ? scopedPage : 1;
			convertedDoc.goToPage(safeScopedPage);
			translatedDoc.goToPage(safeScopedPage);
			finalPdfDoc.goToPage(safeScopedPage);

			const sourcePage = mapScopedIndexToAbsolutePage(safeScopedPage, state.scopedPageNumbers);
			sourceDoc.goToPage(sourcePage);
		},
		[sourceDoc, convertedDoc, translatedDoc, finalPdfDoc, state.scopedPageNumbers]
	);

	const setError = useCallback((error: string) => {
		setState((prev) => ({ ...prev, error }));
	}, []);

	const clearError = useCallback(() => {
		setState((prev) => ({ ...prev, error: null }));
	}, []);

	const setLanguage = useCallback((language: Language | null) => {
		setState((prev) => ({ ...prev, targetLanguage: language }));
	}, []);

	const setScope = useCallback((scope: TranslationScope) => {
		setState((prev) => ({ ...prev, scope }));
	}, []);

	const reset = useCallback(() => {
		if (state.fileUrl) {
			URL.revokeObjectURL(state.fileUrl);
		}

		setState(initialState);
		setSharedHtmlZoomState({ mode: 'fit', manualZoom: 100 });
		setSharedHtmlViewMode('preview');
		setSharedHtmlScrollRatio(0);
		setSelectionMapping(null);
		sourceDoc.setTotalPages(0);
		convertedDoc.setTotalPages(0);
		translatedDoc.setTotalPages(0);
		finalPdfDoc.setTotalPages(0);
	}, [state.fileUrl, sourceDoc, convertedDoc, translatedDoc, finalPdfDoc]);

	const handleFileSelect = useCallback(
		(file: File, url: string, totalPages: number) => {
			if (file.name === 'update' && state.file) {
				const pageErr = validatePageCount(totalPages);
				if (pageErr) {
					setError(pageErr.message);
					return;
				}

				setState((prev) => ({
					...prev,
					totalPages,
					fileUrl: prev.fileUrl || url,
					stage: prev.stage === 'idle' ? 'sourceReady' : prev.stage,
				}));

				sourceDoc.setTotalPages(totalPages, sourceDoc.currentPage);
				return;
			}

			const fileErr = validatePdfFile(file);
			if (fileErr) {
				setError(fileErr.message);
				return;
			}

			if (state.fileUrl && state.fileUrl !== url) {
				URL.revokeObjectURL(state.fileUrl);
			}

			setState((prev) => ({
				...prev,
				stage: 'sourceReady',
				file,
				fileUrl: url,
				totalPages,
				scopedPageNumbers: [],
				translationMode: null,
				convertedPages: [],
				convertedRevision: 0,
				translatedPages: [],
				finalPdfPages: [],
				edits: [],
				error: null,
			}));
			setSelectionMapping(null);

			setSharedHtmlZoomState({ mode: 'fit', manualZoom: 100 });
			setSharedHtmlViewMode('preview');
			setSharedHtmlScrollRatio(0);
			setSelectionMapping(null);

			convertedDoc.setTotalPages(0);
			translatedDoc.setTotalPages(0);
			finalPdfDoc.setTotalPages(0);

			if (totalPages > 0) {
				sourceDoc.setTotalPages(totalPages, 1);
			}
		},
		[state.file, state.fileUrl, setError, sourceDoc, convertedDoc, translatedDoc, finalPdfDoc]
	);

	const processPdf = useCallback(async () => {
		if (!state.file) {
			setError('Upload a PDF before processing it to HTML.');
			return;
		}

		if (state.totalPages <= 0) {
			setError('Document pages are still loading. Please wait and try again.');
			return;
		}

		const scopeError = validateScope(state.scope, state.totalPages);
		if (scopeError) {
			setError(scopeError.message);
			return;
		}

		const pagesToRender = getScopedPages(state.totalPages, state.scope);
		if (pagesToRender.length === 0) {
			setError('No pages selected for conversion.');
			return;
		}

		// Update stage to processing and show progress
		setState((prev) => ({
			...prev,
			stage: 'processing',
			error: null,
		}));

		try {
			// Call convertPdfToHtml with abort signal for cancellation support
			const result = await convertPdfToHtml(state.file, {
				signal: conversionAbortController.signal,
			});

			// Extract pages according to the user's selected scope (full, range, or selected)
			const extractedPages = extractPagesByScope(result.html, state.scope, result.pageCount);
			const scopedPageNumbers = getScopedPages(result.pageCount, state.scope);
			const normalizedScopedPages = extractedPages.map((pageHtml, index) => {
				const extractedPage = extractPageNumberFromHtml(pageHtml);
				return extractedPage ?? scopedPageNumbers[index] ?? index + 1;
			});

			if (extractedPages.length === 0) {
				setError('Failed to extract pages from the converted HTML.');
				setState((prev) => ({ ...prev, stage: 'sourceReady' }));
				return;
			}

			// Update state with real converted pages and actual page count from PDF
			setState((prev) => ({
				...prev,
				stage: 'convertedReady',
				convertedPages: extractedPages,
				convertedRevision: 0,
				scopedPageNumbers: normalizedScopedPages,
				totalPages: result.pageCount,
				translationMode: null,
				translatedPages: [],
				finalPdfPages: [],
				error: null,
			}));

			setSharedHtmlScrollRatio(0);

			const scopedIndex = mapAbsoluteToScopedIndex(sourceDoc.currentPage, normalizedScopedPages);
			convertedDoc.setTotalPages(extractedPages.length, scopedIndex);
			translatedDoc.setTotalPages(0);
			finalPdfDoc.setTotalPages(0);
			resetAbortSignal();
		} catch (err) {
			// Handle abort signal gracefully without showing error
			if (err instanceof DOMException && err.name === 'AbortError') {
				setState((prev) => ({
					...prev,
					stage: 'sourceReady',
					error: null,
				}));
				resetAbortSignal();
				return;
			}

			// Handle other errors gracefully with user-friendly message
			const errorMessage = err instanceof Error ? err.message : 'Failed to convert PDF to HTML.';
			setError(errorMessage);
			setState((prev) => ({ ...prev, stage: 'sourceReady' }));
			resetAbortSignal();
		}
	}, [state.file, state.scope, state.totalPages, setError, convertedDoc, translatedDoc, finalPdfDoc, sourceDoc.currentPage]);

	const translateHtml = useCallback(async () => {
		if (!state.targetLanguage) {
			setError('Choose a target language before translating the HTML.');
			return;
		}

		if (state.convertedPages.length === 0) {
			setError('Convert the PDF to HTML before translating it.');
			return;
		}

		setState((prev) => ({
			...prev,
			stage: 'translating',
			error: null,
		}));

		try {
			const result = await translateConvertedPages(state.convertedPages, {
				targetLang: state.targetLanguage.code,
				sourceLang: 'auto',
				pageConcurrency: 2,
				nodeConcurrency: 2,
				maxRetries: 0,
			});

			if (result.pages.length === 0) {
				setState((prev) => ({ ...prev, stage: 'convertedReady' }));
				setError('No translated pages were generated.');
				return;
			}

			if (result.translatedNodes === 0 && (result.totalNodes > 0 || result.pageFailures > 0)) {
				setState((prev) => ({ ...prev, stage: 'convertedReady' }));
				setError('Translation failed for all detected text blocks. Please try again.');
				return;
			}

			setState((prev) => ({
				...prev,
				stage: 'translatedReady',
				translatedPages: result.pages,
				translationMode: 'translated',
				finalPdfPages: [],
				error: result.failedNodes > 0 ? `Partial translation: ${result.failedNodes} text block(s) could not be translated.` : null,
			}));

			setSharedHtmlScrollRatio(0);

			translatedDoc.setTotalPages(result.pages.length, convertedDoc.currentPage);
			finalPdfDoc.setTotalPages(0);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to translate converted HTML.';
			setState((prev) => ({ ...prev, stage: 'convertedReady' }));
			setError(message);
		}
	}, [state.convertedPages, state.targetLanguage, setError, translatedDoc, finalPdfDoc, convertedDoc.currentPage]);

	const buildPrintableHtmlForPages = useCallback((pages: string[], targetLanguageCode?: string, mode: 'translated' | 'skipped' | null = null) => {
		const documentTitle = mode === 'translated' && targetLanguageCode
			? `Translated PDF (${targetLanguageCode})`
			: 'PDF Document';
		const portableHtml = reconstructPortableHtml(pages, documentTitle);
		return buildPdfPrintHtml(portableHtml, documentTitle);
	}, []);

	const skipTranslation = useCallback(() => {
		if (state.convertedPages.length === 0) {
			setError('Convert the PDF to HTML before skipping translation.');
			return;
		}

		const pagesSnapshot = [...state.convertedPages];
		setSelectionMapping(null);
		setState((prev) => ({
			...prev,
			stage: 'translatedReady',
			translatedPages: pagesSnapshot,
			translationMode: 'skipped',
			finalPdfPages: [],
			error: null,
		}));
		setSharedHtmlScrollRatio(0);
		translatedDoc.setTotalPages(pagesSnapshot.length, convertedDoc.currentPage);
		finalPdfDoc.setTotalPages(0);
	}, [state.convertedPages, setError, translatedDoc, convertedDoc.currentPage, finalPdfDoc]);

	const convertToPdf = useCallback(() => {
		if (state.translatedPages.length === 0) {
			setError('Prepare HTML pages before converting them to PDF.');
			return;
		}

		const translatedPagesSnapshot = [...state.translatedPages];

		setSelectionMapping(null);
		setState((prev) => ({
			...prev,
			stage: 'pdfReady',
			finalPdfPages: translatedPagesSnapshot,
			error: null,
		}));
		finalPdfDoc.setTotalPages(translatedPagesSnapshot.length, translatedDoc.currentPage);
	}, [
		state.translatedPages,
		setError,
		finalPdfDoc,
		translatedDoc.currentPage,
	]);

	const addEdit = useCallback((edit: TextEdit) => {
		setState((prev) => ({
			...prev,
			edits: [...prev.edits.filter((item) => item.id !== edit.id), edit],
		}));
	}, []);

	const updateConvertedPage = useCallback((pageIndex: number, html: string) => {
		const canApplyNow =
			state.stage === 'convertedReady' &&
			pageIndex >= 0 &&
			pageIndex < state.convertedPages.length &&
			state.convertedPages[pageIndex] !== html;

		if (!canApplyNow) {
			return;
		}

		setSelectionMapping(null);

		setState((prev) => {
			// Ignore late async edits once the workflow has advanced past converted editing.
			if (prev.stage !== 'convertedReady') {
				return prev;
			}

			const nextPages = [...prev.convertedPages];
			if (pageIndex >= 0 && pageIndex < nextPages.length) {
				if (nextPages[pageIndex] === html) {
					return prev;
				}

				nextPages[pageIndex] = html;
			} else {
				return prev;
			}

			return {
				...prev,
				stage: 'convertedReady',
				convertedPages: nextPages,
				convertedRevision: prev.convertedRevision + 1,
				translationMode: null,
				translatedPages: [],
				finalPdfPages: [],
				error: null,
			};
		});
	}, [state.stage, state.convertedPages]);

	React.useEffect(() => {
		if (state.convertedRevision <= lastHandledConvertedRevisionRef.current) {
			return;
		}

		translatedDoc.setTotalPages(0);
		finalPdfDoc.setTotalPages(0);
		lastHandledConvertedRevisionRef.current = state.convertedRevision;
	}, [state.convertedRevision, translatedDoc, finalPdfDoc]);

	const updateTranslatedPage = useCallback((pageIndex: number, html: string) => {
		setState((prev) => {
			const nextPages = [...prev.translatedPages];
			if (pageIndex >= 0 && pageIndex < nextPages.length) {
				nextPages[pageIndex] = html;
			}

			return {
				...prev,
				stage: 'translatedReady',
				translatedPages: nextPages,
				finalPdfPages: [],
			};
		});
		setSharedHtmlScrollRatio(0);
	}, []);

	const handleSelectionMappingChange = useCallback((selection: { pageIndex: number; translatedText: string; originalText: string } | null) => {
		if (!selection) {
			setSelectionMapping(null);
			return;
		}

		setSelectionMapping({
			...selection,
			token: Date.now(),
		});
	}, []);

	const handleTranslatedEditToggle = useCallback(
		(isEditing: boolean) => {
			if (!isEditing || state.stage !== 'pdfReady') {
				return;
			}

			setState((prev) => ({
				...prev,
				stage: 'translatedReady',
				finalPdfPages: [],
			}));
			finalPdfDoc.setTotalPages(0);
		},
		[state.stage, finalPdfDoc]
	);

	const handleDownload = useCallback(async () => {
		const pagesToPrint = state.finalPdfPages.length > 0 ? state.finalPdfPages : state.translatedPages;

		if (pagesToPrint.length === 0) {
			return;
		}

		try {
			const printableHtml = buildPrintableHtmlForPages(
				pagesToPrint,
					state.targetLanguage?.code,
					state.translationMode
			);
			await printHtmlWithHiddenIframe(printableHtml);
		} catch {
			setError('Unable to open the print dialog. Please allow pop-ups and try again.');
		}
	}, [state.finalPdfPages, state.translatedPages, state.targetLanguage, state.translationMode, buildPrintableHtmlForPages, setError]);

	const isSkipAsPrimary = state.stage === 'convertedReady' && state.targetLanguage === null;
	const buttonLabel = isSkipAsPrimary ? 'SKIP TRANSLATION' : getPrimaryActionLabel(state.stage);
	const buttonAction =
		state.stage === 'sourceReady' || state.stage === 'idle'
			? processPdf
			: state.stage === 'convertedReady'
			? state.targetLanguage
				? translateHtml
				: skipTranslation
			: state.stage === 'translatedReady'
			? convertToPdf
			: reset;
	const canPrimaryAction =
		state.stage === 'convertedReady'
			? state.convertedPages.length > 0
			: getCanPrimaryAction(state);
	const panelLayout = getPanelLayout(state.stage);
	React.useEffect(() => {
		if (panelLayout !== 'convert') {
			setIsConvertedDesignMode(false);
		}
	}, [panelLayout]);

	const convertedPageIndex = Math.max(0, convertedDoc.currentPage - 1);
	const convertedPageHtml = state.convertedPages[convertedPageIndex] || '';
	const convertedHighlightText =
		selectionMapping && selectionMapping.pageIndex === convertedPageIndex ? selectionMapping.originalText : undefined;
	const convertedHighlightToken =
		selectionMapping && selectionMapping.pageIndex === convertedPageIndex ? selectionMapping.token : undefined;
	const isDesignFocusedLayout = panelLayout === 'convert' && isConvertedDesignMode;
	const showSourcePanel = (panelLayout === 'source' || panelLayout === 'convert') && !isDesignFocusedLayout;
	const showConvertedPanel = panelLayout === 'convert' || panelLayout === 'translate';
	const showTranslatedPanel = panelLayout === 'translate' || panelLayout === 'final';
	const showFinalPanel = panelLayout === 'final';
	const layoutClassName =
		panelLayout === 'source' || isDesignFocusedLayout
			? 'translator-layout workflow-layout workflow-layout-single'
			: 'translator-layout workflow-layout';

	return (
		<>
			<div className={layoutClassName}>
				{showSourcePanel && (
					<SourcePane
						fileUrl={state.fileUrl}
						totalPages={state.totalPages}
						currentPage={sourceDoc.currentPage}
						scope={state.scope}
						onFileSelect={handleFileSelect}
						onPageChange={syncFromSourcePage}
						onScopeChange={setScope}
						onError={setError}
						error={state.error}
					/>
				)}

				{showConvertedPanel && (
					<WorkflowPreviewPane
						key={`converted-pane-${state.stage}`}
						title="CONVERTED HTML"
						statusLabel={
							state.stage === 'convertedReady'
								? 'Ready to translate'
								: state.stage === 'translating'
								? 'Translating HTML...'
								: state.stage === 'translatedReady' || state.stage === 'pdfReady'
								? 'Converted HTML ready'
								: 'Waiting for process'
						}
						emptyTitle="Converted HTML appears here"
						emptyDescription="Process the source PDF to create a layout-preserving HTML version."
						pages={state.convertedPages}
						currentPage={convertedDoc.currentPage}
						totalPages={convertedDoc.totalPages}
						onPageChange={syncFromScopedPage}
						variant="html"
						enableCodeViewToggle
						isCodeEditable={state.stage === 'convertedReady'}
						onUpdatePage={updateConvertedPage}
						isLoading={state.stage === 'translating'}
						loadingLabel="Translating text while preserving layout..."
						id="converted-html-pane"
						enableAssetsManager
						sharedZoomState={sharedHtmlZoomState}
						onSharedZoomStateChange={setSharedHtmlZoomState}
						sharedViewMode={sharedHtmlViewMode}
						onSharedViewModeChange={setSharedHtmlViewMode}
						sharedScrollRatio={sharedHtmlScrollRatio}
						onSharedScrollRatioChange={setSharedHtmlScrollRatio}
						highlightText={convertedHighlightText}
						highlightToken={convertedHighlightToken}
						onDesignModeChange={setIsConvertedDesignMode}
					/>
				)}

				{showTranslatedPanel && (
					<TranslatedPane
						status={
							state.stage === 'pdfReady'
								? 'translatedSuccess'
								: state.stage === 'convertingPdf'
								? 'convertingPdf'
								: 'editing'
						}
						translatedPages={state.translatedPages}
						currentPage={translatedDoc.currentPage}
						totalPages={state.translatedPages.length}
						targetLangCode={state.translationMode === 'translated' ? state.targetLanguage?.code ?? null : null}
						onPageChange={syncFromScopedPage}
						onEdit={addEdit}
						onUpdatePage={updateTranslatedPage}
						onEditToggle={handleTranslatedEditToggle}
						sharedZoomState={sharedHtmlZoomState}
						onSharedZoomStateChange={setSharedHtmlZoomState}
						sharedViewMode={sharedHtmlViewMode}
						onSharedViewModeChange={setSharedHtmlViewMode}
						sharedScrollRatio={sharedHtmlScrollRatio}
						onSharedScrollRatioChange={setSharedHtmlScrollRatio}
						originalPageHtml={convertedPageHtml}
						onSelectionMappingChange={handleSelectionMappingChange}
					/>
				)}

				{showFinalPanel && (
					<WorkflowPreviewPane
						title="FINAL TRANSLATED PDF"
						statusLabel={state.stage === 'pdfReady' ? 'Ready to download' : 'Waiting for PDF conversion'}
						emptyTitle="Final translated PDF appears here"
						emptyDescription="Convert the translated HTML into the final printable PDF preview."
						pages={state.finalPdfPages}
						currentPage={finalPdfDoc.currentPage}
						totalPages={finalPdfDoc.totalPages}
						onPageChange={syncFromScopedPage}
						variant="pdf"
						id="final-pdf-pane"
						sharedZoomState={sharedHtmlZoomState}
						onSharedZoomStateChange={setSharedHtmlZoomState}
						sharedScrollRatio={sharedHtmlScrollRatio}
						onSharedScrollRatioChange={setSharedHtmlScrollRatio}
					/>
				)}
			</div>

			<FloatingControlBar
				stage={state.stage}
				targetLanguage={state.targetLanguage}
				onLanguageSelect={setLanguage}
				buttonLabel={buttonLabel}
				onButtonClick={buttonAction}
				onDownload={handleDownload}
				onSettingsClick={() => setIsSettingsOpen(true)}
				canTranslate={canPrimaryAction}
				showLanguageSelectorAt="convertedReady"
				allowNoTranslationOption
			/>

			{isSettingsOpen && (
				<ApiSettingsModal
					onClose={() => setIsSettingsOpen(false)}
					onError={setError}
				/>
			)}

			{state.error && (
				<div className="error-toast" id="error-toast">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<circle cx="12" cy="12" r="10" />
						<line x1="12" y1="8" x2="12" y2="12" />
						<line x1="12" y1="16" x2="12.01" y2="16" />
					</svg>
					{state.error}
					<button className="error-toast-close" onClick={clearError}>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
							<line x1="18" y1="6" x2="6" y2="18" />
							<line x1="6" y1="6" x2="18" y2="18" />
						</svg>
					</button>
				</div>
			)}
		</>
	);
}

