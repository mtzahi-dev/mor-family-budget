import { getStore } from '@netlify/blobs';
import { createApi } from '../../lib/api.mjs';
import { blobsKV } from '../../lib/kv.mjs';
import { webPush } from '../../lib/push.mjs';

let api;
export default (req, context) => {
  if (!api) {
    const site = (context && context.site && context.site.url) || process.env.URL;
    api = createApi({
      kv: blobsKV(getStore({ name: 'budget', consistency: 'strong' })),
      push: webPush(site || 'https://mor-family-budget.netlify.app'),
      origin: site   // passkeys belong to the site's address; other hosts (old draft deploys) get 404
    });
  }
  return api.handle(req);
};

export const config = { path: '/api/*' };
