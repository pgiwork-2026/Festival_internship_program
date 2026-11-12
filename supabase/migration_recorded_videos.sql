-- Recorded Videos Catalog (YouTube links published by Admin to Student Portal)
CREATE TABLE IF NOT EXISTS public.recorded_videos (
  id text PRIMARY KEY,
  title text NOT NULL,
  youtube_url text NOT NULL,
  youtube_id text NOT NULL,
  embed_url text NOT NULL,
  thumbnail_url text,
  track text NOT NULL DEFAULT 'all',
  mode text NOT NULL DEFAULT 'all',
  session_number text DEFAULT 'SESSION',
  duration text DEFAULT 'YouTube',
  instructor text DEFAULT 'Plant Green Inertia Mentor',
  summary text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recorded_videos_created ON public.recorded_videos(created_at DESC);
