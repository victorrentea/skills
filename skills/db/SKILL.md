---
name: db
description: "Before recommending or making any database change (index, column, constraint, migration, query rewrite). Triggers: indexing advice, schema changes, \"add an index\", \"optimize this query\"."
---

# DB

**Never suggest a database change without first looking at the actual schema.**

Before recommending ANY index, column, constraint, migration, or query rewrite:
inspect the real schema first — query `pg_indexes` / `information_schema`, or read the migration files (`db/migration/V*.sql`). Recommend only after you've verified the current state. No suggestions from memory or from inferring schema out of an EXPLAIN plan.
