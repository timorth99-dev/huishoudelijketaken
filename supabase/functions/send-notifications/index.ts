import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Web Push imports for Deno
import { encode as base64Encode } from 'https://deno.land/std@0.177.0/encoding/base64url.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = 'mailto:huishoudelijketaken@example.com';

// --- Date Helpers (same logic as frontend) ---
function todayDate(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function calcNextDue(lastDone: string, interval: number, unit: string): Date {
    const d = new Date(lastDone);
    switch (unit) {
        case 'days': d.setDate(d.getDate() + interval); break;
        case 'weeks': d.setDate(d.getDate() + interval * 7); break;
        case 'months': d.setMonth(d.getMonth() + interval); break;
    }
    return d;
}

function daysUntil(date: Date): number {
    const now = todayDate();
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// --- Web Push Crypto Helpers ---
async function importVapidKeys() {
    // Decode the base64url-encoded private key
    const padding = '='.repeat((4 - VAPID_PRIVATE_KEY.length % 4) % 4);
    const base64 = (VAPID_PRIVATE_KEY + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawKey = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

    const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        await createPkcs8FromRaw(rawKey),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
    );
    return privateKey;
}

async function createPkcs8FromRaw(rawKey: Uint8Array): Promise<ArrayBuffer> {
    // PKCS8 wrapper for EC P-256 private key
    const pkcs8Header = new Uint8Array([
        0x30, 0x81, 0x87, 0x02, 0x01, 0x00, 0x30, 0x13,
        0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
        0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
        0x03, 0x01, 0x07, 0x04, 0x6d, 0x30, 0x6b, 0x02,
        0x01, 0x01, 0x04, 0x20
    ]);
    const pkcs8Footer = new Uint8Array([
        0xa1, 0x44, 0x03, 0x42, 0x00
    ]);

    // We need the public key for the footer, but for signing JWT we only need the private part.
    // Use a simpler JWK-based import instead.
    return new Uint8Array([...pkcs8Header, ...rawKey]).buffer;
}

async function createJwt(audience: string): Promise<string> {
    // Decode the raw private key
    const padding = '='.repeat((4 - VAPID_PRIVATE_KEY.length % 4) % 4);
    const base64 = (VAPID_PRIVATE_KEY + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawKeyBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

    // Import as JWK (raw 32-byte scalar -> JWK d parameter)
    const d = base64Encode(rawKeyBytes);

    // Decode public key to get x, y coordinates
    const pubPadding = '='.repeat((4 - VAPID_PUBLIC_KEY.length % 4) % 4);
    const pubBase64 = (VAPID_PUBLIC_KEY + pubPadding).replace(/-/g, '+').replace(/_/g, '/');
    const pubBytes = Uint8Array.from(atob(pubBase64), c => c.charCodeAt(0));
    // Uncompressed public key: 0x04 || x (32 bytes) || y (32 bytes)
    const x = base64Encode(pubBytes.slice(1, 33));
    const y = base64Encode(pubBytes.slice(33, 65));

    const jwk = { kty: 'EC', crv: 'P-256', d, x, y };

    const key = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
    );

    const header = { typ: 'JWT', alg: 'ES256' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        aud: audience,
        exp: now + 12 * 60 * 60,
        sub: VAPID_SUBJECT
    };

    const encoder = new TextEncoder();
    const headerB64 = base64Encode(encoder.encode(JSON.stringify(header)));
    const payloadB64 = base64Encode(encoder.encode(JSON.stringify(payload)));
    const unsignedToken = `${headerB64}.${payloadB64}`;

    const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        encoder.encode(unsignedToken)
    );

    // Convert DER signature to raw r||s format  
    const sigBytes = new Uint8Array(signature);
    const sigB64 = base64Encode(sigBytes);

    return `${unsignedToken}.${sigB64}`;
}

async function sendWebPush(subscription: { endpoint: string; p256dh: string; auth: string }, payload: string) {
    const url = new URL(subscription.endpoint);
    const audience = `${url.protocol}//${url.host}`;

    const jwt = await createJwt(audience);
    const vapidHeader = `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`;

    const response = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
            'Authorization': vapidHeader,
            'Content-Type': 'application/json',
            'Content-Encoding': 'aes128gcm',
            'TTL': '86400'
        },
        body: payload
    });

    return response;
}

serve(async (req: Request) => {
    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Load all tasks
        const { data: tasks, error: tasksError } = await supabase
            .from('tasks')
            .select('*');

        if (tasksError) {
            return new Response(JSON.stringify({ error: 'Failed to load tasks', details: tasksError }), { status: 500 });
        }

        // Find tasks due within 2 days
        const dueSoon = (tasks || []).filter((task: any) => {
            const nextDue = calcNextDue(task.last_done, task.interval, task.unit);
            const days = daysUntil(nextDue);
            return days >= 0 && days <= 2;
        });

        if (dueSoon.length === 0) {
            return new Response(JSON.stringify({ message: 'Geen taken binnenkort', tasksChecked: tasks?.length || 0 }));
        }

        // Load all push subscriptions
        const { data: subscriptions, error: subsError } = await supabase
            .from('push_subscriptions')
            .select('*');

        if (subsError || !subscriptions?.length) {
            return new Response(JSON.stringify({ error: 'No subscriptions found', details: subsError }), { status: 200 });
        }

        // Send notifications
        const results: any[] = [];
        for (const task of dueSoon) {
            const nextDue = calcNextDue(task.last_done, task.interval, task.unit);
            const days = daysUntil(nextDue);
            let body: string;
            if (days === 0) {
                body = `"${task.name}" moet vandaag worden uitgevoerd!`;
            } else if (days === 1) {
                body = `"${task.name}" moet morgen worden uitgevoerd!`;
            } else {
                body = `"${task.name}" moet over ${days} dagen worden uitgevoerd.`;
            }

            const payload = JSON.stringify({
                title: '🏠 Taak binnenkort!',
                body,
                url: '/'
            });

            for (const sub of subscriptions) {
                try {
                    const response = await sendWebPush(sub, payload);
                    if (response.status === 410 || response.status === 404) {
                        // Subscription expired, remove it
                        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
                        results.push({ task: task.name, endpoint: sub.endpoint, status: 'removed (expired)' });
                    } else {
                        results.push({ task: task.name, endpoint: sub.endpoint, status: response.status });
                    }
                } catch (err: any) {
                    results.push({ task: task.name, endpoint: sub.endpoint, status: 'error', error: err.message });
                }
            }
        }

        return new Response(JSON.stringify({
            message: `${dueSoon.length} taken binnenkort, ${subscriptions.length} subscriptions`,
            results
        }));
    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
});
