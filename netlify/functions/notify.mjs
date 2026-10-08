// Runs every hour; at 19:00 Israel time it sends the status notification if three days have passed since the last one.
import { getStore } from '@netlify/blobs';
import { createApi } from '../../lib/api.mjs';
import { blobsKV } from '../../lib/kv.mjs';
import { webPush } from '../../lib/push.mjs';

export default async () => {
  const api = createApi({
    kv: blobsKV(getStore({ name: 'budget', consistency: 'strong' })),
    push: webPush(process.env.URL || 'https://mor-family-budget.netlify.app')
  });
  const r = await api.notify();
  console.log('notify', JSON.stringify({ sent: r.sent, removed: r.removed, reason: r.reason }));
};

// Hourly, because 19:00 in Israel moves between 16:00 and 17:00 UTC with daylight saving time.
export const config = { schedule: '0 * * * *' };
