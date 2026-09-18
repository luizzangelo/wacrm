# Read-only migration equivalence gate

Compare ordered SQL statements, not whole-file hashes versus joined ledger entries.
Only external semicolon delimiters and outer statement whitespace are removed.
Comments, internal whitespace/line endings, strings, identifiers and dollar-quoted
function bodies are preserved. Nested block comments and PostgreSQL E strings
are recognized. Standard strings assume standard_conforming_strings=on;
SQL-standard BEGIN ATOMIC bodies are not supported by this lexical-only gate.

ALREADY_EQUIVALENT means the complete ordered statement sequence is equal.
PENDING means absent by identity and equivalent SQL. Same version/name with
different available SQL is MATERIAL_MISMATCH. Missing, incomplete or invalid
SQL is UNKNOWN; fail closed. No semantic normalization or DB mutation.

Valid isolated comments are preserved as representation entries, including
trailing comments after the last SQL statement. Whitespace/delimiter-only
entries are ignored. A whole migration must contain at least one SQL entry:
otherwise UNKNOWN carries input_kind EMPTY / COMMENTS_ONLY and the distinct
reason EMPTY_MIGRATION / COMMENTS_ONLY_MIGRATION. This is an unsupported
non-executable migration, not a lexical parsing failure; it is never inferred
as applied or pending automatically. Ledger rows use the same whole-row gate,
not an executable-SQL requirement for each comment entry. Changed comments
remain MATERIAL_MISMATCH even when the SQL is unchanged. Internal CRLF is
preserved rather than normalized, protecting strings and function bodies.

The actual WACRM ledger contains 42 historical migrations with 733 statements;
their statement arrays match local files exactly. Six later migrations have
equivalent SQL under different remote timestamps. Never repair/reapply these.
Only 20260918161120 was absent during the read-only diagnosis on 2026-09-18.

Test: node --test deploy/migration-equivalence.test.mjs. Reconcile a fresh
read-only ledger against all local files before every targeted application.
This operational gate commit does not require rebuilding app image 07258bd.
