-- Run in Supabase SQL Editor if migrations are not applied via CLI.
CREATE TABLE IF NOT EXISTS user_data (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, key)
);

ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access own data" ON user_data;

CREATE POLICY "Users can only access own data"
ON user_data FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
