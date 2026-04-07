# Sarvam API Reference: PDF Translation with Layout Preservation

> **Complete API reference for multilingual document processing focusing on OCR, layout preservation, and PDF translation workflows**.

---

## Executive Summary

Sarvam AI provides a comprehensive API suite for PDF translation and OCR with layout preservation. The **Document Intelligence API** is the primary tool for PDF processing, supporting 22+ Indian languages with HTML/JSON/Markdown output formats that preserve document structure. Paired with the Text Translation and Language Detection APIs, you can build complete multilingual document workflows.

**Key Features:**
- Async job processing with webhook callbacks
- Layout-preserving HTML output format
- 22+ Indian languages supported
- Per-page processing metrics & error tracking
- File size limit: 200 MB, Page limit: ~10 pages per job

---

## Endpoint Matrix

| **Category** | **Method** | **Endpoint** | **Purpose** | **Async** | **URL** |
|---|---|---|---|---|---|
| **Document Intelligence** | `POST` | `/doc-digitization/job/v1` | Create OCR/digitization job | Yes | https://docs.sarvam.ai/api-reference-docs/document-intelligence |
| | `POST` | `/doc-digitization/job/v1/upload-files` | Get presigned upload URLs | Yes | https://docs.sarvam.ai/api-reference-docs/document-intelligence/get-upload-links |
| | `POST` | `/doc-digitization/job/v1/:job_id/start` | Start async processing | Yes | https://docs.sarvam.ai/api-reference-docs/document-intelligence/start |
| | `GET` | `/doc-digitization/job/v1/:job_id/status` | Poll job status & metrics | No | https://docs.sarvam.ai/api-reference-docs/document-intelligence/get-status |
| | `POST` | `/doc-digitization/job/v1/:job_id/download-files` | Get presigned download URLs | No | https://docs.sarvam.ai/api-reference-docs/document-intelligence/get-download-links |
| **Text Translation** | `POST` | `/translate` | Real-time text translation | No | https://docs.sarvam.ai/api-reference-docs/text/translate-text |
| **Language Detection** | `POST` | `/text-lid` | Identify language & script | No | https://docs.sarvam.ai/api-reference-docs/text/identify-language |
| **Transliteration** | `POST` | `/transliterate` | Convert script (Indic ↔ Latin) | No | https://docs.sarvam.ai/api-reference-docs/text/transliterate-text |
| **Speech-to-Text** | `POST` | `/speech-to-text` | Transcribe/translate audio | No | https://docs.sarvam.ai/api-reference-docs/speech-to-text |

---

## Document Intelligence API (OCR with Layout Preservation)

### 1. Create Job
**Endpoint:** `POST /doc-digitization/job/v1`  
**Status Code:** `202 Accepted`  
**URL Reference:** https://docs.sarvam.ai/api-reference-docs/document-intelligence

#### Required Fields
- **None** (body can be empty `{}`)

#### Optional Request Parameters
```json
{
  "job_parameters": {
    "language": "hi-IN",        // BCP-47 language code (default: hi-IN)
    "output_format": "html"     // html | md | json (default: md)
  },
  "callback": {
    "url": "https://example.com/webhook",
    "retry_count": 3
  }
}
```

**Supported Languages:** 22+ Indic + English
- Core: `hi-IN`, `en-IN`, `bn-IN`, `gu-IN`, `kn-IN`, `ml-IN`, `mr-IN`, `od-IN`, `pa-IN`, `ta-IN`, `te-IN`, `ur-IN`
- Extended: `as-IN`, `bodo-IN`, `doi-IN`, `ks-IN`, `kok-IN`, `mai-IN`, `mni-IN`, `ne-IN`, `sa-IN`, `sat-IN`, `sd-IN`

**Output Formats:**
- `html`: Structured HTML preserving layout & spacing (best for layout preservation)
- `md`: Markdown format (default)
- `json`: Structured JSON for programmatic access

#### Response Schema
```json
{
  "job_id": "uuid",                           // Use for all subsequent calls
  "job_state": "Accepted",                    // Accepted | Pending | Running | Completed | PartiallyCompleted | Failed
  "job_parameters": { "language": "hi-IN", "output_format": "html" },
  "storage_container_type": "Azure"           // Azure | Local | Google | Azure_V1
}
```

---

### 2. Get Upload URLs
**Endpoint:** `POST /doc-digitization/job/v1/upload-files`  
**Status Code:** `200 OK`  
**URL Reference:** https://docs.sarvam.ai/api-reference-docs/document-intelligence/get-upload-links

#### Required Fields
```json
{
  "job_id": "uuid",
  "files": ["invoice_2024.pdf"]  // Array with exactly 1 filename
}
```

#### File Constraints
- **File Types:** `.pdf` or `.zip`
- **PDF:** Parseable, max 200 MB
- **ZIP:** Contains only JPEG/PNG images, flat structure (max one nesting level), ≥1 valid image
- **Page/Image Limit:** ≤10 total (returns `422: max_page_limit_exceeded` if exceeded)

#### Response Schema
```json
{
  "job_id": "uuid",
  "job_state": "Accepted",
  "upload_urls": {
    "invoice_2024.pdf": {
      "url": "https://presigned-url...",
      "method": "PUT",
      "headers": { "Content-Type": "application/pdf" }
    }
  },
  "storage_container_type": "Azure"
}
```

**Upload Method:** Use presigned URL with `PUT` request & file content as body.

---

### 3. Start Processing Job
**Endpoint:** `POST /doc-digitization/job/v1/:job_id/start`  
**Status Code:** `202 Accepted`  
**URL Reference:** https://docs.sarvam.ai/api-reference-docs/document-intelligence/start

#### Request
```json
{}  // Empty body
```

#### Validation Checks (returns 422 if failed)
- File must be uploaded
- File size ≤ 200 MB
- PDF must parse correctly
- ZIP constraints (flat, JPEG/PNG only, ≥1 image)
- Page/image count ≤ 10 (error: `max_page_limit_exceeded`)
- User has sufficient API credits

#### Response Schema
```json
{
  "job_id": "uuid",
  "job_state": "Pending",           // Transitions from Accepted → Pending → Running
  "job_details": [
    {
      "inputs": [{ "file_name": "invoice_2024.pdf", "file_id": "uuid" }],
      "outputs": [{ "file_name": "invoice_2024_output.json", "file_id": "uuid" }],
      "state": "Pending",
      "total_pages": 5,
      "pages_processed": 0,
      "pages_succeeded": 0,
      "pages_failed": 0,
      "error_message": "",
      "page_errors": []
    }
  ]
}
```

---

### 4. Poll Job Status
**Endpoint:** `GET /doc-digitization/job/v1/:job_id/status`  
**Status Code:** `200 OK`  
**URL Reference:** https://docs.sarvam.ai/api-reference-docs/document-intelligence/get-status

#### Response Schema
```json
{
  "job_id": "uuid",
  "job_state": "Running",                 // Terminal states: Completed | PartiallyCompleted | Failed
  "created_at": "2024-01-15T09:30:00Z",   // ISO 8601
  "updated_at": "2024-01-15T10:00:00Z",   // ISO 8601
  "total_files": 1,
  "successful_files_count": 1,
  "failed_files_count": 0,
  "error_message": "",
  "job_details": [
    {
      "file_name": "invoice_2024.pdf",
      "state": "Running",
      "total_pages": 12,
      "pages_processed": 8,                // Incremental progress metric
      "pages_succeeded": 8,
      "pages_failed": 0,
      "page_errors": []                    // Array of { page_number, error_code, error_message }
    }
  ]
}
```

**Job States:**
- `Accepted`: Created, awaiting file upload
- `Pending`: File uploaded, ready to start
- `Running`: Processing in progress (check per-page metrics)
- `Completed`: All pages succeeded
- `PartiallyCompleted`: Some pages succeeded, some failed (can retrieve partial output)
- `Failed`: All failed or job-level error

**Polling Strategy:**
- Poll every 5-10 seconds for real-time progress
- Or use webhook callback (set in job_parameters) for async notification

---

### 5. Get Download URLs (when job complete)
**Endpoint:** `POST /doc-digitization/job/v1/:job_id/download-files`  
**Status Code:** `200 OK`  
**URL Reference:** https://docs.sarvam.ai/api-reference-docs/document-intelligence/get-download-links

#### Request
```json
{}  // Empty body
```

#### Prerequisites
- Job in `Completed` or `PartiallyCompleted` state
- Failed jobs return no output

#### Response Schema
```json
{
  "job_id": "uuid",
  "job_state": "Completed",
  "download_urls": {
    "invoice_2024_output.html": {               // Based on output_format
      "file_url": "https://presigned-url...",
      "file_metadata": {
        "contentType": "text/html",
        "fileSizeBytes": 245760,
        "lastModified": "2024-06-15T10:20:30Z"
      }
    },
    "invoice_2024_output.json": {
      "file_url": "https://presigned-url...",
      "file_metadata": {
        "contentType": "application/json",
        "fileSizeBytes": 10240,
        "lastModified": "2024-06-15T10:20:30Z"
      }
    }
  },
  "error_code": null,
  "error_message": null
}
```

**Output Files:**
- Generated as **ZIP archive** containing all output files for the job
- Multiple output formats can be generated per language
- Presigned URLs expire (check lastModified)

---

## Text Translation API (Real-Time)

### Endpoint: `POST /translate`
**Status Code:** `200 OK`  
**URL Reference:** https://docs.sarvam.ai/api-reference-docs/text/translate-text

#### Required Fields
```json
{
  "input": "मैं ऑफिस जा रहा हूँ",        // Max 1000 chars (mayura:v1) or 2000 chars (sarvam-translate:v1)
  "source_language_code": "hi-IN",      // 'auto' supported with mayura:v1
  "target_language_code": "en-IN"
}
```

**Supported Language Pairs:**
- **mayura:v1** (12 languages): en-IN, hi-IN, bn-IN, gu-IN, kn-IN, ml-IN, mr-IN, od-IN, pa-IN, ta-IN, te-IN
- **sarvam-translate:v1** (22 languages): all mayura:v1 + as-IN, brx-IN, doi-IN, kok-IN, ks-IN, mai-IN, mni-IN, ne-IN, sa-IN, sat-IN, sd-IN, ur-IN

#### Optional Parameters
```json
{
  "model": "mayura:v1",                         // mayura:v1 | sarvam-translate:v1 (default: mayura:v1)
  "mode": "formal",                             // formal | modern-colloquial | classic-colloquial | code-mixed
                                                // ⚠️ sarvam-translate:v1 only supports 'formal'
  "speaker_gender": "Male",                     // Male | Female (improves context)
  "output_script": "roman",                     // null (default) | roman | fully-native | spoken-form-in-native
                                                // ⚠️ mayura:v1 only; sarvam-translate:v1 doesn't support
  "numerals_format": "international"            // international (0-9, default) | native (language-specific numerals)
}
```

**Example with output_script:**
- Input: `"Your EMI of Rs. 3000 is pending"`
- Default (null): `"आपका Rs. 3000 का EMI pending है"`
- `roman`: `"aapka Rs. 3000 ka EMI pending hai"`
- `fully-native`: Transliterated in native script with formal style

#### Response Schema
```json
{
  "request_id": "uuid",
  "translated_text": "I am going to the office",
  "source_language_code": "hi-IN"
}
```

---

## Language Detection API (Real-Time)

### Endpoint: `POST /text-lid`
**Status Code:** `200 OK`  
**URL Reference:** https://docs.sarvam.ai/api-reference-docs/text/identify-language

#### Required Fields
```json
{
  "input": "यह एक उदाहरण वाक्य है"  // Max 1000 characters
}
```

#### Response Schema
```json
{
  "request_id": "uuid",
  "language_code": "hi-IN",               // BCP-47 code
  "script_code": "Deva"                   // ISO 15924 script code
}
```

**Supported Scripts:**
- `Latn`: Latin (Romanized script)
- `Deva`: Devanagari (Hindi, Marathi)
- `Beng`: Bengali
- `Gujr`: Gujarati
- `Knda`: Kannada
- `Mlym`: Malayalam
- `Orya`: Odia
- `Guru`: Gurmukhi (Punjabi)
- `Taml`: Tamil
- `Telu`: Telugu

---

## Transliteration API (Real-Time)

### Endpoint: `POST /transliterate`
**Status Code:** `200 OK`  
**URL Reference:** https://docs.sarvam.ai/api-reference-docs/text/transliterate-text

#### Required Fields
```json
{
  "input": "मैं ऑफिस जा रहा हूँ",
  "source_language_code": "hi-IN",        // Indic language or en-IN
  "target_language_code": "en-IN"         // Indic language or en-IN
}
```

**Supported Pairs:** Indic ↔ English, Indic ↔ Indic

#### Optional Parameters
```json
{
  "numerals_format": "international",     // international (0-9, default) | native
  "spoken_form": true,                    // Convert to natural spoken form (default: false)
  "spoken_form_numerals_language": "english"  // english | native (only works when spoken_form: true)
}
```

**Example with spoken_form:**
- Input: `"मुझे कल 9:30am को appointment है"`
- Output: `"मुझे कल सुबह साढ़े नौ बजे को अपॉइंटमेंट है"`

#### Response Schema
```json
{
  "request_id": "uuid",
  "transliterated_text": "main office ja raha hun",
  "source_language_code": "hi-IN"
}
```

---

## Speech-to-Text API with Translate Mode

### Endpoint: `POST /speech-to-text`
**Status Code:** `200 OK`  
**URL Reference:** https://docs.sarvam.ai/api-reference-docs/speech-to-text

#### Required Fields
```
Multipart form-data:
- file: [audio file binary]
```

**Supported Formats:** WAV, MP3, AAC, AIFF, OGG, OPUS, FLAC, MP4/M4A, AMR, WMA, WebM, PCM  
**Optimal Sample Rate:** 16 kHz  
**Note:** PCM files must specify `input_audio_codec` parameter

#### Optional Parameters
```json
{
  "model": "saaras:v3",                   // saarika:v2.5 (default) | saaras:v3
  "mode": "translate",                    // transcribe | translate | verbatim | translit | codemix
                                          // ⚠️ mode only works with saaras:v3
  "language_code": "hi-IN",               // Optional; if not provided, auto-detected
  "input_audio_codec": "pcm_s16le"        // Required only for PCM files
}
```

**Mode Behaviors (saaras:v3 only):**
- `transcribe`: Standard transcription in original language with formatting
- `translate`: Translates speech from Indic lang to English
- `verbatim`: Word-for-word without normalization
- `translit`: Romanization to Latin script
- `codemix`: English words in English, Indic words in native script

#### Response Schema
```json
{
  "request_id": "uuid",
  "transcript": "My phone number is 9840950950",
  "language_code": "hi-IN",
  "language_probability": 0.95,           // Confidence 0-1.0
  "timestamps": {
    "words": ["मेरा", "phone", "number"],
    "start_time_seconds": [0, 0.5, 1.2],
    "end_time_seconds": [0.4, 1.1, 1.8]
  },
  "diarized_transcript": {                // If diarization available
    "entries": [{ "transcript": "...", "speaker_id": "speaker_1", "start_time_seconds": 0 }]
  }
}
```

---

## Async Job Flow: Complete State Diagram

```
┌──────────────────────────────────────────────────────────────┐
│ CREATE JOB (POST /doc-digitization/job/v1)                  │
│ → Returns job_id, job_state: "Accepted"                     │
└─────────────────────────────────────────┬────────────────────┘
                                          ↓
┌──────────────────────────────────────────────────────────────┐
│ GET UPLOAD URLS (POST /upload-files)                        │
│ → Returns presigned PUT URL for file upload                 │
│ → Upload file via HTTP PUT to presigned URL                 │
└─────────────────────────────────────────┬────────────────────┘
                                          ↓
┌──────────────────────────────────────────────────────────────┐
│ START JOB (POST /start)                                     │
│ → Validates file, transitions to job_state: "Pending"      │
│ → Returns initial job_details[] array                       │
└─────────────────────────────────────────┬────────────────────┘
                                          ↓
              ┌───────────────────────────────────────────────┐
              │ POLL STATUS (GET /status) every 5-10 sec    │
              │ OR set webhook callback for async notify      │
              ├───────────────────────────────────────────────┤
              │ States:                                        │
              │  • Pending → Running (pages_processed ↑)     │
              │  • Running continues (check page metrics)     │
              │  • Completed (pages_succeeded == total)       │
              │  • PartiallyCompleted (mixed succeed/fail)    │
              │  • Failed (pages_failed > 0, no output)       │
              └────────────────────┬──────────────────────────┘
                     Terminal state reached
                                  ↓
         ┌────────────────────────────────────────┐
         │ GET DOWNLOAD URLS (POST /download)    │
         │ (Available in Completed or            │
         │  PartiallyCompleted state)            │
         │ → Returns presigned download URLs     │
         │ → Download output files (ZIP)         │
         └────────────────────────────────────────┘
```

**Webhook Callback Format:**
```json
{
  "url": "https://your-domain.com/webhook",
  "retry_count": 3                    // Number of retries on failure
}
```
Callback POSTs the job status object when `job_state` changes to terminal state.

---

## Recommended Pipeline: PDF Translation with Layout Preservation

### **Goal: Translate PDF from Hindi to Gujarati, preserving layout & images**

#### **Step-by-Step Implementation**

```python
import requests
import json
import time
import zipfile
from pathlib import Path

SARVAM_API_KEY = "your_api_key"
BASE_URL = "https://api.sarvam.ai"

# Step 1: Create Document Intelligence Job
def create_job(source_lang: str, target_lang: str, output_format: str = "html"):
    """Create async digitization job."""
    headers = {"api-subscription-key": SARVAM_API_KEY, "Content-Type": "application/json"}
    
    payload = {
        "job_parameters": {
            "language": source_lang,        # Language detected in OCR (source)
            "output_format": output_format  # 'html' for layout preservation
        }
    }
    
    resp = requests.post(f"{BASE_URL}/doc-digitization/job/v1", json=payload, headers=headers)
    assert resp.status_code == 202, f"Job creation failed: {resp.text}"
    
    job_data = resp.json()
    job_id = job_data["job_id"]
    print(f"✓ Job created: {job_id}, state: {job_data['job_state']}")
    
    return job_id, source_lang, target_lang

# Step 2: Get upload URLs
def get_upload_urls(job_id: str, filename: str):
    """Get presigned upload URLs."""
    headers = {"api-subscription-key": SARVAM_API_KEY, "Content-Type": "application/json"}
    
    payload = {"job_id": job_id, "files": [filename]}
    
    resp = requests.post(f"{BASE_URL}/doc-digitization/job/v1/upload-files", 
                        json=payload, headers=headers)
    assert resp.status_code == 200, f"Upload URL fetch failed: {resp.text}"
    
    data = resp.json()
    upload_url = data["upload_urls"][filename]["url"]
    print(f"✓ Got upload URL, state: {data['job_state']}")
    
    return upload_url

# Step 3: Upload file
def upload_file(upload_url: str, file_path: str):
    """Upload file via presigned URL."""
    with open(file_path, "rb") as f:
        resp = requests.put(upload_url, data=f.read())
    
    assert resp.status_code == 200, f"File upload failed: {resp.status_code}"
    print(f"✓ File uploaded: {file_path}")

# Step 4: Start job
def start_job(job_id: str):
    """Start async processing."""
    headers = {"api-subscription-key": SARVAM_API_KEY, "Content-Type": "application/json"}
    
    resp = requests.post(f"{BASE_URL}/doc-digitization/job/v1/{job_id}/start", 
                        json={}, headers=headers)
    assert resp.status_code == 202, f"Job start failed: {resp.text}"
    
    data = resp.json()
    print(f"✓ Job started, state: {data['job_state']}, total_pages: {data['job_details'][0]['total_pages']}")

# Step 5: Poll status with page metrics
def poll_job_status(job_id: str, max_wait_sec: int = 3600):
    """Poll until completion, tracking progress."""
    headers = {"api-subscription-key": SARVAM_API_KEY}
    
    start_time = time.time()
    last_progress = -1
    
    while True:
        resp = requests.get(f"{BASE_URL}/doc-digitization/job/v1/{job_id}/status", 
                           headers=headers)
        assert resp.status_code == 200
        
        data = resp.json()
        job_state = data["job_state"]
        
        # Track per-page progress
        if data["job_details"]:
            job_detail = data["job_details"][0]
            progress = job_detail["pages_processed"]
            total = job_detail["total_pages"]
            
            if progress > last_progress:
                print(f"Progress: {progress}/{total} pages processed, state: {job_state}")
                last_progress = progress
        
        # Terminal states
        if job_state in ["Completed", "PartiallyCompleted", "Failed"]:
            return data
        
        if time.time() - start_time > max_wait_sec:
            raise TimeoutError(f"Job did not complete within {max_wait_sec}s")
        
        time.sleep(5)  # Poll every 5 seconds

# Step 6: Get download URLs
def get_download_urls(job_id: str):
    """Get presigned download URLs for output files."""
    headers = {"api-subscription-key": SARVAM_API_KEY, "Content-Type": "application/json"}
    
    resp = requests.post(f"{BASE_URL}/doc-digitization/job/v1/{job_id}/download-files", 
                        json={}, headers=headers)
    assert resp.status_code == 200, f"Download URL fetch failed: {resp.text}"
    
    return resp.json()

# Step 7: Download output
def download_output(download_urls_data, output_dir: str = "output"):
    """Download output files from presigned URLs."""
    Path(output_dir).mkdir(exist_ok=True)
    
    for filename, metadata in download_urls_data["download_urls"].items():
        file_url = metadata["file_url"]
        
        resp = requests.get(file_url)
        assert resp.status_code == 200
        
        # Output is ZIP archive
        if filename.endswith(".zip"):
            zip_path = f"{output_dir}/{filename}"
            with open(zip_path, "wb") as f:
                f.write(resp.content)
            print(f"✓ Downloaded: {filename}")
            
            # Extract
            with zipfile.ZipFile(zip_path, "r") as z:
                z.extractall(output_dir)
                print(f"✓ Extracted to {output_dir}/")

# Step 8: Translate extracted text (Optional)
def translate_text_batch(text: str, source_lang: str, target_lang: str) -> str:
    """Translate extracted text using real-time API."""
    headers = {"api-subscription-key": SARVAM_API_KEY, "Content-Type": "application/json"}
    
    # Chunk if > 2000 chars
    if len(text) > 2000:
        chunks = [text[i:i+2000] for i in range(0, len(text), 2000)]
        translated = [translate_text_batch(chunk, source_lang, target_lang) for chunk in chunks]
        return "".join(translated)
    
    payload = {
        "input": text,
        "source_language_code": source_lang,
        "target_language_code": target_lang,
        "model": "sarvam-translate:v1",       # Supports all 22 languages
        "mode": "formal"
    }
    
    resp = requests.post(f"{BASE_URL}/translate", json=payload, headers=headers)
    assert resp.status_code == 200
    
    return resp.json()["translated_text"]

# Main Pipeline
def pdf_translation_pipeline(pdf_path: str, source_lang: str = "hi-IN", target_lang: str = "gu-IN"):
    """Full workflow: OCR PDF → Extract → Translate → Output."""
    
    print("\n=== PDF Translation Pipeline ===\n")
    
    # 1. Create job
    job_id, src, tgt = create_job(source_lang=source_lang, target_lang=target_lang, output_format="html")
    
    # 2. Get upload URL
    filename = Path(pdf_path).name
    upload_url = get_upload_urls(job_id, filename)
    
    # 3. Upload file
    upload_file(upload_url, pdf_path)
    
    # 4. Start processing
    start_job(job_id)
    
    # 5. Poll until complete
    final_status = poll_job_status(job_id)
    print(f"\nFinal status: {final_status['job_state']}")
    
    if final_status['job_state'] == "Failed":
        print(f"Job failed: {final_status['error_message']}")
        return
    
    # 6. Download output
    download_data = get_download_urls(job_id)
    download_output(download_data)
    
    # 7. Extract and translate (optional)
    html_file = "output/extracted.html"
    if Path(html_file).exists():
        with open(html_file, "r", encoding="utf-8") as f:
            content = f.read()
        
        # Parse HTML and extract text (use BeautifulSoup for production)
        # Then translate
        print(f"\n✓ Pipeline complete. Output in ./output/")

# Usage
if __name__ == "__main__":
    pdf_translation_pipeline("invoice_hindi.pdf", source_lang="hi-IN", target_lang="gu-IN")
```

---

## Output Format Details

### **HTML Output (Layout Preservation)**
Best for maintaining visual structure. Example:
```html
<html>
<head><title>Document</title></head>
<body>
  <div class="page" style="width:595px; height:842px; position:relative;">
    <div style="position:absolute; top:100px; left:50px; font-size:14px;">
      Invoice Date: 15-Jan-2024
    </div>
    <table style="position:absolute; top:200px; width:500px;">
      <tr><td>Item</td><td>Qty</td><td>Price</td></tr>
      ...
    </table>
  </div>
</body>
</html>
```

### **JSON Output (Programmatic)**
Structured for backend processing:
```json
{
  "pages": [
    {
      "page_number": 1,
      "blocks": [
        {
          "type": "text",
          "text": "Invoice Date: 15-Jan-2024",
          "coordinates": { "x": 50, "y": 100, "width": 300, "height": 20 }
        },
        {
          "type": "table",
          "rows": [
            { "cells": ["Item", "Qty", "Price"] }
          ]
        }
      ]
    }
  ]
}
```

### **Markdown Output (Default)**
Human-readable, simpler structure:
```markdown
# Page 1

## Invoice Date: 15-Jan-2024

| Item | Qty | Price |
|------|-----|-------|
| ...  | ... | ...   |
```

---

## Error Handling & Status Codes

| **Code** | **Scenario** | **Recovery** |
|---|---|---|
| 202 | Job created/started successfully | Normal async flow |
| 200 | Real-time endpoint succeeded | Use response directly |
| 400 | Bad request (invalid params) | Check field names, language codes, formats |
| 403 | Auth failed (invalid API key) | Verify `api-subscription-key` header |
| 422 | Validation failed (page limit, file type) | Check job_details[].page_errors[] for details |
| 429 | Rate limited | Increase polling interval, consider batching |
| 500 | Server error | Retry with exponential backoff |
| 503 | Service unavailable | Retry later |

**Page Errors Example:**
```json
{
  "job_details": [
    {
      "page_errors": [
        { "page_number": 3, "error_code": "image_processing_failed", "error_message": "Page 3 failed OCR" }
      ]
    }
  ]
}
```

---

## Language Support Reference

### **22+ Supported Languages (Document Intelligence)**

| **Language** | **Code** | **Script** | **Transliterate** | **Translate** |
|---|---|---|---|---|
| Hindi | `hi-IN` | Devanagari | ✅ | ✅ |
| English | `en-IN` | Latin | ✅ | ✅ |
| Bengali | `bn-IN` | Bengali | ✅ | ✅ |
| Gujarati | `gu-IN` | Gujarati | ✅ | ✅ |
| Kannada | `kn-IN` | Kannada | ✅ | ✅ |
| Malayalam | `ml-IN` | Malayalam | ✅ | ✅ |
| Marathi | `mr-IN` | Devanagari | ✅ | ✅ |
| Odia | `od-IN` | Odia | ✅ | ✅ |
| Punjabi | `pa-IN` | Gurmukhi | ✅ | ✅ |
| Tamil | `ta-IN` | Tamil | ✅ | ✅ |
| Telugu | `te-IN` | Telugu | ✅ | ✅ |
| Urdu | `ur-IN` | Perso-Arabic | ✅ | ✅ |
| Assamese | `as-IN` | Bengali | ✅ | ✅ |
| Bodo | `brx-IN` | Devanagari | ✅ | ✅ |
| Dogri | `doi-IN` | Devanagari | ✅ | ✅ |
| Konkani | `kok-IN` | Devanagari | ✅ | ✅ |
| Kashmiri | `ks-IN` | Perso-Arabic | ✅ | ✅ |
| Maithili | `mai-IN` | Devanagari | ✅ | ✅ |
| Manipuri | `mni-IN` | Meitei | ✅ | ✅ |
| Nepali | `ne-IN` | Devanagari | ✅ | ✅ |
| Sanskrit | `sa-IN` | Devanagari | ✅ | ✅ |
| Santali | `sat-IN` | Ol Chiki | ✅ | ✅ |
| Sindhi | `sd-IN` | Perso-Arabic | ✅ | ✅ |

---

## Rate Limits & Credit Usage

- **Document Intelligence:** 1 job = ~50-200 credits (depends on page count)
- **Text Translation:** Per 100 characters
- **Language Detection:** Per request
- **Rate Limit:** Check response headers `X-RateLimit-Remaining`

---

## Resources & Examples

| **Resource** | **URL** |
|---|---|
| Official Documentation | https://docs.sarvam.ai |
| API Playground | https://dashboard.sarvam.ai |
| Python Cookbook (Doc Intelligence) | https://github.com/sarvamai/sarvam-ai-cookbook/blob/main/notebooks/doc-intelligence/Document_Intelligence.ipynb |
| Translate API Tutorial | https://github.com/sarvamai/sarvam-ai-cookbook/blob/main/notebooks/translate/Translate_API_Tutorial.ipynb |
| Sarvam AI SDK (Python) | `pip install sarvamai` |
| Discord Community | https://discord.com/invite/5rAsykttcs |

---

## Quick Checklist: PDF Translation with Layout Preservation

- [ ] Create job with `output_format: "html"` for layout preservation
- [ ] Upload PDF (<200 MB, ≤10 pages) via presigned URL
- [ ] Start job and poll status with page-level metrics
- [ ] Check for page errors in poll responses
- [ ] Download HTML output to preserve formatting
- [ ] Parse HTML to extract text blocks
- [ ] Translate text using `/translate` API with appropriate language codes
- [ ] Regenerate layout with translated text (advanced: use `output_script` for typography options)
- [ ] Consider webhook callback for long-running jobs instead of polling

---

**Document Last Updated:** April 2, 2026  
**API Versions Covered:** Document Intelligence v1, Text APIs latest  
**Citation Format:** [Sarvam API Reference](https://docs.sarvam.ai/api-reference-docs/)