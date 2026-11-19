import { handleHandwritingRequest } from '../server/handwriting.js';

// Vercel Function for `/api/handwriting`. Set ANTHROPIC_API_KEY in the Vercel
// project's environment variables to turn the handwriting reader on.
const options = () => ({ apiKey: process.env.ANTHROPIC_API_KEY });

export function GET(request: Request): Promise<Response> {
  return handleHandwritingRequest(request, options());
}

export function POST(request: Request): Promise<Response> {
  return handleHandwritingRequest(request, options());
}
