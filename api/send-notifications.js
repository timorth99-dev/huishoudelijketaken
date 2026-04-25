const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

// --- Config ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

webpush.setVapidDetails(
    'mailto:huishoudelijketaken@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

// --- Date Helpers (same logic as frontend) ---
function todayDate() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function calcNextDue(lastDone, interval, unit) {
    const d = new Date(lastDone);
    switch (unit) {
        case 'days': d.setDate(d.getDate() + interval); break;
        case 'weeks': d.setDate(d.getDate() + interval * 7); break;
        case 'months': d.setMonth(d.getMonth() + interval); break;
    }
    return d;
}

function daysUntil(date) {
    const now = todayDate();
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(date) {
    return new Date(date).toLocaleDateString('nl-NL', {
        day: 'numeric', month: 'long', year: 'numeric'
    });
}

module.exports = async function handler(req, res) {
    // Verify cron secret to prevent unauthorized calls
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Load all tasks
        const { data: tasks, error: tasksError } = await supabase
            .from('tasks')
            .select('*');

        if (tasksError) {
            return res.status(500).json({ error: 'Failed to load tasks', details: tasksError });
        }

        // Find tasks due within 2 days
        const dueSoon = (tasks || []).filter(task => {
            const nextDue = calcNextDue(task.last_done, task.interval, task.unit);
            const days = daysUntil(nextDue);
            return days >= 0 && days <= 2;
        });

        if (dueSoon.length === 0) {
            return res.json({ message: 'Geen taken binnenkort', tasksChecked: tasks?.length || 0 });
        }

        // Check which notifications have already been sent today
        const todayStr = todayDate().toISOString().split('T')[0];
        const taskIds = dueSoon.map(t => t.id);

        const { data: alreadySent } = await supabase
            .from('notifications_sent')
            .select('task_id')
            .in('task_id', taskIds)
            .eq('sent_date', todayStr);

        const sentTaskIds = new Set((alreadySent || []).map(n => n.task_id));
        const toNotify = dueSoon.filter(t => !sentTaskIds.has(t.id));

        if (toNotify.length === 0) {
            return res.json({ message: 'Alle meldingen al verstuurd vandaag', tasks: dueSoon.length });
        }

        // Load all push subscriptions
        const { data: subscriptions, error: subsError } = await supabase
            .from('push_subscriptions')
            .select('*');

        if (subsError || !subscriptions?.length) {
            return res.json({ message: 'Geen push subscriptions gevonden' });
        }

        // Send notifications
        const results = [];
        for (const task of toNotify) {
            const nextDue = calcNextDue(task.last_done, task.interval, task.unit);
            const days = daysUntil(nextDue);
            let body;
            if (days === 0) {
                body = `"${task.name}" moet vandaag worden uitgevoerd!`;
            } else if (days === 1) {
                body = `"${task.name}" moet morgen worden uitgevoerd!`;
            } else {
                body = `"${task.name}" moet over ${days} dagen worden uitgevoerd (${formatDate(nextDue)}).`;
            }

            const payload = JSON.stringify({
                title: '🏠 Taak binnenkort!',
                body,
                url: '/'
            });

            let sentToAny = false;
            for (const sub of subscriptions) {
                try {
                    await webpush.sendNotification({
                        endpoint: sub.endpoint,
                        keys: { p256dh: sub.p256dh, auth: sub.auth }
                    }, payload);
                    results.push({ task: task.name, endpoint: sub.endpoint.slice(-20), status: 'sent' });
                    sentToAny = true;
                } catch (err) {
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        // Subscription expired, remove it
                        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
                        results.push({ task: task.name, status: 'subscription removed (expired)' });
                    } else {
                        results.push({ task: task.name, status: 'error', error: err.message });
                    }
                }
            }

            // Record that we sent notification for this task today
            if (sentToAny) {
                await supabase.from('notifications_sent').insert({
                    task_id: task.id,
                    sent_date: todayStr
                });
            }
        }

        // Clean up old notification records (older than 7 days)
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        await supabase
            .from('notifications_sent')
            .delete()
            .lt('sent_date', weekAgo.toISOString().split('T')[0]);

        return res.json({
            message: `${toNotify.length} meldingen verstuurd naar ${subscriptions.length} apparaten`,
            results
        });
    } catch (err) {
        console.error('Send notifications error:', err);
        return res.status(500).json({ error: err.message });
    }
};
