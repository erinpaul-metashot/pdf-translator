import { NextRequest } from 'next/server';

const DEFAULT_SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const SARVAM_BASE = process.env.SARVAM_API_BASE_URL || 'https://api.sarvam.ai';

export const dynamic = 'force-dynamic';

/**
 * GET /api/translate/status?jobId=xxx
 * Polls Sarvam job status and returns progress metrics.
 */
export async function GET(request: NextRequest) {
  try {
    const requestApiKey = request.headers.get('x-sarvam-api-key')?.trim();
    const resolvedApiKey = requestApiKey || DEFAULT_SARVAM_API_KEY;

    if (!resolvedApiKey) {
      return Response.json(
        { error: 'Sarvam API key is missing. Save a key in settings or set SARVAM_API_KEY.' },
        { status: 400 }
      );
    }

    const jobId = request.nextUrl.searchParams.get('jobId');

    if (!jobId) {
      return Response.json({ error: 'Missing jobId parameter' }, { status: 400 });
    }

    const res = await fetch(`${SARVAM_BASE}/doc-digitization/job/v1/${jobId}/status`, {
      method: 'GET',
      headers: {
        'api-subscription-key': resolvedApiKey,
      },
    });

    if (!res.ok) {
      return Response.json(
        { error: `Status check failed: ${res.status}` },
        { status: 500 }
      );
    }

    const data = await res.json();
    const detail = data.job_details?.[0];

    return Response.json({
      jobId: data.job_id,
      state: data.job_state,
      totalPages: detail?.total_pages ?? 0,
      pagesProcessed: detail?.pages_processed ?? 0,
      pagesSucceeded: detail?.pages_succeeded ?? 0,
      pagesFailed: detail?.pages_failed ?? 0,
      errorMessage: data.error_message || detail?.error_message || '',
    });
  } catch (err) {
    console.error('Status polling error:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
