-- =====================================================================
-- One-time cluster bootstrap: roles, database, extensions.
--
-- Run as a superuser BEFORE the first migration:
--   psql -h localhost -U postgres -f libs/api/database/bootstrap.sql
--
-- Override the dev passwords for any non-local environment:
--   psql -h <host> -U postgres -f bootstrap.sql \
--     -v api_password='...' -v user_password='...'
--
-- Deliberately NOT a migration. CREATE ROLE is a cluster-level object shared by every
-- database on the instance, it needs CREATEROLE (which the migration role should not have),
-- the passwords must not live in version control, and managed Postgres offerings often
-- restrict role creation entirely. A down-migration dropping a role could also break a
-- different database sharing the same cluster. GRANTs and RLS policies, by contrast, are
-- schema-level and DO belong in migrations — see 20260726120000-enable-rls.ts.
-- =====================================================================

\if :{?api_password}
\else
\set api_password 'ft_api_dev'
\endif

\if :{?user_password}
\else
\set user_password 'ft_user_dev'
\endif

-- \gexec rather than a DO block: psql does not interpolate :variables inside dollar-quoted
-- strings, so the passwords would arrive at the server literally as ":'api_password'".
-- Building the statement in a SELECT keeps interpolation working, and the WHERE NOT EXISTS
-- makes it idempotent by yielding zero rows (nothing to execute) when the role already exists.

-- ft_api — owns the schema and runs migrations. As the table owner it bypasses RLS, which
-- is required: seeding reference data and backfilling columns must not be filtered by
-- policies meant for end users.
SELECT format('CREATE ROLE ft_api WITH LOGIN PASSWORD %L', :'api_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ft_api')
\gexec

-- ft_user — the role the API connects as at runtime. Owns nothing on purpose: a table's
-- owner silently bypasses that table's RLS policies, so running the app as ft_api would
-- disable every policy. Its privileges come from the RLS migration's GRANTs.
SELECT format('CREATE ROLE ft_user WITH LOGIN PASSWORD %L', :'user_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ft_user')
\gexec

SELECT 'CREATE DATABASE finance_tracker OWNER ft_api'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'finance_tracker')
\gexec

\connect finance_tracker

-- Needed by users.email (citext). Installed here rather than left to the migration because
-- extension creation can require privileges the migration role lacks on managed Postgres;
-- the auth migration also declares it IF NOT EXISTS so a self-hosted setup works either way.
CREATE EXTENSION IF NOT EXISTS citext;

SELECT rolname AS role_created FROM pg_roles WHERE rolname IN ('ft_api', 'ft_user') ORDER BY rolname;
