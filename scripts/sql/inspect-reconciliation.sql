-- Catalog inspection and active-data check after reconciliation.
SELECT conname AS constraint_name, convalidated AS validated, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname IN (
  'Book_nonnegative_price', 'Student_nonnegative_counters', 'LibrarySettings_positive_limits',
  'Sanction_nonnegative_amount', 'Loan_valid_dates', 'Loan_closed_has_return'
)
ORDER BY conname;

SELECT indexname AS index_name, indexdef AS definition
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('Reservation_one_active_per_copy', 'Loan_one_active_per_copy')
ORDER BY indexname;

SELECT proname AS function_name, pg_get_function_identity_arguments(oid) AS arguments
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('guard_copy_assignment', 'assert_copy_circulation', 'check_copy_circulation_deferred')
ORDER BY proname;

SELECT tgname AS trigger_name, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgname IN (
    'Reservation_guard_assignment', 'Loan_guard_assignment', 'Copy_circulation_consistency',
    'Reservation_circulation_consistency', 'Loan_circulation_consistency'
  )
ORDER BY tgname;

DO $verify$
DECLARE copy_id uuid;
BEGIN
  FOR copy_id IN SELECT id FROM "Copy" LOOP
    PERFORM assert_copy_circulation(copy_id);
  END LOOP;
END $verify$;

SELECT count(*) AS copies_checked FROM "Copy";
