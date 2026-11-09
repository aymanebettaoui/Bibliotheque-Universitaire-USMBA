-- Read-only preflight for the custom invariants in the initial migration.
WITH checks AS (
  SELECT 'duplicate_active_reservations' AS check_name, count(*)::bigint AS violations
  FROM (SELECT "copyId" FROM "Reservation" WHERE status = 'ACTIVE' GROUP BY "copyId" HAVING count(*) > 1) q
  UNION ALL
  SELECT 'duplicate_active_loans', count(*)::bigint
  FROM (SELECT "copyId" FROM "Loan" WHERE status IN ('ACTIVE', 'OVERDUE') GROUP BY "copyId" HAVING count(*) > 1) q
  UNION ALL
  SELECT 'negative_book_price', count(*)::bigint FROM "Book" WHERE "priceDh" < 0
  UNION ALL
  SELECT 'negative_student_counters', count(*)::bigint FROM "Student" WHERE "lateCycle" < 0 OR suspensions < 0
  UNION ALL
  SELECT 'invalid_library_settings', count(*)::bigint FROM "LibrarySettings"
    WHERE "maxLoans" NOT BETWEEN 1 AND 20 OR "loanDays" NOT BETWEEN 1 AND 365
       OR "pickupHours" NOT BETWEEN 1 AND 720 OR "lateSuspensionDays" NOT BETWEEN 1 AND 365
       OR "minorDamageDays" NOT BETWEEN 1 AND 365
  UNION ALL
  SELECT 'negative_sanction_amount', count(*)::bigint FROM "Sanction" WHERE "amountDh" < 0
  UNION ALL
  SELECT 'invalid_loan_dates', count(*)::bigint FROM "Loan"
    WHERE "dueAt" <= "handedAt" OR ("returnedAt" IS NOT NULL AND "returnedAt" < "handedAt")
  UNION ALL
  SELECT 'closed_loan_return_mismatch', count(*)::bigint FROM "Loan"
    WHERE (status = 'CLOSED') <> ("returnedAt" IS NOT NULL)
  UNION ALL
  SELECT 'invalid_active_reservation_link', count(*)::bigint
  FROM "Reservation" reservation
  WHERE reservation.status = 'ACTIVE' AND NOT EXISTS (
    SELECT 1 FROM "BorrowRequest" request
    JOIN "Copy" copy ON copy."bookId" = request."bookId"
    WHERE request.id = reservation."requestId" AND copy.id = reservation."copyId"
      AND request."studentId" = reservation."studentId" AND request.status = 'ACCEPTED'
  )
  UNION ALL
  SELECT 'invalid_active_loan_reservation_link', count(*)::bigint
  FROM "Loan" loan
  WHERE loan.status IN ('ACTIVE', 'OVERDUE') AND loan."reservationId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Reservation" reservation
    WHERE reservation.id = loan."reservationId" AND reservation."copyId" = loan."copyId"
      AND reservation."studentId" = loan."studentId" AND reservation.status = 'COLLECTED'
  )
  UNION ALL
  SELECT 'inconsistent_copy_circulation', count(*)::bigint
  FROM (
    SELECT copy.id, copy.status, copy.condition,
      count(DISTINCT reservation.id) FILTER (WHERE reservation.status = 'ACTIVE') AS reservations,
      count(DISTINCT loan.id) FILTER (WHERE loan.status IN ('ACTIVE', 'OVERDUE')) AS loans
    FROM "Copy" copy
    LEFT JOIN "Reservation" reservation ON reservation."copyId" = copy.id
    LEFT JOIN "Loan" loan ON loan."copyId" = copy.id
    GROUP BY copy.id
  ) state
  WHERE reservations + loans > 1
     OR (status = 'AVAILABLE' AND (reservations <> 0 OR loans <> 0 OR condition <> 'GOOD'))
     OR (status = 'RESERVED' AND (reservations <> 1 OR loans <> 0 OR condition <> 'GOOD'))
     OR (status = 'LOANED' AND (reservations <> 0 OR loans <> 1 OR condition <> 'GOOD'))
     OR (status = 'WITHDRAWN' AND (reservations <> 0 OR loans <> 0))
)
SELECT check_name, violations FROM checks ORDER BY check_name;
