-- v9.3.0: user-selectable city for the morning briefing (صبح‌نامه).
-- The briefing previously had no way to know where the user lives; weather was
-- permanently pinned to Tehran. These columns cache the geocoded city so the
-- daily cron never re-geocodes and never invents a location.

ALTER TABLE public.saeed_ai_briefing_preferences
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS city_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS city_lon DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS city_label TEXT;

-- Raw input is bounded (2..60 chars) so cron logs and messages stay clean.
ALTER TABLE public.saeed_ai_briefing_preferences
  DROP CONSTRAINT IF EXISTS saeed_ai_briefing_city_len_chk;
ALTER TABLE public.saeed_ai_briefing_preferences
  ADD CONSTRAINT saeed_ai_briefing_city_len_chk
  CHECK (city IS NULL OR char_length(btrim(city)) BETWEEN 2 AND 60);

-- Coordinates must be geographically valid, or absent together.
ALTER TABLE public.saeed_ai_briefing_preferences
  DROP CONSTRAINT IF EXISTS saeed_ai_briefing_city_lat_chk;
ALTER TABLE public.saeed_ai_briefing_preferences
  ADD CONSTRAINT saeed_ai_briefing_city_lat_chk
  CHECK (city_lat IS NULL OR city_lat BETWEEN -90 AND 90);

ALTER TABLE public.saeed_ai_briefing_preferences
  DROP CONSTRAINT IF EXISTS saeed_ai_briefing_city_lon_chk;
ALTER TABLE public.saeed_ai_briefing_preferences
  ADD CONSTRAINT saeed_ai_briefing_city_lon_chk
  CHECK (city_lon IS NULL OR city_lon BETWEEN -180 AND 180);

ALTER TABLE public.saeed_ai_briefing_preferences
  DROP CONSTRAINT IF EXISTS saeed_ai_briefing_city_pair_chk;
ALTER TABLE public.saeed_ai_briefing_preferences
  ADD CONSTRAINT saeed_ai_briefing_city_pair_chk
  CHECK ((city_lat IS NULL) = (city_lon IS NULL));
