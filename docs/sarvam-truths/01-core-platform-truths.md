# Sarvam AI API Documentation Report

## 1) Authentication Scheme & Headers

**Header:** `api-subscription-key`  
**Format:** Include in all API request headers as `api-subscription-key: <your-api-key>`

**Key Management:**
- Generate API keys manually from [Sarvam Dashboard](https://dashboard.sarvam.ai/)
- Store in environment variables (never hardcode)
- All API keys under an account share the same rate limit pool (per-account enforcement)
- Monitor usage on dashboard; credits do not expire

**Reference:** [Authentication](https://docs.sarvam.ai/api-reference-docs/authentication)

---

## 2) Base URL & Versioning Notes

- **Base Domain:** `api.sarvam.ai` (inferred from SDK patterns)
- **SDKs Available:** Python (`pip install sarvamai`), JavaScript (`npm install sarvamai`)
- **API Format:** OpenAI-compatible chat completions format
- **Versioning:** Models use version suffixes (e.g., `saaras:v3`, `bulbul:v3`, `sarvam-translate:v1`)
- **Deprecation Example:** `bulbul:v1` deprecated April 30, 2025; migrate to `bulbul:v2` or `v3`

**Reference:** [Developer Quickstart](https://docs.sarvam.ai/api-reference-docs/getting-started/quickstart), [Libraries & SDKs](https://docs.sarvam.ai/api-reference-docs/getting-started/sd-ks-libraries)

---

## 3) Rate Limits & Pricing

### **Free Credits & Plans**
- **Sign-up Bonus:** ₹1,000 free credits per user (never expire)
- **Plan Tiers:**
  - **Starter:** Pay-as-you-go; 60 req/min; ₹1,000 bonus credits
  - **Pro:** ₹10,000/month; 200 req/min; ₹7,500 bonus credits
  - **Business:** ₹50,000/month; 1,000 req/min; custom bonus
  - **Enterprise:** Custom pricing with dedicated support

**Reference:** [Pricing](https://docs.sarvam.ai/api-reference-docs/pricing), [Credits & Rate Limits](https://docs.sarvam.ai/api-reference-docs/ratelimits)

### **Per-API Rate Limits (by Concurrency Mode)**

Limits apply per-account across three concurrency modes: **Provisioned** (guaranteed), **Burst** (temporary spike), **High Throughput** (heavy platform load).

**Speech-to-Text REST (`stt-rt`):**
| Plan | Provisioned | Burst | High Throughput |
|------|------------|-------|-----------------|
| Starter | 60 req/min | 100 req/min | 5 req/min |
| Pro | 100 req/min | 200 req/min | 60 req/min |
| Business | 4,000 req/min | 5,000 req/min | 1,000 req/min |

**Speech-to-Text WebSocket (`stt-ws`):**
| Plan | Provisioned | Burst | High Throughput |
|------|------------|-------|-----------------|
| Starter | 20 concurrent | 40 concurrent | 5 concurrent |
| Pro | 100 concurrent | 150 concurrent | 60 concurrent |
| Business | 100 concurrent | 150 concurrent | 100 concurrent |

**Text-to-Speech REST (`tts-rt`):**
| Plan | Provisioned | Burst | High Throughput |
|------|------------|-------|-----------------|
| Starter | 60 req/min | 100 req/min | 5 req/min |
| Pro | 200 req/min | 300 req/min | 60 req/min |
| Business | 1,000 req/min | 1,200 req/min | 800 req/min |

**Note for Bulbul v3:** Starter provisioned = 30 req/min (burst: 50); Pro/Business limits unchanged.

**Chat Completion (LLM):**
- **Default models (`ms-llm`):** Same as Speech-to-Text REST
- **Large models (Sarvam-30B, 105B):** Lower limits due to compute:
  - Starter: 40 req/min; Pro: 60 req/min; Business: 120 req/min

**Vision APIs:** Uniform across all plans (10 req/min provisioned for Document Intelligence; 30 req/min for Vision Real-time)

**Reference:** [Credits & Rate Limits](https://docs.sarvam.ai/api-reference-docs/ratelimits)

### **Pricing by Service**

| Service | Price | Unit |
|---------|-------|------|
| **Chat Completion** | ₹0 | per token (Sarvam-M free) |
| **Speech-to-Text** | ₹30 | per hour (billed per second) |
| **STT + Diarization** | ₹45 | per hour |
| **STT + Translate** | ₹30 | per hour |
| **Text Translation** | ₹20 | per 10K characters |
| **Language ID** | ₹3.5 | per 10K characters |
| **Text-to-Speech (Bulbul v2)** | ₹15 | per 10K characters |
| **Text-to-Speech (Bulbul v3 beta)** | ₹30 | per 10K characters |
| **Document Intelligence** | ₹1.5 | per page (max 10 pages/job) |

**Reference:** [Pricing](https://docs.sarvam.ai/api-reference-docs/pricing)

---

## 4) Model Catalog with Capabilities & Use Cases

### **Speech-to-Text: Saaras v3**
**Model ID:** `saaras:v3`  
**Capability:** State-of-the-art ASR with 23 language support (22 Indian + English)  
**Output Modes:**
- `transcribe` (default): Standard transcription with proper formatting & number normalization
- `translate`: Direct speech-to-English translation
- `verbatim`: Exact word-for-word with filler words preserved
- `translit`: Romanization to Latin script
- `codemix`: Code-mixed output (English words in English, Indic in native script)

**Key Features:**
- Domain-aware translation with hotword retention
- Superior telephony performance (8 kHz support)
- Intelligent entity preservation for proper nouns
- Speaker diarization with timestamps (batch API)
- Language auto-detection with confidence scores

**Languages:** Hindi, Bengali, Tamil, Telugu, Kannada, Malayalam, Marathi, Gujarati, Punjabi, Odia, English, Assamese, Urdu, Nepali, Konkani, Kashmiri, Sindhi, Sanskrit, Santali, Manipuri, Bodo, Maithili, Dogri

**When to Use:** Call center analysis, voice assistants, accessibility applications, real-time transcription  
**Reference:** [Saaras v3](https://docs.sarvam.ai/api-reference-docs/getting-started/models/saaras), [Changelog](https://docs.sarvam.ai/api-reference-docs/changelog)

---

### **Text-to-Speech: Bulbul v3**
**Model ID:** `bulbul:v3`  
**Capability:** Natural-sounding voices for 11 languages with 30+ speaker options  
**Key Features:**
- 30+ speaker voices (Shubh, Aditya, Ritu, Simran, Anand, Roopa, Priya, etc.)
- Extended character limit: up to 2,500 characters per request
- Adjustable pace (0.5x to 2.0x) and pitch control
- Sample rate options: 8 kHz, 16 kHz, 22.05 kHz, 24 kHz (default); 32 kHz, 44.1 kHz, 48 kHz in REST API only
- Natural prosody with emotional expression

**Languages:** Hindi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Marathi, Punjabi, Odia, English

**When to Use:** Customer service, content localization, interactive voice response (IVR), accessibility  
**Deprecation Note:** Bulbul v1 deprecated April 30, 2025  
**Reference:** [Bulbul v3](https://docs.sarvam.ai/api-reference-docs/getting-started/models/bulbul)

---

### **Translation: Mayura v1**
**Model ID:** (no explicit ID in docs; used via `/translate` endpoint)  
**Capability:** High-quality translation between 11 languages with context preservation  
**Key Features:**
- Multiple translation styles: formal, modern-colloquial, classic-colloquial, code-mixed
- Script control: Roman, native, and spoken forms
- Automatic language detection (set `source_language_code="auto"`)
- Numeral format control
- Code-mixed content support
- Bidirectional translation

**Languages:** Hindi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Marathi, Punjabi, Odia, English

**Corpus BLEU Scores (10–37.57; higher is better)**

**When to Use:** Content localization, educational platforms, code-switched text handling  
**Reference:** [Mayura](https://docs.sarvam.ai/api-reference-docs/getting-started/models/mayura)

---

### **Translation: Sarvam Translate v1**
**Model ID:** `sarvam-translate:v1`  
**Capability:** Extended translation support for all 23 languages (22 Indian + English)  
**Key Features:**
- Formal style translation (default) for professional communication
- Bidirectional translation for all languages
- Numeral format control (international vs. native)
- High quality across all 22 scheduled Indian languages per Constitution of India
- **Limitation:** `output_script` parameter not supported (use Mayura for script control)

**Languages:** All 22 scheduled Indian languages + English (complete coverage vs. Mayura's 11)

**Corpus BLEU Scores (3.56–40.65; Telugu highest at 40.65)**

**When to Use:** Enterprise translation, official government/bureaucratic content, long-form documents, comprehensive Indic language support  
**Reference:** [Sarvam Translate v1](https://docs.sarvam.ai/api-reference-docs/getting-started/models/sarvam-translate)

---

### **Chat Completion: Sarvam-30B**
**Model ID:** `sarvam-30b`  
**Capability:** 30B parameter Mixture-of-Experts reasoning model (2.4B active per token)  
**Key Features:**
- Strong Indian language support: 10 most-spoken Indian languages
- Wins 89% of pairwise comparisons on Indian language benchmarks; 87% on STEM/math/coding
- Efficient MoE architecture: 128 sparse experts, GQA (Grouped Query Attention)
- Reasoning & coding: Math500: 97.0, HumanEval: 92.1, MBPP: 92.7, AIME 25: 88.3 (96.7 with tools)
- Native tool calling for agentic workflows (BrowseComp: 35.5, Tau2: 45.7)
- OpenAI-compatible API; supports streaming
- Temperature: 0–2; Top-p: 0–1
- Pre-trained on 16T tokens

**When to Use:** Real-time deployment, conversational AI, cost-balanced production workloads, local inference (Apple Silicon via MXFP4)  
**Reference:** [Sarvam-30B](https://docs.sarvam.ai/api-reference-docs/getting-started/models/sarvam-30b)

---

### **Chat Completion: Sarvam-105B (Flagship)**
**Model ID:** `sarvam-105b`  
**Capability:** 105B+ parameter Mixture-of-Experts flagship model with Multi-head Latent Attention (MLA)  
**Key Features:**
- Wins 90% of pairwise comparisons on Indian language benchmarks; 84% on STEM/math/coding
- Advanced reasoning: Math500: 98.6, AIME 25: 88.3 (96.7 with tools), HMMT: 85.8, Beyond AIME: 69.1
- Highest agentic performance: BrowseComp: 49.5, Tau2: 68.3 (avg.)
- MoE with 128 sparse experts + Multi-head Latent Attention (reduced memory for long-context)
- Pre-trained on 12T tokens
- Optimized for tool use, long-horizon reasoning, environment interaction

**When to Use:** Maximum quality outputs, complex reasoning, agentic workflows, enterprise AI assistants  
**Reference:** [Sarvam-105B](https://docs.sarvam.ai/api-reference-docs/getting-started/models/sarvam-105b)

---

### **Model Comparison Matrix**
| Aspect | Sarvam-30B | Sarvam-105B |
|--------|-----------|-----------|
| **Total Parameters** | 30B (2.4B active) | 105B+ |
| **Architecture** | MoE + GQA | MoE + MLA |
| **Pre-training Data** | 16T tokens | 12T tokens |
| **Best For** | Real-time, conversational | Maximum quality, reasoning, agentic |
| **Math500** | 97.0 | 98.6 |
| **AIME 25** | 88.3 | 88.3 (96.7 w/ tools) |
| **BrowseComp** | 35.5 | 49.5 |
| **Indian Language Win Rate** | 89% avg | 90% avg |
| **Inference** | H100, L40S, Apple Silicon | Server-centric (H100) |

**Reference:** [Sarvam-105B](https://docs.sarvam.ai/api-reference-docs/getting-started/models/sarvam-105b)

---

## 5) Caveats, Limits & Explicit Constraints

### **Audio Constraints**
- **STT Max Duration:** 30 seconds per request (reduced from 8 minutes in Feb 2025)
- **STT Sample Rate:** 16 kHz standard; 8 kHz for telephony
- **PCM Audio Formats:** Require explicit `input_audio_codec` parameter; only support 16 kHz
- **Batch STT:** Up to 20 files per job; max 60 minutes per file

**Reference:** [Changelog – Feb 2025](https://docs.sarvam.ai/api-reference-docs/changelog)

### **Character & Token Limits**
- **TTS Max:** 2,500 characters per request (Bulbul v3)
- **Chat Completion:** Temperature 0–2; Top-p 0–1

### **Translation Constraints**
- **Mayura:** Only 11 languages (10 Indian + English); no script control parameter
- **Sarvam Translate:** No `output_script` parameter (use Mayura for script options)

**Reference:** [Sarvam Translate v1](https://docs.sarvam.ai/api-reference-docs/getting-started/models/sarvam-translate)

### **Document Processing**
- **Document Intelligence API:** Max 10 pages per job

### **Rate Limit Polling**
- **Batch Endpoints:** Implement minimum 5 ms delay between consecutive status polling requests to avoid unnecessary throttling

**Reference:** [Credits & Rate Limits](https://docs.sarvam.ai/api-reference-docs/ratelimits)

### **API Key Management**
- **Organization Keys:** Not currently supported; coming soon
- **Key Usage Tracking:** Available on dashboard (Oct 2025 feature)

### **WebSocket & Real-time**
- **STT WebSocket:** Supports flush signal (Sept 2025)
- **TTS WebSocket:** Supports end signal for smoother stream control (Sept 2025)
- **Sample Rate Support:** 8 kHz added for telephony (Sept 2025)

**Reference:** [Changelog](https://docs.sarvam.ai/api-reference-docs/changelog)

### **Deprecations & Migrations**
- **Bulbul v1:** Deprecated April 30, 2025 → migrate to **bulbul:v2** or **bulbul:v3**
- **Saaras v2.5:** Legacy model (v3 recommended)
- **Analytics & Parse APIs:** Removed from SDK for maintainability (April 2025)

---

## Summary Quick Reference

**Authentication:** `api-subscription-key` header  
**Free Credits:** ₹1,000 per user signup  
**Base Rate Limits:** Starter 60 req/min → Business 1,000 req/min  
**Pricing:** ₹0/token (Sarvam-M) to ₹45/hour (STT+Diarization)  
**Model Recommendation:** Sarvam-30B (production + reasoning) or Sarvam-105B (maximum quality)  
**Key Constraint:** 30-second STT limit; TTS 2,500 character limit; min 5 ms batch polling delay  

**Main Dashboard:** [dashboard.sarvam.ai](https://dashboard.sarvam.ai)  
**API Reference Home:** [docs.sarvam.ai/api-reference-docs/introduction](https://docs.sarvam.ai/api-reference-docs/introduction)