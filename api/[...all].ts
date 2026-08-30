import handler from '../apps/controller/src/index.js';

export default async function (req: any, res: any) {
  if (req.url && !req.url.startsWith('/api') && !req.url.startsWith('/install')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return handler(req, res);
}
