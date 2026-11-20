import { handleHandwritingRequest } from '../server/handwriting.js';

// Vercel Function for `/api/handwriting`: reads handwriting with an open model on the
// function's CPU (no API key, no per-photo cost). Optionally set BRAINCADE_ACCESS_CODE in
// the project's environment variables so only devices that know it can use the reader.
const options = () => ({ accessCode: process.env.BRAINCADE_ACCESS_CODE });

export function GET(request: Request): Promise<Response> {
  return handleHandwritingRequest(request, options());
}

export function POST(request: Request): Promise<Response> {
  return handleHandwritingRequest(request, options());
}
