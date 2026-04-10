Now I have a complete, doc-backed picture. Let me give you a thorough architecture breakdown.Here's the full, doc-backed breakdown of exactly how this engine would work, what's real, and where the limits are.

---

## Is it possible? Yes — and here's the honest picture

### What the Claude API actually gives you (confirmed in docs)

You send a PDF as a base64-encoded `document` block in the `/v1/messages` request. Claude reads both text and visual content (charts, images, tables) inside the PDF natively — no separate OCR step needed for text-based PDFs.

As of March 13, 2026, Anthropic raised the PDF page limit sixfold to 600 pages per request (up from 100), and the 1M token context window is now generally available for Claude Opus 4.6 and Sonnet 4.6 at standard pricing — no beta header required.

The API also supports a 300K `max_tokens` output cap on the Message Batches API via the `output-300k-2026-03-24` beta header for Opus 4.6 and Sonnet 4.6, which matters for generating long translated documents in one shot.

---

## The 6-stage pipeline (what each subagent does)

**Stage 1 — Upload:** User picks a PDF in your Next.js frontend. Since this is frontend-only, you read the file with `FileReader`, convert to base64 in the browser, and hold it in state.

**Stage 2 — Extraction subagent:** You send the base64 PDF to `/v1/messages` with a prompt like: *"Extract all text content as structured JSON, preserving page number, paragraph order, and heading hierarchy."* Claude returns a JSON object you can map over in the UI. This is where it works extremely well for text-based PDFs.

**Stage 3 — Translation orchestrator (subagents):** For each target language the user selected, you fire a separate `fetch()` call to `/v1/messages` — all in `Promise.all()` for parallelism. Each subagent receives the extracted text JSON + a prompt like: *"Translate the following document to [Language]. Preserve paragraph structure and heading levels. Return the same JSON structure with translated values."* This is the core translation step. Claude's multilingual quality is genuinely strong here.

**Stage 4 — Edit UI:** You display the original and each translation side-by-side (or as tabs). Each paragraph is an editable `<textarea>`. All edits live in React state — no backend needed.

**Stage 5 — PDF generation subagent (the hard part):** This is where things get nuanced. Claude cannot directly write binary PDFs. Instead: you send the final edited text back to Claude with a prompt to produce structured HTML, then use `pdf-lib` or `jsPDF` in the browser to render it into a downloadable PDF. For RTL languages like Arabic, you'll need to explicitly set text direction in your PDF library — this is a known gap that requires extra handling.

**Stage 6 — Download:** Create a `Blob` from the PDF bytes and trigger a browser download. All client-side. No server needed.

---

## Effectiveness: what works well vs. what doesn't

**Works very well:**
- Text-heavy PDFs (contracts, articles, reports) — extraction and translation quality is high
- Multiple target languages in parallel — each subagent is independent
- Preserving document structure (headings, paragraphs) when you instruct Claude explicitly in your prompt
- The edit layer — pure frontend state management, zero complexity

**Works with caveats:**
- Complex layouts (multi-column, tables, footnotes) — Claude can describe the structure but the PDF you regenerate will lose original layout fidelity. You're essentially producing a "clean text" translated PDF, not a pixel-perfect clone of the original
- Scanned/image-only PDFs — Claude processes these as images and can reason about the visual content, but you cannot extract clean programmatic text from them the way you can with a text-based PDF

**Known hard limits:**
- Each Messages API request can carry up to 32 MB of data — submissions above this are rejected
- For PDFs over 600 pages (the current limit), you'd need to split them before sending
- Font rendering for non-Latin scripts in pdf-lib requires you to bundle and register the appropriate Unicode fonts; the library doesn't handle this automatically

---

## Frontend-only architecture consideration

Since it's a Next.js frontend-only monorepo, you have one important security decision: your Anthropic API key cannot live in client-side code. The correct pattern is a Next.js API Route (`/api/translate`) that proxies the call to Anthropic. This keeps the key server-side even in a "frontend monorepo" setup — Next.js API routes are Node.js serverless functions, not browser code.

---

## Why it "somewhat worked" in Claude chat

The Claude chat interface sends the PDF through the same API infrastructure, and Claude reads it natively. The difference in your app is that you need to capture the structured output (JSON), build the edit UI around it, and handle PDF regeneration yourself — the chat interface just shows text responses.

The translation quality you'd get via API is identical to what you saw in chat. The engineering work is in the surrounding pipeline: structured extraction prompts, parallel language calls, the edit layer, and PDF reconstruction.

Great constraint — this changes the architecture significantly. Let me search for the current state of the art on layout-preserving PDF translation.This fundamentally changes the architecture. Here's the real picture, fully backed by the research.

---

## The core problem with layout preservation

PDFs store text as discrete character blocks at precise coordinates — not as flowing text. Layout and styles (tables, images, fonts) are stored and rendered separately from the textual content. Traditional tools that crudely replace the text layer without reconstructing complex typographical relationships cause complete formatting failure.

This means a "frontend-only" approach with `pdf-lib` in the browser **cannot** achieve true layout preservation. You need a server-side PDF manipulation layer. The good news: a minimal Next.js API route is enough — you don't need a separate backend service.

---

## The real architecture: 4-layer pipeline

The industry-proven technique (confirmed by PyMuPDF docs and open-source research) is:

**Layer 1 — Coordinate extraction (server-side, PyMuPDF via API route)**

`page.get_text("dict")` gives you a full hierarchy of blocks → lines → spans → characters, where every span contains `(x0, y0, x1, y1)` bounding box coordinates, font name, font size, font flags, and color. This is your "translation map" — a JSON structure that knows exactly where every piece of text lives on the page, what it looks like, and what it says.

**Layer 2 — Translation subagents (Claude API, parallel)**

You send the extracted text JSON (without coordinates — just the text content in reading order) to Claude. Each language fires as a parallel `/v1/messages` call. Claude returns the same JSON structure with translated values. This is where Claude excels — it preserves context across paragraphs, handles headings differently from body text, and understands document semantics.

**Layer 3 — Edit UI (Next.js frontend)**

You merge the coordinate map with the translated text. The user sees original vs. translated side-by-side, edits in textareas. Each edit updates a key in the translation map. All pure React state.

**Layer 4 — In-place text substitution (server-side, PyMuPDF)**

The standard approach is redaction annotations: extract the bbox of the old text, apply a redaction to erase it, then insert the new translated text using `insert_htmlbox` which lets PyMuPDF automatically find a suitable font for the target language — this also handles the text expansion problem when translated text is longer than the original.

Images, vector graphics, decorative elements, page borders — they are never touched. Only the text layer is swapped.

---

## The text expansion problem (this is critical)

This is the #1 failure mode of layout-preserving translation. Malayalam, for example, is typically 20–40% wider than the equivalent English text. Arabic contracts but requires RTL handling. French expands. German compounds expand significantly.

The solutions in order of quality:

1. `insert_htmlbox` (PyMuPDF's recommended approach) — it auto-scales font size down to fit the original bounding box, preserving position exactly
2. Auto-shrink font size to fit: calculate the ratio of `new_text_width / original_bbox_width` and scale the font accordingly
3. Allow slight overflow for headings where font size reduction would look wrong

---

## Why "frontend-only" breaks for this requirement

`pdf-lib` (JavaScript, runs in browser) can write text at coordinates, but:
- It cannot redact/erase existing text from the original PDF — only overlay new content
- It has limited font support for non-Latin scripts (Malayalam especially)
- It has no equivalent of `get_text("dict")` — you can't read bounding box metadata from an existing PDF in the browser

**The minimal fix for your monorepo:** One Next.js API route (`/api/process`) that runs PyMuPDF via a Python subprocess or a small Python serverless function (e.g. a Vercel Python runtime). Your frontend remains the app shell; the heavy lifting is one endpoint. This is a standard pattern in Next.js monorepos.

---

## Revised subagent architecture

```
User uploads PDF
      ↓
/api/extract  →  PyMuPDF get_text("dict")
                 Returns: { pages: [{ blocks: [{ bbox, text, font, size, color }] }] }
      ↓
Claude Subagent ×N languages  (Promise.all in Next.js API route)
  Input:  extracted text blocks (no coords, just text + block IDs)
  Output: { blockId: "translated text" } map per language
      ↓
Edit UI  (React state — user reviews/edits each block)
      ↓
/api/rebuild  →  PyMuPDF redact old text → insert_htmlbox new text
                 Returns: translated PDF bytes (same layout, images, styling)
      ↓
Browser download
```

---

## What is genuinely preserved vs. what isn't

Genuinely preserved — all images, vector graphics, page size, margins, headers/footers, tables (structure), colors, background elements, non-text decorations, embedded fonts for untouched pages.

Not perfectly preserved in all cases — fonts for the translated language (PDFs embed fonts; the original Malayalam font isn't present in an English PDF, so PyMuPDF substitutes a system/bundled font that may look slightly different). Complex multi-column layouts where text reflow would require changing the other column too.

The honest benchmark: tools like BabelDOC/pdf2zh (the open-source state of the art for this problem) detect layout using DocLayout-YOLO, extract text with exact coordinates, send to an LLM for translation, then reconstruct by placing all translated elements back into their original positions — keeping formatting, styles, images, and spacing intact. Your pipeline follows the same architecture, with Claude as the translation LLM.