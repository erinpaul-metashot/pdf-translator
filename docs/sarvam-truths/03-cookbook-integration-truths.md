# Sarvam AI Production Integration Patterns

Extracted from official documentation: cookbook guides and integration examples. Production-ready patterns for robust voice AI implementations.

---

## 1. Pipeline Architecture Pattern

### Best Practice: Linear Data Flow Architecture
```
Input → STT → Context Aggregator → LLM → TTS → Output
         ↓                                    ↓
    (User Add)                         (Assistant Save)
```

**Key Points:**
- **Decoupling**: Each processor handles one responsibility
- **Context Preservation**: LLMContext maintains conversation history across turns
- **Bidirectional Context**: User messages and assistant responses saved to context

**Citation:** [Build Your First Voice Agent using Pipecat](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-pipecat) | [Build Your First Voice Agent using LiveKit](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-live-kit)

**Implementation Example (Pipecat):**
```python
pipeline = Pipeline([
    transport.input(),
    stt,
    context_aggregator.user(),      # Add user message to context
    llm,
    tts,
    transport.output(),
    context_aggregator.assistant()  # Save assistant response
])
```

---

## 2. Language Handling Patterns

### Pattern 2a: Auto-Detection (Default for Multilingual)
- **Use `language="unknown"` for automatic detection**
- Handles code-mixing naturally (Hinglish, Tanglish, etc.)
- Best for diverse customer bases

**Citation:** [Loan Advisory Agent](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/loan-advisory-agent) | [Tutor Agent](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/tutor-agent)

```python
stt = SarvamSTTService(
    language="unknown",  # Auto-detects language
    model="saaras:v3",
    mode="transcribe"
)
```

### Pattern 2b: Speech-to-English Translation
- **Use `mode="translate"` when users speak Indian languages but LLM needs English input**
- Saaras v3 automatically detects source language and translates to English
- Useful for English-only LLMs (e.g., gpt-4o)

**Citation:** [Loan Advisory Agent - Example 4](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/loan-advisory-agent#example-4-speech-to-english-advisor-saaras) | [LiveKit Integration - Example 4](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-live-kit#example-4-speech-to-english-agent-saaras)

```python
stt = SarvamSTTService(
    model="saaras:v3",
    mode="translate"  # Hindi/Tamil/etc → English text
)
```

### Pattern 2c: Language-Specific Agents
- Deploy region-specific agents for production accuracy
- Supported: en-IN, hi-IN, bn-IN, ta-IN, te-IN, gu-IN, kn-IN, ml-IN, mr-IN, pa-IN, od-IN

**Citation:** [Government Scheme Agent - Regional Variants](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/government-scheme-agent)

### Anti-Pattern: Language Mismatch
❌ **Don't** use English LLM with Hindi STT output without translation
- Causes accuracy degradation
- Creates context confusion

---

## 3. Streaming & Real-Time Processing

### Best Practice: Flush Signal Configuration (LiveKit)
**Required for proper turn-taking and response timing**

**Citation:** [LiveKit Best Practices](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-live-kit#best-practices)

```python
stt = sarvam.STT(
    language="unknown",
    model="saaras:v3",
    mode="transcribe",
    flush_signal=True  # ✅ Enables speech start/end events
)
```

**Why:** Enables the plugin to emit start-of-speech and end-of-speech events for natural turn-taking.

### Best Practice: Turn Detection Configuration
```python
session = AgentSession(
    turn_detection="stt",           # STT handles turn detection
    min_endpointing_delay=0.07      # 70ms Sarvam STT latency
)
```

**Citation:** [LiveKit Best Practices - Turn Detection](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-live-kit#best-practices)

**Why:** Sarvam STT has ~70ms processing latency. Setting min_endpointing_delay to 0.07s ensures smooth transition to LLM without race conditions.

### Anti-Pattern: Incorrect VAD Configuration
❌ **Don't** pass VAD to AgentSession when using Sarvam STT
```python
# ❌ WRONG
session = AgentSession(vad=silero.VAD.load())

# ✅ CORRECT
session = AgentSession()
```

**Citation:** [LiveKit Best Practices - VAD](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-live-kit#best-practices)

---

## 4. Batch Processing & Retries

### Pattern: Batch Job Lifecycle Management
**For large-scale audio processing (call analytics, transcription)**

**Citation:** [Call Analytics Pipeline](https://docs.sarvam.ai/api-reference-docs/cookbook/guides/call-analytics-pipeline)

```python
# 1. Create job
job = client.speech_to_text_translate_job.create_job(
    model="saaras:v3",
    mode="translate",
    with_diarization=True
)

# 2. Upload files (with extended timeout for large files)
job.upload_files(file_paths=audio_paths, timeout=300)

# 3. Start processing
job.start()

# 4. Wait with polling
job.wait_until_complete()

# 5. Check status before download
if job.is_failed():
    print("Transcription failed!")
    return {}

# 6. Download outputs
output_dir = Path(f"outputs/transcriptions_{job.job_id}")
job.download_outputs(output_dir=str(output_dir))
```

### Best Practice: Timeout Configuration
- **Set `timeout=300` for files >1 hour** in batch upload
- Prevents connection timeouts on slow networks

**Citation:** [Call Analytics Pipeline - Upload Note](https://docs.sarvam.ai/api-reference-docs/cookbook/guides/call-analytics-pipeline#process_audio_files)

### Best Practice: Audio Chunking
- **Split audio >1 hour into 1-hour chunks** before batch processing
- Batch API has 1-hour file limit per job

**Citation:** [Call Analytics Pipeline - split_audio](https://docs.sarvam.ai/api-reference-docs/cookbook/guides/call-analytics-pipeline#split_audio)

```python
def split_audio(audio_path: str, chunk_duration_ms: int = 60 * 60 * 1000):
    audio = AudioSegment.from_file(audio_path)
    chunks = [audio[i:i + chunk_duration_ms] 
              for i in range(0, len(audio), chunk_duration_ms)]
    return chunks if len(audio) > chunk_duration_ms else [audio]
```

### Anti-Pattern: No Job Status Checking
❌ **Don't** assume batch jobs succeed without checking status
```python
# ❌ WRONG - Can fail silently
job.wait_until_complete()
job.download_outputs(output_dir)  # May crash if job failed

# ✅ CORRECT
if job.is_failed():
    logger.error(f"Job {job.job_id} failed")
    return {}
```

---

## 5. Error Handling & Resilience

### Pattern: Multi-Layer Error Handling
**Citation:** [Call Analytics Pipeline - Error Handling](https://docs.sarvam.ai/api-reference-docs/cookbook/guides/call-analytics-pipeline)

```python
def process_audio_files(self, audio_paths: List[str]) -> Dict[str, str]:
    # Layer 1: Input validation
    if not audio_paths:
        print("No audio files provided")
        return {}
    
    try:
        # Layer 2: API call with try-catch
        job = client.speech_to_text_translate_job.create_job(...)
        job.wait_until_complete()
        
        # Layer 3: Status check
        if job.is_failed():
            print("Transcription failed!")
            return {}
        
        # Layer 4: File validation
        json_files = list(output_dir.glob("*.json"))
        if not json_files:
            raise FileNotFoundError(f"No .json files in {output_dir}")
            
        return transcriptions
        
    except Exception as e:
        # Layer 5: Exception logging
        print(f"Error processing audio files: {e}")
        return {}
```

### Best Practice: Structured Logging
```python
logger = logging.getLogger("voice-agent")
logger.setLevel(logging.INFO)

# Log lifecycle events
logger.info(f"User connected to room: {ctx.room.name}")
logger.info("Customer connected")
logger.info("Customer disconnected")
```

**Citation:** [Collection Agent](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/collection-agent) | [Government Scheme Agent](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/government-scheme-agent)

### Anti-Pattern: Silent Failures
❌ **Don't** swallow exceptions without logging
```python
# ❌ WRONG
try:
    analysis = self.client.chat.completions(messages=messages)
except:
    pass  # Silent failure!

# ✅ CORRECT
except Exception as e:
    error_msg = f"Error analyzing transcription: {str(e)}"
    logger.error(error_msg)
    return {"file_name": file_name, "error": error_msg, "timestamp": datetime.now().isoformat()}
```

---

## 6. Configuration Management & Secrets

### Best Practice: Environment-Based Configuration
**Citation:** [All integration guides](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-live-kit)

```python
from dotenv import load_dotenv
import os

load_dotenv(override=True)

stt = SarvamSTTService(
    api_key=os.getenv("SARVAM_API_KEY")
)
llm = OpenAILLMService(
    api_key=os.getenv("OPENAI_API_KEY")
)
```

### `.env` Template
```bash
SARVAM_API_KEY=sk_xxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxx
LIVEKIT_URL=wss://your-project-xxxxx.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Anti-Pattern: Hardcoded Secrets
❌ **Never** commit API keys
```python
# ❌ WRONG
api_key = "sk_xxxxxxxxxxxxxxx"  # In source code!

# ✅ CORRECT
api_key = os.getenv("SARVAM_API_KEY")
```

---

## 7. Speaker & Voice Customization

### Pattern: Context-Aware Voice Selection

| Use Case | Voice Profile | Pace | Citation |
|----------|--------------|------|----------|
| Financial Advisory | Professional male (aditya, anand) | 1.0 | [Loan Advisory](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/loan-advisory-agent) |
| Education/Tutoring | Clear female (ishita) | 0.9 (slower) | [Tutor Agent](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/tutor-agent) |
| Citizen Services | Warm female (simran) | 1.0 | [Government Scheme Agent](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/government-scheme-agent) |
| Collections | Professional male (aditya, anand) | 1.0 | [Collection Agent](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/collection-agent) |

```python
tts = SarvamTTSService(
    api_key=os.getenv("SARVAM_API_KEY"),
    target_language_code="en-IN",
    model="bulbul:v3",
    speaker="aditya",       # Context-specific
    pace=1.0,               # 0.5-2.0 range
    speech_sample_rate=24000  # 8000/16000/22050/24000/32000/44100/48000
)
```

**Citation:** [Loan Advisory TTS Options](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/loan-advisory-agent#tts-additional-parameters)

### Available Voices
- **Male (23):** Shubh, Aditya, Rahul, Rohan, Amit, Dev, Ratan, Varun, Manan, Sumit, Kabir, Aayan, Ashutosh, Advait, Anand, Tarun, Sunny, Mani, Gokul, Vijay, Mohit, Rehan, Soham
- **Female (16):** Ritu, Priya, Neha, Pooja, Simran, Kavya, Ishita, Shreya, Roopa, Amelia, Sophia, Tanya, Shruti, Suhani, Kavitha, Rupali

### Anti-Pattern: Generic Voice Configuration
❌ **Don't** use random voices for all contexts
- Customer trust correlation exists (professional voices for finance)
- Reduces cognitive load (slower pace for education)

---

## 8. Diarization & Speaker Tracking

### Pattern: Speaker-Wise Conversation Parsing
**For call center analytics and compliance**

**Citation:** [Call Analytics Pipeline](https://docs.sarvam.ai/api-reference-docs/cookbook/guides/call-analytics-pipeline#why-diarization-and-speaker-wise-parsing)

```python
# Enable diarization in batch job
job = client.speech_to_text_translate_job.create_job(
    model="saaras:v3",
    mode="translate",
    with_diarization=True  # ✅ Essential for multi-speaker
)

# Parse speaker-wise output
diarized = data.get("diarized_transcript", {}).get("entries")
for entry in diarized:
    speaker = entry["speaker_id"]        # SPEAKER_00, SPEAKER_01, etc.
    text = entry["transcript"]
    start_time = entry.get("start_time_seconds")
    end_time = entry.get("end_time_seconds")
    duration = end_time - start_time
    
    speaker_times[speaker] = speaker_times.get(speaker, 0.0) + duration
```

### Outputs Generated:
1. **Conversation transcript** (`_conversation.txt`) - Speaker-labeled dialogue
2. **Speaker timing** (`_timing.json`) - Talk-time analytics per speaker
3. **Analysis output** (`_analysis.txt`) - LLM-driven insights

**Use Case Benefits:**
- Agent talk-time vs. listening-time monitoring
- Customer sentiment attribution
- Compliance recording validation

---

## 9. Dependency Injection & Service Architecture

### Pattern: Service Layer Abstraction
**Citation:** [LiveKit Agent Pattern](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-live-kit)

```python
class VoiceAgent(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions="...",
            stt=sarvam.STT(...),    # Dependency: STT service
            llm=openai.LLM(...),    # Dependency: LLM service
            tts=sarvam.TTS(...)     # Dependency: TTS service
        )
```

**Benefits:**
- Easy to mock for testing
- Support multiple backends (e.g., swap OpenAI for Gemini)
- Clear separation of concerns

---

## 10. Event-Driven Lifecycle Management

### Pattern: Connection Lifecycle Hooks
**Citation:** [Pipecat Integration - Event Handlers](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-pipecat)

```python
task = PipelineTask(pipeline)

@transport.event_handler("on_client_connected")
async def on_client_connected(transport, client):
    logger.info("Client connected")
    # Initialize context, start greeting, etc.
    messages.append({"role": "system", "content": "Greet the user"})
    await task.queue_frames([LLMRunFrame()])

@transport.event_handler("on_client_disconnected")
async def on_client_disconnected(transport, client):
    logger.info("Client disconnected")
    # Cleanup, save session, etc.
    await task.cancel()
```

### Anti-Pattern: No Cleanup on Disconnect
❌ **Don't** leave resources open after disconnection
- Causes memory leaks in long-running services
- Accumulates database connections

---

## 11. Transport Configuration Patterns

### Pipecat Transport
```python
transport = await create_transport(
    runner_args,
    {
        "daily": lambda: DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True
        ),
        "webrtc": lambda: TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True
        ),
    }
)
```

### LiveKit Transport
```python
session = AgentSession(
    turn_detection="stt",
    min_endpointing_delay=0.07
)
await session.start(
    agent=YourAgent(),
    room=ctx.room
)
```

**Citation:** [Pipecat Integration](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-pipecat) | [LiveKit Integration](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-live-kit)

---

## 12. LLM Context Management

### Pattern: Stateful Conversation Context
**Citation:** [All Pipecat agents](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/loan-advisory-agent)

```python
# Initialize with system prompt
messages = [{
    "role": "system",
    "content": """You are a loan advisor...
    [Full system instructions]
    """
}]

context = LLMContext(messages)
context_aggregator = LLMContextAggregatorPair(context)

# Aggregate user and assistant messages bidirectionally
pipeline = Pipeline([
    transport.input(),
    stt,
    context_aggregator.user(),      # Tracks user message
    llm,
    tts,
    transport.output(),
    context_aggregator.assistant()  # Tracks assistant message
])
```

### Best Practice: System Prompt Strategy
- **Domain-specific instructions** to prevent hallucination
- **Communication guidelines** for tone/compliance
- **Available options/resources** for consistency

**Example:** [Loan Advisory System Prompt](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/loan-advisory-agent#4-write-your-agent)

---

## 13. Compliance & Regulatory Patterns

### Pattern: Compliance-Aware Instructions
**Citation:** [Loan Advisory](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/loan-advisory-agent) | [Collection Agent](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/collection-agent)

```python
instructions = """
[Domain knowledge...]

**Compliance Reminders:**
- Never make false promises about loan approval
- Always mention that loans are subject to eligibility
- Recommend customers compare offers before deciding
- Remind about importance of timely repayments

Communication guidelines:
- Never be aggressive or threatening
- Remain calm if customer is upset
- If customer requests human transfer, acknowledge
- Be transparent about fees and charges
"""
```

**Anti-Pattern: Aggressive Communication**
❌ **Don't** allow threatening or coercive language in collection agents
- Violates regulations (RBI guidelines, TCPA in US)
- Creates legal liability

---

## 14. Call Analytics & Insights

### Pattern: Multi-Stage Analysis Pipeline
**Citation:** [Call Analytics Pipeline](https://docs.sarvam.ai/api-reference-docs/cookbook/guides/call-analytics-pipeline)

```mermaid
Audio Files → Batch Job → Transcription + Diarization
    ↓
Parse Conversation → Speaker-wise Text + Timing
    ↓
LLM Analysis → Structured Insights (sentiment, resolution, upsell)
    ↓
Summarization → Executive Summary
    ↓
Q&A → Custom Question Answering on Conversation
```

### Insights Extracted:
1. Speaker identification (agent vs. customer)
2. Customer type (new/existing)
3. Initial problem statement
4. Services discussed
5. Agent response quality
6. Customer satisfaction level
7. Sentiment tracking
8. Upsell/cross-sell opportunities
9. Resolution quality

**Use Cases:** Quality assurance, training feedback, customer recovery

---

## Summary: Production Checklist

✅ **Architecture**
- [ ] Pipeline with context aggregation ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-pipecat)
- [ ] Event-driven lifecycle management ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-pipecat)
- [ ] Logging at all stages ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/collection-agent)

✅ **Language Handling**
- [ ] Auto-detection with `language="unknown"` ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/loan-advisory-agent#example-3-multilingual-advisor-auto-detect)
- [ ] Speech-to-English for LLM compatibility ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/loan-advisory-agent#example-4-speech-to-english-advisor-saaras)
- [ ] Code-mixing support ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-pipecat#pro-tips)

✅ **Streaming & Real-Time**
- [ ] Flush signal enabled ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-live-kit#2-enable-flush-signal-in-stt)
- [ ] Turn detection = "stt" ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-live-kit#3-set-turn-detection-to-stt)
- [ ] Min endpointing delay = 0.07 ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-live-kit#4-configure-min-endpointing-delay)
- [ ] No VAD to AgentSession ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-live-kit#1-do-not-pass-vad-to-agentsession)

✅ **Batch Processing**
- [ ] Timeout = 300s for large files ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/cookbook/guides/call-analytics-pipeline#process_audio_files)
- [ ] Audio splitting for >1 hour ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/cookbook/guides/call-analytics-pipeline#split_audio)
- [ ] Job status validation before download ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/cookbook/guides/call-analytics-pipeline#process_audio_files)

✅ **Error Handling**
- [ ] Multi-layer try-catch blocks ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/cookbook/guides/call-analytics-pipeline#process_audio_files)
- [ ] Structured error logging ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/cookbook/guides/call-analytics-pipeline#analyze_transcription)
- [ ] Input validation ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/cookbook/guides/call-analytics-pipeline#process_audio_files)

✅ **Configuration**
- [ ] Secrets via environment variables ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-live-kit#3-create-environment-file)
- [ ] No hardcoded API keys ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/integration/build-voice-agent-with-pipecat#3-create-environment-file)

✅ **Compliance**
- [ ] Domain-specific system prompts ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/loan-advisory-agent)
- [ ] Communication guidelines enforced ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/cookbook/example-voice-agents/collection-agent)
- [ ] Diarization for audit trails ✓ [Citation](https://docs.sarvam.ai/api-reference-docs/cookbook/guides/call-analytics-pipeline#why-diarization-and-speaker-wise-parsing)