-- ============================================================================
-- SYNTHETIC & IDEMPOTENT TEST SEED FOR LOCAL DEVELOPMENT ONLY
-- Contains zero production data or real user PII.
-- ============================================================================

-- 1. SYNTHETIC TEST USERS
INSERT INTO public.watchlist_users (
  id,
  email,
  stremio_auth_key,
  min_quality,
  auto_sync_watched,
  track_watchlist_watched,
  sync_previously_watched,
  is_admin,
  onboarding_completed
)
VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    'test-admin@example.com',
    NULL,
    '1080p',
    FALSE,
    TRUE,
    FALSE,
    TRUE,
    TRUE
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'test-4k-user@example.com',
    NULL,
    '4k',
    TRUE,
    TRUE,
    FALSE,
    FALSE,
    TRUE
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'test-new-user@example.com',
    NULL,
    '1080p',
    FALSE,
    TRUE,
    FALSE,
    FALSE,
    FALSE
  )
ON CONFLICT (id) DO NOTHING;

-- 2. SYNTHETIC CUSTOM LISTS
INSERT INTO public.watchlist_custom_lists (id, user_id, name, emoji)
VALUES
  (
    'aaaa1111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    'Sci-Fi Night',
    '🚀'
  ),
  (
    'aaaa2222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
    'Weekend Classics',
    '🍿'
  ),
  (
    'bbbb1111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '4K Showcase',
    '💎'
  )
ON CONFLICT (id) DO NOTHING;

-- 3. SYNTHETIC WATCHLIST ITEMS (COVERING ALL UI STATES)
INSERT INTO public.watchlist_items (
  id,
  user_id,
  imdb_id,
  type,
  name,
  year,
  poster,
  has_1080p_plus,
  best_quality,
  stream_count,
  added_at,
  last_checked,
  ready_at,
  is_watched,
  watched_at,
  custom_lists
)
VALUES
  -- Admin user: Ready 4K UHD
  (
    'seed-admin-tt15239678',
    '11111111-1111-4111-8111-111111111111',
    'tt15239678',
    'movie',
    'Dune: Part Two',
    '2024',
    'https://images.metahub.space/poster/medium/tt15239678/img',
    TRUE,
    '4K UHD',
    18,
    NOW() - INTERVAL '10 days',
    NOW() - INTERVAL '1 hour',
    NOW() - INTERVAL '9 days',
    FALSE,
    NULL,
    ARRAY['aaaa1111-1111-4111-8111-111111111111']::text[]
  ),
  -- Admin user: Ready 1080p FHD (in 2 custom lists)
  (
    'seed-admin-tt0133093',
    '11111111-1111-4111-8111-111111111111',
    'tt0133093',
    'movie',
    'The Matrix',
    '1999',
    'https://images.metahub.space/poster/medium/tt0133093/img',
    TRUE,
    '1080p FHD',
    24,
    NOW() - INTERVAL '8 days',
    NOW() - INTERVAL '1 hour',
    NOW() - INTERVAL '8 days',
    FALSE,
    NULL,
    ARRAY['aaaa1111-1111-4111-8111-111111111111', 'aaaa2222-2222-4222-8222-222222222222']::text[]
  ),
  -- Admin user: Pending (CAM only)
  (
    'seed-admin-tt9000001',
    '11111111-1111-4111-8111-111111111111',
    'tt9000001',
    'movie',
    'Theater Preview Sample',
    '2026',
    '',
    FALSE,
    'CAM',
    3,
    NOW() - INTERVAL '5 days',
    NOW() - INTERVAL '1 hour',
    NULL,
    FALSE,
    NULL,
    '{}'::text[]
  ),
  -- Admin user: Unreleased (0 streams)
  (
    'seed-admin-tt9000002',
    '11111111-1111-4111-8111-111111111111',
    'tt9000002',
    'movie',
    'Upcoming Sci-Fi Sample',
    '2027',
    '',
    FALSE,
    'Unreleased',
    0,
    NOW() - INTERVAL '2 days',
    NOW() - INTERVAL '1 hour',
    NULL,
    FALSE,
    NULL,
    '{}'::text[]
  ),
  -- Admin user: Watched
  (
    'seed-admin-tt1375666',
    '11111111-1111-4111-8111-111111111111',
    'tt1375666',
    'movie',
    'Inception',
    '2010',
    'https://images.metahub.space/poster/medium/tt1375666/img',
    TRUE,
    '4K UHD',
    20,
    NOW() - INTERVAL '14 days',
    NOW() - INTERVAL '3 days',
    NOW() - INTERVAL '14 days',
    TRUE,
    NOW() - INTERVAL '3 days',
    '{}'::text[]
  ),
  -- 4K User: Ready 4K UHD
  (
    'seed-4k-tt15239678',
    '22222222-2222-4222-8222-222222222222',
    'tt15239678',
    'movie',
    'Dune: Part Two',
    '2024',
    'https://images.metahub.space/poster/medium/tt15239678/img',
    TRUE,
    '4K UHD',
    18,
    NOW() - INTERVAL '6 days',
    NOW() - INTERVAL '2 hours',
    NOW() - INTERVAL '6 days',
    FALSE,
    NULL,
    ARRAY['bbbb1111-1111-4111-8111-111111111111']::text[]
  ),
  -- 4K User: 1080p FHD (treated as pending under 4k threshold)
  (
    'seed-4k-tt0133093',
    '22222222-2222-4222-8222-222222222222',
    'tt0133093',
    'movie',
    'The Matrix',
    '1999',
    'https://images.metahub.space/poster/medium/tt0133093/img',
    TRUE,
    '1080p FHD',
    24,
    NOW() - INTERVAL '4 days',
    NOW() - INTERVAL '2 hours',
    NOW() - INTERVAL '4 days',
    FALSE,
    NULL,
    '{}'::text[]
  )
ON CONFLICT (id) DO NOTHING;

-- 4. SYNTHETIC ANALYTICS EVENTS (FOR ADMIN DASHBOARD)
INSERT INTO public.analytics_events (id, user_id, event_name, metadata, created_at)
VALUES
  (
    'eeee1111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    'user_logged_in',
    '{"source":"local_seed"}'::jsonb,
    NOW() - INTERVAL '5 days'
  ),
  (
    'eeee2222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
    'movie_added',
    '{"imdbId":"tt15239678","source":"local_seed"}'::jsonb,
    NOW() - INTERVAL '4 days'
  ),
  (
    'eeee3333-3333-4333-8333-333333333333',
    '22222222-2222-4222-8222-222222222222',
    'addon_installed',
    '{"method":"one_click","source":"local_seed"}'::jsonb,
    NOW() - INTERVAL '2 days'
  ),
  (
    'eeee4444-4444-4444-8444-444444444444',
    '22222222-2222-4222-8222-222222222222',
    'setup_wizard_completed',
    '{"step":"complete","source":"local_seed"}'::jsonb,
    NOW() - INTERVAL '1 day'
  )
ON CONFLICT (id) DO NOTHING;

-- 5. SYNTHETIC POLL VOTES (FOR ROADMAP POLL & ADMIN DASHBOARD)
INSERT INTO public.poll_votes (id, user_id, selected_option, custom_text, created_at)
VALUES
  (
    'ffff1111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    'tv_shows',
    'Would love episode tracking for anime and mini-series.',
    NOW() - INTERVAL '3 days'
  ),
  (
    'ffff2222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222222',
    'notifications',
    'Discord webhook alerts when 4K releases drop.',
    NOW() - INTERVAL '1 day'
  )
ON CONFLICT (user_id) DO NOTHING;
