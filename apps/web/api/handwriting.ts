import { handleHandwritingRequest } from '../server/handwriting.js';

// Vercel Function for `/api/handwriting`. Set ANTHROPIC_API_KEY and
// BRAINCADE_ACCESS_CODE in the Vercel project's environment variables to turn the
// handwriting reader on: a deployment never spends the key for callers without the code.
const options = () => ({
  apiKey: process.env.ANTHROPIC_API_KEY,
  accessCode: process.env.BRAINCADE_ACCESS_CODE,
  requireAccessCode: true,
});

export function GET(request: Request): Promise<Response> {
  return handleHandwritingRequest(request, options());
}

export function POST(request: Request): Promise<Response> {
  return handleHandwritingRequest(request, options());
}
