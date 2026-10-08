// Web Push through the web-push package. The VAPID keys live in kv (see api.mjs).
import webpush from 'web-push';

export function webPush(subject) {
  return {
    generateKeys: () => webpush.generateVAPIDKeys(),
    send: (sub, payload, keys) => webpush.sendNotification(sub, payload, {
      TTL: 24 * 3600,
      timeout: 10000,
      urgency: 'normal',
      vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey }
    })
  };
}
