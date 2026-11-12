#!/usr/bin/env bash
# Проверка миграций и SQL-тестов на чистой базе Postgres.
# Нужен psql и адрес сервера, где можно создавать базы: TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres
set -euo pipefail
cd "$(dirname "$0")/.."
: "${TEST_DATABASE_URL:?Укажите TEST_DATABASE_URL, например postgres://postgres@localhost:5432/postgres}"
DB="aliia_test_$$"
psql "$TEST_DATABASE_URL" -qc "create database $DB"
trap 'psql "$TEST_DATABASE_URL" -qc "drop database if exists $DB with (force)"' EXIT
TEST_URL="${TEST_DATABASE_URL%/*}/$DB"
for f in supabase/migrations/*.sql; do
  psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
for f in supabase/tests/*.sql; do
  psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f "$f"
done
