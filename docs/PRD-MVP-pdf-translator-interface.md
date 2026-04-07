# PRD: PDF Translator Interface (MVP)

## 1) Goal
Ship a simple PDF translation interface that lets a user:
- Upload a PDF
- Choose target translation language
- Translate the whole PDF, selected pages, or a page range
- Preview translated PDF
- Edit translated text (manual edits and AI-assisted edits)
- Download the final translated PDF

This PRD is only for MVP delivery.

## 2) MVP Scope
### In scope
- Two-pane editor UI
- PDF upload and validation
- Language selection
- Translation trigger and status handling
- Preview translated PDF
- Manual editing of selected portion
- AI-based editing of selected portion
- Download translated PDF

### Out of scope
- Multi-file batch uploads
- Collaboration/version history
- OCR tuning and advanced layout fixing
- Advanced quality scoring
- Full document rewrite modes

## 3) Core User Flow
1. User opens interface.
2. User uploads a PDF in left pane.
3. System validates file:
   - Max size: 10MB
   - Max pages: 10
4. User selects target language from dropdown.
5. User chooses translation scope:
   - Single page
   - Multiple specific pages
   - Page range (start-end)
6. User clicks Start Translation.
7. System translates selected content.
8. Right pane shows translated PDF preview.
9. User edits selected portions:
   - Manual text edits
   - AI-based intent correction/rewrite
10. User downloads the updated translated PDF.
11. After success, primary button changes from Start Translation to New PDF.
12. If translation fails, primary button changes to Retry.

## 4) UI Requirements
## Layout
- Two-pane editor layout (Source Document on the left, Translated Document on the right).
- Floating control navbar (pill-shaped) at the bottom center of the screen.

## Left Pane (Source Document)
- Header with "SOURCE DOCUMENT" label and document splicing/scope control link.
- Initial state: PDF upload area (drag-and-drop + file picker) centered in the pane.
- Document loaded state: Renders the uploaded PDF, replacing the upload button/area.
- Validation messages.
- Translation scope controls (can be toggled via splicing):
  - Mode selector: Full PDF / Selected Pages / Range
  - If Selected Pages: page chips or comma list input
  - If Range: start page and end page fields

## Right Pane (Translated Document)
- Header with "TRANSLATED DOCUMENT" label and pagination controls.
- Translated PDF preview.
- Edit button (enters edit mode).
- Selection tool to choose a portion of translated text.
- Edit options for selected text:
  - Manual edit input
  - AI Edit action (improve meaning/intent, not just direct word translation)

## Floating Control Navbar (Bottom Pill)
- Share button (icon).
- Target language dropdown ("Translate to:").
- Primary action button (Translate/Process):
  - Start Translation (default)
  - Retry (after failed translation)
  - New PDF (after successful translation)
- Download button (icon) to export the translated version.

## 5) Functional Requirements
### FR-1 Upload validation
- Reject files > 10MB.
- Reject files with > 10 pages.
- Show clear inline error with reason.

### FR-2 Language selection
- Translation cannot start until target language is selected.

### FR-3 Translation scope
- User can translate:
  - Full document
  - Specific pages
  - Page range
- Validate page inputs against document page count.

### FR-4 Translation execution
- On click Start Translation, call translation pipeline.
- Show processing state.
- On success: render translated PDF in right pane and switch primary button to New PDF.
- On failure: show error and switch primary button to Retry.

### FR-5 Manual edits
- User can select a portion in preview and manually edit translated text.
- Edited text is preserved for export.

### FR-6 AI-based edits
- User can select a portion and request AI edit.
- AI edit should support intent-aware refinement, not only literal translation.
- User can accept or overwrite AI result.

### FR-7 Download
- Download exports the currently visible translated version including manual/AI edits.

## 6) Non-Functional Requirements (MVP)
- Responsive on desktop first; functional on mobile.
- Clear error states and recoverable actions.
- Basic loading feedback during translation.
- No silent failures.

## 7) State Model (UI)
### Primary states
- Idle (no PDF)
- FileReady (PDF valid, waiting for translation)
- Translating
- TranslatedSuccess
- TranslationFailed
- Editing

### Button behavior
- Idle/FileReady: Start Translation
- TranslationFailed: Retry
- TranslatedSuccess: New PDF

## 8) Validation Rules
- File type must be PDF.
- Max file size = 10MB.
- Max page count = 10.
- For range: start <= end, both within page count.
- For selected pages: each page number valid and unique.

## 9) Acceptance Criteria
1. User can upload a valid PDF and proceed.
2. File > 10MB is blocked with clear error.
3. File > 10 pages is blocked with clear error.
4. User must select target language before translating.
5. User can choose full, selected pages, or range translation.
6. Start Translation triggers translation.
7. Success shows translated preview and switches button to New PDF.
8. Failure shows error and switches button to Retry.
9. User can select a text portion in translated preview.
10. User can manually edit selected text.
11. User can apply AI edit to selected text for intent correction.
12. User can download final translated PDF with all edits.

## 10) MVP Build Plan (Developer-Friendly)
### Phase 1: UI Shell + Validation
- Build two-pane layout.
- Add upload, language dropdown, scope controls.
- Enforce 10MB/10-page limits.

### Phase 2: Translation Flow
- Wire Start Translation API call.
- Add loading/success/failure states.
- Implement button transitions (Start Translation -> Retry/New PDF).

### Phase 3: Editing + Download
- Add selection-based manual editing.
- Add AI edit for selected portion.
- Add download export for edited output.

### Phase 4: MVP Hardening
- Improve errors and retries.
- Add smoke tests for core flow.

## 11) Brainstorm Notes (Practical MVP Decisions)
- Keep editing model text-first: selected text block edit is enough for MVP.
- AI edit prompt should focus on preserving user intent and context.
- Keep page-scope input simple now; richer page thumbnails can come later.
- Use explicit state labels in UI to avoid confusion during retries.
