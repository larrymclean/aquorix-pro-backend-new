# M3 Query Plan Evidence — EXPLAIN (ANALYZE, BUFFERS)

Date: 2026-02-13
Owner: Larry McLean
Prepared By: ChatGPT (Lead) + Larry (Execution)

## Goal
Capture performance evidence for the scheduler “operator + week” query.
Record plan shape, buffers, index usage (if any), and a conclusion.

## Environment
- DB: (Supabase / local / Render — specify)
- Dataset: (operator_id and week range used)
- Notes: (cold cache vs warm cache if known)

## Query Under Test
EXPLAIN (ANALYZE, BUFFERS)
SELECT
  ds.session_id,
  ds.dive_datetime,
  ds.operator_id
FROM aquorix.dive_sessions ds
WHERE ds.operator_id = 146
  AND ds.dive_datetime >= '2026-02-09'::date
  AND ds.dive_datetime <  '2026-02-16'::date
ORDER BY ds.dive_datetime;

## EXPLAIN Output (FORMAT TEXT)
                                                        QUERY PLAN                                                        
--------------------------------------------------------------------------------------------------------------------------
 Sort  (cost=1.06..1.07 rows=1 width=24) (actual time=0.062..0.063 rows=10 loops=1)
   Sort Key: dive_datetime
   Sort Method: quicksort  Memory: 25kB
   Buffers: shared hit=4
   ->  Seq Scan on dive_sessions ds  (cost=0.00..1.05 rows=1 width=24) (actual time=0.020..0.025 rows=10 loops=1)
         Filter: ((dive_datetime >= '2026-02-09'::date) AND (dive_datetime < '2026-02-16'::date) AND (operator_id = 146))
         Rows Removed by Filter: 3
         Buffers: shared hit=1
 Planning:
   Buffers: shared hit=13
 Planning Time: 1.200 ms
 Execution Time: 0.099 ms
(12 rows)


## Observations
- Plan node type(s):
- Index name(s) observed (if any):
- Estimated rows vs actual rows:
- Total execution time:
- Buffers (shared hit/read):

## Conclusion
- Acceptable: YES/NO
- If NO: what index/stat change is required?
