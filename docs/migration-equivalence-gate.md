# Read-only migration equivalence gate

Compare ordered SQL statements, not whole-file hashes versus joined ledger entries.
Only external semicolon delimiters and outer statement whitespace are removed.
Comments, internal whitespace/line endings, strings, identifiers and dollar-quoted
function bodies are preserved. Nested block comments and PostgreSQL E strings
are recognized. Standard strings assume standard_conforming_strings=on;
SQL-standard BEGIN ATOMIC bodies are not supported by this lexical-only gate.

ALREADY_EQUIVALENT means the complete ordered statement sequence is equal.
PENDING means absent by identity and equivalent SQL. Same version/name with
different available SQL is MATERIAL_MISMATCH. Empty, missing, incomplete or
invalid input is UNKNOWN; fail closed. No semantic normalization or DB mutation.

The actual WACRM ledger contains 42 historical migrations with 733 statements;
their statement arrays match local files exactly. Six later migrations have
equivalent SQL under different remote timestamps. Never repair/reapply these.
Only 20260918161120 was absent during the read-only diagnosis on 2026-09-18.

Test: node --test deploy/migration-equivalence.test.mjs. Reconcile a fresh
read-only ledger against all local files before every targeted application.
This operational gate commit does not require rebuilding app image 07258bd.
