-- ============================================================================
-- STREMIO WATCHLIST (GOOD QUALITY TRACKER) — INITIAL SCHEMA
-- Matches production database schema (Postgres 17)
-- ============================================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS public.watchlist_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  stremio_auth_key TEXT,
  min_quality TEXT DEFAULT '1080p',
  auto_sync_watched BOOLEAN DEFAULT FALSE,
  track_watchlist_watched BOOLEAN DEFAULT TRUE,
  sync_previously_watched BOOLEAN DEFAULT FALSE,
  is_admin BOOLEAN DEFAULT FALSE,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. WATCHLIST ITEMS TABLE
CREATE TABLE IF NOT EXISTS public.watchlist_items (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  user_id UUID NOT NULL REFERENCES public.watchlist_users(id) ON DELETE CASCADE,
  imdb_id TEXT,
  type TEXT DEFAULT 'movie',
  name TEXT NOT NULL,
  year TEXT DEFAULT '',
  poster TEXT DEFAULT '',
  min_quality TEXT,
  has_1080p_plus BOOLEAN DEFAULT FALSE,
  best_quality TEXT DEFAULT 'Pending',
  stream_count INTEGER DEFAULT 0,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  last_checked TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  is_watched BOOLEAN DEFAULT FALSE,
  watched_at TIMESTAMPTZ,
  custom_lists TEXT[] NOT NULL DEFAULT '{}'::text[],
  CONSTRAINT uq_watchlist_items_user_imdb UNIQUE (user_id, imdb_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_user_uuid
  ON public.watchlist_items (user_id, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_watchlist_items_added_at
  ON public.watchlist_items (added_at DESC);
CREATE INDEX IF NOT EXISTS idx_watchlist_items_ready
  ON public.watchlist_items (has_1080p_plus);
CREATE INDEX IF NOT EXISTS idx_watchlist_items_watched
  ON public.watchlist_items (user_id, is_watched);
CREATE INDEX IF NOT EXISTS idx_watchlist_items_custom_lists
  ON public.watchlist_items USING GIN (custom_lists);

-- 3. CUSTOM LISTS TABLE
CREATE TABLE IF NOT EXISTS public.watchlist_custom_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.watchlist_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🎬',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_watchlist_custom_lists_user_id
  ON public.watchlist_custom_lists (user_id);

-- 4. FIRST-PARTY ANALYTICS EVENTS TABLE
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.watchlist_users(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created
  ON public.analytics_events (event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id
  ON public.analytics_events (user_id);

-- 5. FEATURE ROADMAP POLL VOTES TABLE
CREATE TABLE IF NOT EXISTS public.poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.watchlist_users(id) ON DELETE CASCADE,
  selected_option TEXT NOT NULL,
  custom_text TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_poll_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_poll_votes_option
  ON public.poll_votes (selected_option);
CREATE INDEX IF NOT EXISTS idx_poll_votes_user
  ON public.poll_votes (user_id);

-- 6. GRANTS & ROW LEVEL SECURITY (RLS)
GRANT ALL ON TABLE public.watchlist_users TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.watchlist_items TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.watchlist_custom_lists TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.analytics_events TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.poll_votes TO anon, authenticated, service_role;

ALTER TABLE public.watchlist_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist_custom_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "watchlist_users_all" ON public.watchlist_users;
CREATE POLICY "watchlist_users_all"
  ON public.watchlist_users
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "watchlist_items_all" ON public.watchlist_items;
CREATE POLICY "watchlist_items_all"
  ON public.watchlist_items
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "watchlist_custom_lists_all" ON public.watchlist_custom_lists;
CREATE POLICY "watchlist_custom_lists_all"
  ON public.watchlist_custom_lists
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "analytics_events_all" ON public.analytics_events;
CREATE POLICY "analytics_events_all"
  ON public.analytics_events
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "poll_votes_all" ON public.poll_votes;
CREATE POLICY "poll_votes_all"
  ON public.poll_votes
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
