import { NextRequest } from 'next/server';
import { SUPPORTED_LANGUAGES } from '../../lib/constants';
import { validatePdfFile } from '../../lib/validators';

const DEFAULT_SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const SARVAM_BASE = process.env.SARVAM_API_BASE_URL || 'https://api.sarvam.ai';
const SUPPORTED_LANGUAGE_CODES = new Set(SUPPORTED_LANGUAGES.map((lang) => lang.code));

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/translate
 * Receives PDF file + targetLang + scope.
 * Orchestrates: create job → get upload URL → upload PDF → start job.
 * Returns { jobId }.
 */
export async function POST(request: NextRequest) {
  try {
    const requestApiKey = request.headers.get('x-sarvam-api-key')?.trim();
    const resolvedApiKey = requestApiKey || DEFAULT_SARVAM_API_KEY;

    if (!resolvedApiKey) {
      return Response.json(
        { error: 'Sarvam API key is missing. Save a key in settings or set SARVAM_API_KEY.' },
        { status: 400 }
      );
    }

    const fetchOrThrow = async (url: string, init: RequestInit, step: string): Promise<Response> => {
      try {
        return await fetch(url, init);
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new Error(`${step} request failed: ${cause}`);
      }
    };

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const targetLang = (formData.get('targetLang') as string) || 'hi-IN';
    const sourceLang = (formData.get('sourceLang') as string) || 'en-IN';

    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    const fileError = validatePdfFile(file);
    if (fileError) {
      return Response.json({ error: fileError.message }, { status: 400 });
    }

    if (!SUPPORTED_LANGUAGE_CODES.has(targetLang)) {
      return Response.json({ error: `Unsupported targetLang: ${targetLang}` }, { status: 400 });
    }

    if (!SUPPORTED_LANGUAGE_CODES.has(sourceLang)) {
      return Response.json({ error: `Unsupported sourceLang: ${sourceLang}` }, { status: 400 });
    }

    const headers = {
      'api-subscription-key': resolvedApiKey,
      'Content-Type': 'application/json',
    };

    // Step 1: Create digitization job
    const createRes = await fetchOrThrow(`${SARVAM_BASE}/doc-digitization/job/v1`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        job_parameters: {
          // Sarvam doc-digitization does not accept "auto" for language.
          language: sourceLang,
          output_format: 'html',
        },
      }),
    }, 'Create job');

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error('Create job failed:', errText);
      return Response.json(
        { error: `Failed to create translation job: ${createRes.status}` },
        { status: 500 }
      );
    }

    const createData = await createRes.json();
    const jobId = createData.job_id as string | undefined;

    if (!jobId) {
      console.error('Create job response missing job_id:', createData);
      return Response.json(
        { error: 'Failed to create translation job: missing job ID' },
        { status: 502 }
      );
    }

    // Step 2: Get presigned upload URL
    const uploadUrlRes = await fetchOrThrow(`${SARVAM_BASE}/doc-digitization/job/v1/upload-files`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        job_id: jobId,
        files: [file.name],
      }),
    }, 'Get upload URL');

    if (!uploadUrlRes.ok) {
      const errText = await uploadUrlRes.text();
      console.error('Get upload URL failed:', errText);
      return Response.json(
        { error: `Failed to get upload URL: ${uploadUrlRes.status}` },
        { status: 500 }
      );
    }

    const uploadUrlData = await uploadUrlRes.json();
    const uploadInfo = uploadUrlData.upload_urls?.[file.name] as
      | {
          url?: string;
          file_url?: string;
          method?: string;
          headers?: Record<string, string>;
        }
      | undefined;

    const uploadUrl = uploadInfo?.url || uploadInfo?.file_url;

    if (!uploadUrl) {
      console.error('Upload URL response missing URL:', uploadUrlData);
      return Response.json({ error: 'No upload URL received' }, { status: 502 });
    }

    // Step 3: Upload file to presigned URL
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const uploadHeaders: Record<string, string> = uploadInfo?.headers
      ? { ...uploadInfo.headers }
      : { 'Content-Type': file.type || 'application/pdf' };

    // Azure Blob pre-signed URLs require blob type when caller-provided headers are absent.
    if (!uploadInfo?.headers && uploadUrl.includes('.blob.core.windows.net')) {
      uploadHeaders['x-ms-blob-type'] = 'BlockBlob';
    }

    const uploadRes = await fetchOrThrow(uploadUrl, {
      method: uploadInfo?.method || 'PUT',
      body: fileBuffer,
      headers: uploadHeaders,
    }, 'Upload PDF');

    if (!uploadRes.ok) {
      console.error('File upload failed:', uploadRes.status);
      return Response.json(
        { error: `File upload failed: ${uploadRes.status}` },
        { status: 500 }
      );
    }

    // Step 4: Start processing
    const startRes = await fetchOrThrow(`${SARVAM_BASE}/doc-digitization/job/v1/${jobId}/start`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    }, 'Start job');

    if (!startRes.ok) {
      const startErrText = await startRes.text();
      console.error('Start job failed:', startErrText);
      return Response.json(
        { error: `Failed to start processing: ${startRes.status}` },
        { status: 500 }
      );
    }

    return Response.json({ jobId, state: 'Pending' });
  } catch (err) {
    console.error('Translation pipeline error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
