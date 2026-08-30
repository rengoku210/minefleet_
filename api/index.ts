import handler from '../apps/controller/src/index.js';

export default async function (req: any, res: any) {
  // Restore original URL from Vercel matched path headers if rewritten to /api/index
  const matchedPath = req.headers['x-matched-path'] || req.headers['x-vercel-matched-path'];
  if (matchedPath && typeof matchedPath === 'string' && matchedPath !== '/api/index') {
    const queryIdx = req.url ? req.url.indexOf('?') : -1;
    const query = queryIdx !== -1 ? req.url.substring(queryIdx) : '';
    req.url = matchedPath + query;
  }
  return handler(req, res);
}
