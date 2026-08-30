import handler from '../apps/controller/src/index.js';

export default async function (req: any, res: any) {
  req.url = '/install.sh' + (req.url?.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
  return handler(req, res);
}
