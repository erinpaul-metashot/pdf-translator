'use client';

import React, { useMemo, useState } from 'react';

import type { ClaudeRunSummary, ClaudeTranslationArtifacts } from '../types';

interface ClaudeTranslatedPdfPanelProps {
  pages: string[];
  convertedPages: string[];
  fileName: string;
  sourcePageCount: number;
  runSummary: ClaudeRunSummary | null;
  artifacts: ClaudeTranslationArtifacts | null;
  currentPage: number;
  busy: boolean;
  onPageChange: (nextPage: number) => void;
  onPageHtmlChange: (pageIndex: number, html: string) => void;
}

export default function ClaudeTranslatedPdfPanel({
  pages,
  convertedPages,
  fileName,
  sourcePageCount,
  runSummary,
  artifacts,
  currentPage,
  busy,
  onPageChange,
  onPageHtmlChange,
}: ClaudeTranslatedPdfPanelProps) {
  const [mode, setMode] = useState<'preview' | 'edit' | 'artifacts'>('preview');
  const [artifactPage, setArtifactPage] = useState(1);

  const totalPages = pages.length;
  const pageIndex = Math.max(0, Math.min(currentPage - 1, Math.max(0, totalPages - 1)));
  const pageHtml = pages[pageIndex] || '';
  const convertedPageIndex = Math.max(0, Math.min(artifactPage - 1, Math.max(0, convertedPages.length - 1)));
  const convertedPageHtml = convertedPages[convertedPageIndex] || '';

  const pageTitle = useMemo(() => `Translated page ${pageIndex + 1}`, [pageIndex]);
  const convertedPageTitle = useMemo(() => `Converted page ${convertedPageIndex + 1}`, [convertedPageIndex]);

  const artifactsPayloadText = useMemo(() => {
    return JSON.stringify(
      {
        source: {
          fileName,
          sourcePageCount,
        },
        intermediate: {
          convertedPagesCount: convertedPages.length,
        },
        final: {
          translatedPagesCount: pages.length,
        },
        runSummary,
        apiArtifacts: artifacts,
      },
      null,
      2
    );
  }, [artifacts, convertedPages.length, fileName, pages.length, runSummary, sourcePageCount]);

  const shouldShowMainView = mode === 'artifacts' || totalPages > 0;

  return (
    <section className="claude-panel" id="claude-translated-panel">
      <header className="claude-panel-header">
        <h2 className="claude-panel-title">TRANSLATED OUTPUT</h2>

        <div className="claude-panel-actions">
          <button
            type="button"
            className={`claude-tab-btn ${mode === 'preview' ? 'active' : ''}`}
            onClick={() => setMode('preview')}
          >
            Preview
          </button>
          <button
            type="button"
            className={`claude-tab-btn ${mode === 'edit' ? 'active' : ''}`}
            onClick={() => setMode('edit')}
          >
            Edit HTML
          </button>
          <button
            type="button"
            className={`claude-tab-btn ${mode === 'artifacts' ? 'active' : ''}`}
            onClick={() => setMode('artifacts')}
          >
            Artifacts
          </button>
        </div>
      </header>

      <div className="claude-panel-body">
        {shouldShowMainView ? (
          <>
            {mode === 'artifacts' ? (
              <>
                <section className="claude-artifact-card">
                  <h3 className="claude-artifact-title">Artifact Inventory</h3>
                  <div className="claude-artifact-grid">
                    <p>
                      <strong>Source file:</strong> {fileName || 'N/A'}
                    </p>
                    <p>
                      <strong>Source pages:</strong> {sourcePageCount}
                    </p>
                    <p>
                      <strong>Converted HTML pages:</strong> {convertedPages.length}
                    </p>
                    <p>
                      <strong>Translated pages:</strong> {pages.length}
                    </p>
                    <p>
                      <strong>Provider model:</strong> {artifacts?.providerModel ?? 'N/A'}
                    </p>
                    <p>
                      <strong>Contract version:</strong> {artifacts?.contractVersion ?? 'N/A'}
                    </p>
                  </div>
                </section>

                {artifacts?.summary ? (
                  <section className="claude-artifact-card">
                    <h3 className="claude-artifact-title">Run Summary</h3>
                    <div className="claude-artifact-grid">
                      <p>
                        <strong>Pages returned:</strong> {artifacts.summary.pageCount}
                      </p>
                      <p>
                        <strong>Translated blocks:</strong> {artifacts.summary.translatedBlocks}
                      </p>
                      <p>
                        <strong>Failed blocks:</strong> {artifacts.summary.failedBlocks}
                      </p>
                      <p>
                        <strong>Translation memory hits:</strong> {artifacts.summary.memoryHits}
                      </p>
                      <p>
                        <strong>Quality issues:</strong> {artifacts.summary.qualityIssues}
                      </p>
                      <p>
                        <strong>Warnings:</strong> {artifacts.warnings.length}
                      </p>
                    </div>
                  </section>
                ) : null}

                {runSummary ? (
                  <section className="claude-artifact-card">
                    <h3 className="claude-artifact-title">Token and Cost</h3>
                    <div className="claude-artifact-grid">
                      <p>
                        <strong>Total tokens:</strong> {runSummary.usage.totalTokens}
                      </p>
                      <p>
                        <strong>Input tokens:</strong> {runSummary.usage.inputTokens}
                      </p>
                      <p>
                        <strong>Output tokens:</strong> {runSummary.usage.outputTokens}
                      </p>
                      <p>
                        <strong>Cache write/read:</strong> {runSummary.usage.cacheCreationInputTokens} / {runSummary.usage.cacheReadInputTokens}
                      </p>
                      <p>
                        <strong>Estimated USD:</strong> {runSummary.cost.estimatedUsd}
                      </p>
                      <p>
                        <strong>Model:</strong> {runSummary.cost.model}
                      </p>
                    </div>
                  </section>
                ) : null}

                {artifacts?.pageMetrics && artifacts.pageMetrics.length > 0 ? (
                  <section className="claude-artifact-card">
                    <h3 className="claude-artifact-title">Page Metrics</h3>
                    <div className="claude-artifact-table-wrap">
                      <table className="claude-artifact-table">
                        <thead>
                          <tr>
                            <th>Page</th>
                            <th>Total Blocks</th>
                            <th>Translated</th>
                            <th>Failed</th>
                            <th>Memory Hits</th>
                          </tr>
                        </thead>
                        <tbody>
                          {artifacts.pageMetrics.map((metric) => (
                            <tr key={`metric-${metric.pageNumber}`}>
                              <td>{metric.pageNumber}</td>
                              <td>{metric.totalBlocks}</td>
                              <td>{metric.translatedBlocks}</td>
                              <td>{metric.failedBlocks}</td>
                              <td>{metric.memoryHits}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ) : null}

                {artifacts?.warnings && artifacts.warnings.length > 0 ? (
                  <section className="claude-artifact-card">
                    <h3 className="claude-artifact-title">Warnings</h3>
                    <ul className="claude-artifact-list">
                      {artifacts.warnings.map((warning, index) => (
                        <li key={`warning-${index}`}>{warning}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {artifacts?.quality ? (
                  <section className="claude-artifact-card">
                    <h3 className="claude-artifact-title">Quality Checks</h3>
                    <div className="claude-artifact-grid">
                      <p>
                        <strong>Total:</strong> {artifacts.quality.summary.totalIssues}
                      </p>
                      <p>
                        <strong>Numeric mismatch:</strong> {artifacts.quality.summary.numericMismatches}
                      </p>
                      <p>
                        <strong>Consistency overrides:</strong> {artifacts.quality.summary.consistencyOverrides}
                      </p>
                    </div>
                    {artifacts.quality.issues.length > 0 ? (
                      <ul className="claude-artifact-list">
                        {artifacts.quality.issues.map((issue, index) => (
                          <li key={`quality-${issue.pageNumber}-${issue.blockId}-${index}`}>
                            Page {issue.pageNumber}, {issue.blockId}: {issue.message}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                ) : null}

                {convertedPages.length > 0 ? (
                  <section className="claude-artifact-card">
                    <h3 className="claude-artifact-title">Intermediate Converted HTML (Page by Page)</h3>
                    <div className="claude-page-nav">
                      <button
                        type="button"
                        className="claude-nav-btn"
                        disabled={artifactPage <= 1}
                        onClick={() => setArtifactPage((prev) => Math.max(1, prev - 1))}
                      >
                        Prev
                      </button>
                      <span className="claude-page-count">
                        Page {Math.max(1, Math.min(artifactPage, convertedPages.length))} / {convertedPages.length}
                      </span>
                      <button
                        type="button"
                        className="claude-nav-btn"
                        disabled={artifactPage >= convertedPages.length}
                        onClick={() => setArtifactPage((prev) => Math.min(convertedPages.length, prev + 1))}
                      >
                        Next
                      </button>
                    </div>
                    <div className="claude-preview-wrap">
                      <iframe
                        title={convertedPageTitle}
                        srcDoc={convertedPageHtml}
                        className="claude-preview-frame"
                        sandbox="allow-same-origin"
                      />
                    </div>
                  </section>
                ) : null}

                <section className="claude-artifact-card">
                  <h3 className="claude-artifact-title">Raw Artifacts JSON</h3>
                  <pre className="claude-artifact-json">{artifactsPayloadText}</pre>
                </section>
              </>
            ) : mode === 'preview' ? (
              <>
                <div className="claude-page-nav">
                  <button
                    type="button"
                    className="claude-nav-btn"
                    disabled={currentPage <= 1}
                    onClick={() => onPageChange(currentPage - 1)}
                  >
                    Prev
                  </button>
                  <span className="claude-page-count">
                    Page {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    className="claude-nav-btn"
                    disabled={currentPage >= totalPages}
                    onClick={() => onPageChange(currentPage + 1)}
                  >
                    Next
                  </button>
                </div>

                <div className="claude-preview-wrap">
                  <iframe title={pageTitle} srcDoc={pageHtml} className="claude-preview-frame" sandbox="allow-same-origin" />
                </div>
              </>
            ) : (
              <>
                <div className="claude-page-nav">
                  <button
                    type="button"
                    className="claude-nav-btn"
                    disabled={currentPage <= 1}
                    onClick={() => onPageChange(currentPage - 1)}
                  >
                    Prev
                  </button>
                  <span className="claude-page-count">
                    Page {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    className="claude-nav-btn"
                    disabled={currentPage >= totalPages}
                    onClick={() => onPageChange(currentPage + 1)}
                  >
                    Next
                  </button>
                </div>

                <textarea
                  className="claude-page-editor"
                  value={pageHtml}
                  onChange={(event) => onPageHtmlChange(pageIndex, event.target.value)}
                />
              </>
            )}
          </>
        ) : (
          <div className="claude-empty-state">
            {busy
              ? 'Claude engine is processing pages... switch to Artifacts to inspect intermediate outputs.'
              : 'Translated pages will appear here after you start.'}
          </div>
        )}
      </div>
    </section>
  );
}
