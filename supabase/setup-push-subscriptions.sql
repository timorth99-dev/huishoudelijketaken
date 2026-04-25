-- Push Subscriptions tabel aanmaken
-- Voer dit uit in Supabase Dashboard > SQL Editor

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    endpoint text UNIQUE NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- RLS (Row Level Security) inschakelen
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Policy: iedereen mag lezen en schrijven (geen auth in deze app)
CREATE POLICY "Allow all operations on push_subscriptions"
    ON push_subscriptions
    FOR ALL
    USING (true)
    WITH CHECK (true);
