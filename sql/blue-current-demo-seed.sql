BEGIN;

-- Blue Current constants (locked)
-- operator_id  = 143
-- itinerary_id = 9
-- vessels: Dolphin (vessel_id=3), Dolphin Plus (vessel_id=4)

WITH
boat_team AS (
  INSERT INTO aquorix.dive_teams (itinerary_id, team_name, description, boat_name)
  VALUES (
    9,
    'DEMO: Blue Current Boat Ops',
    'Demo boat team for scheduler endpoints',
    'Dolphin / Dolphin Plus'
  )
  RETURNING team_id
),
shore_team AS (
  INSERT INTO aquorix.dive_teams (itinerary_id, team_name, description, boat_name)
  VALUES (
    9,
    'DEMO: Blue Current Shore Ops',
    'Demo shore team for scheduler endpoints',
    'Shore'
  )
  RETURNING team_id
),

-- 1) BOAT — Power Station (288) on Dolphin (3)
s_boat_am AS (
  INSERT INTO aquorix.dive_sessions (
    itinerary_id, team_id, dive_site_id, dive_datetime, meet_time,
    session_type, vessel_id, operator_id, notes
  )
  SELECT
    9,
    (SELECT team_id FROM boat_team),
    288,
    (CURRENT_DATE + 1)::timestamptz + TIME '09:00',
    (CURRENT_DATE + 1)::timestamptz + TIME '08:30',
    'boat',
    3,
    143,
    'DEMO: Blue Current BOAT AM — Power Station (Dolphin)'
  RETURNING session_id
),

-- 2) BOAT — Tristar (301) on Dolphin Plus (4)
s_boat_mid AS (
  INSERT INTO aquorix.dive_sessions (
    itinerary_id, team_id, dive_site_id, dive_datetime, meet_time,
    session_type, vessel_id, operator_id, notes
  )
  SELECT
    9,
    (SELECT team_id FROM boat_team),
    301,
    (CURRENT_DATE + 1)::timestamptz + TIME '11:30',
    (CURRENT_DATE + 1)::timestamptz + TIME '11:00',
    'boat',
    4,
    143,
    'DEMO: Blue Current BOAT MID — Tristar (Dolphin Plus)'
  RETURNING session_id
),

-- 3) SHORE — Cedar Pride (67)
s_shore_pm AS (
  INSERT INTO aquorix.dive_sessions (
    itinerary_id, team_id, dive_site_id, dive_datetime, meet_time,
    session_type, vessel_id, operator_id, notes
  )
  SELECT
    9,
    (SELECT team_id FROM shore_team),
    67,
    (CURRENT_DATE + 1)::timestamptz + TIME '15:00',
    (CURRENT_DATE + 1)::timestamptz + TIME '14:30',
    'shore',
    NULL,
    143,
    'DEMO: Blue Current SHORE PM — Cedar Pride'
  RETURNING session_id
),

-- 4) SHORE — Japanese Gardens (306)
s_shore_eve AS (
  INSERT INTO aquorix.dive_sessions (
    itinerary_id, team_id, dive_site_id, dive_datetime, meet_time,
    session_type, vessel_id, operator_id, notes
  )
  SELECT
    9,
    (SELECT team_id FROM shore_team),
    306,
    (CURRENT_DATE + 1)::timestamptz + TIME '17:00',
    (CURRENT_DATE + 1)::timestamptz + TIME '16:30',
    'shore',
    NULL,
    143,
    'DEMO: Blue Current SHORE EVE — Japanese Gardens'
  RETURNING session_id
)

SELECT
  (SELECT team_id FROM boat_team)  AS demo_boat_team_id,
  (SELECT team_id FROM shore_team) AS demo_shore_team_id,
  (SELECT session_id FROM s_boat_am)   AS session_boat_am,
  (SELECT session_id FROM s_boat_mid)  AS session_boat_mid,
  (SELECT session_id FROM s_shore_pm)  AS session_shore_pm,
  (SELECT session_id FROM s_shore_eve) AS session_shore_eve;

COMMIT;