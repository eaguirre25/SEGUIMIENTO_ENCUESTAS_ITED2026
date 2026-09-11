-- LimeSurvey is the source of truth for response totals.
-- Historical test responses remain in LimeSurvey, so the dashboard must count them too
-- if its total is expected to match LimeSurvey exactly.
DELETE FROM dashboard_excluded_responses;
