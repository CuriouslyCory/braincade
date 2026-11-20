import { handleHandwritingRequest } from '../server/handwriting.js';

// Vercel Function for `/api/handwriting`: reads handwriting with an open model on the
// function's CPU (no API key, no per-photo cost). It stays off until BRAINCADE_ACCESS_CODE
// is set in the project's environment variables, so strangers who find the URL can't use
// up the deployment's compute; each device enters the code once.
const options = () => ({
  accessCode: process.env.BRAINCADE_ACCESS_CODE,
  requireAccessCode: true,
});

export function GET(request: Request): Promise<Response> {
  return handleHandwritingRequest(request, options());
}

export function POST(request: Request): Promise<Response> {
  return handleHandwritingRequest(request, options());
}
