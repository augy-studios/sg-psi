-- 001_sgpsi_schema
--
-- Hourly air quality and wind history for SG PSI (sgpsi.uwuapps.org).
--
-- The cron function main-site/api/cron/collect.js writes every row, every five
-- minutes, from data.gov.sg's real-time API. main-site/api/history.js reads
-- them back for the Trends and Wind charts, and main-site/api/now.js falls back
-- to the newest row when data.gov.sg is not answering.
--
-- Only the serverless functions touch these tables, with the service role key.
-- Nothing in the browser talks to Supabase.
--
-- Safe to run more than once.

-- ---------- PSI and PM2.5, one row per NEA reading hour ----------

create table if not exists public.sgpsi_readings (
  reading_at      timestamptz primary key,
  psi             jsonb,
  psi_updated_at  timestamptz,
  pm25            jsonb,
  pm25_updated_at timestamptz,
  collected_at    timestamptz not null default now(),
  constraint sgpsi_readings_has_a_reading check (psi is not null or pm25 is not null)
);

comment on table public.sgpsi_readings is
  'One row per NEA reading hour. The PSI and PM2.5 feeds publish on their own schedules, so each half is written separately and either can be null for a while.';

comment on column public.sgpsi_readings.reading_at is
  'The hour the reading is for: data.gov.sg''s item timestamp, in SGT, e.g. 2026-10-05T23:00:00+08:00.';

comment on column public.sgpsi_readings.psi is
  'data.gov.sg /psi item readings as published: every sub-index and concentration, each keyed by region (north, south, east, west, central).';

comment on column public.sgpsi_readings.pm25 is
  'data.gov.sg /pm25 pm25_one_hourly, keyed by region. Micrograms per cubic metre.';

comment on column public.sgpsi_readings.psi_updated_at is
  'data.gov.sg''s updatedTimestamp for the PSI half. A revised reading overwrites the row.';

comment on column public.sgpsi_readings.pm25_updated_at is
  'data.gov.sg''s updatedTimestamp for the PM2.5 half.';

-- ---------- wind, one snapshot per hour ----------

create table if not exists public.sgpsi_wind (
  observed_at  timestamptz primary key,
  reading_at   timestamptz not null,
  speed        jsonb       not null,
  direction    jsonb       not null,
  collected_at timestamptz not null default now()
);

comment on table public.sgpsi_wind is
  'The first wind reading the cron sees in each hour. data.gov.sg publishes every minute; an hour is plenty for a trend and keeps the table small.';

comment on column public.sgpsi_wind.observed_at is
  'The hour this snapshot stands for, truncated to the hour.';

comment on column public.sgpsi_wind.reading_at is
  'The minute data.gov.sg actually stamped the readings with.';

comment on column public.sgpsi_wind.speed is
  'Wind speed by station id, e.g. {"S108": 1.7}. Knots.';

comment on column public.sgpsi_wind.direction is
  'Wind direction by station id, e.g. {"S108": 127}. Degrees, the direction the wind blows from.';

create table if not exists public.sgpsi_wind_stations (
  id        text             primary key,
  name      text             not null,
  latitude  double precision not null,
  longitude double precision not null,
  seen_at   timestamptz      not null default now()
);

comment on table public.sgpsi_wind_stations is
  'Weather stations reporting wind, refreshed whenever a wind snapshot is written. Lets a stored snapshot be drawn on the map when data.gov.sg is down.';

comment on column public.sgpsi_wind_stations.seen_at is
  'The last time data.gov.sg listed this station.';

-- No extra indexes. Every query is a range scan or a newest-first read on a
-- primary key that is already a timestamp, and the tables grow by about 8,800
-- rows a year each, so nothing needs sweeping either.

-- Row level security on, with no policy, on purpose.
--
-- Only the service role key touches these tables, and that key bypasses RLS
-- entirely. Leaving RLS enabled with no policy means a leaked anon key reaches
-- nothing here.
alter table public.sgpsi_readings      enable row level security;
alter table public.sgpsi_wind          enable row level security;
alter table public.sgpsi_wind_stations enable row level security;
