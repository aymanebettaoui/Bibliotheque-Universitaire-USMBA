-- Reconcile databases created without the custom SQL tail of the initial migration.
-- Statements are idempotent so databases migrated from scratch keep the same guards.

CREATE UNIQUE INDEX IF NOT EXISTS "Reservation_one_active_per_copy"
  ON "Reservation" ("copyId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS "Loan_one_active_per_copy"
  ON "Loan" ("copyId") WHERE "status" IN ('ACTIVE', 'OVERDUE');

DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Book_nonnegative_price' AND conrelid = '"Book"'::regclass) THEN
    ALTER TABLE "Book" ADD CONSTRAINT "Book_nonnegative_price" CHECK ("priceDh" >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Student_nonnegative_counters' AND conrelid = '"Student"'::regclass) THEN
    ALTER TABLE "Student" ADD CONSTRAINT "Student_nonnegative_counters" CHECK ("lateCycle" >= 0 AND "suspensions" >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LibrarySettings_positive_limits' AND conrelid = '"LibrarySettings"'::regclass) THEN
    ALTER TABLE "LibrarySettings" ADD CONSTRAINT "LibrarySettings_positive_limits" CHECK ("maxLoans" BETWEEN 1 AND 20 AND "loanDays" BETWEEN 1 AND 365 AND "pickupHours" BETWEEN 1 AND 720 AND "lateSuspensionDays" BETWEEN 1 AND 365 AND "minorDamageDays" BETWEEN 1 AND 365) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Sanction_nonnegative_amount' AND conrelid = '"Sanction"'::regclass) THEN
    ALTER TABLE "Sanction" ADD CONSTRAINT "Sanction_nonnegative_amount" CHECK ("amountDh" IS NULL OR "amountDh" >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Loan_valid_dates' AND conrelid = '"Loan"'::regclass) THEN
    ALTER TABLE "Loan" ADD CONSTRAINT "Loan_valid_dates" CHECK ("dueAt" > "handedAt" AND ("returnedAt" IS NULL OR "returnedAt" >= "handedAt")) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Loan_closed_has_return' AND conrelid = '"Loan"'::regclass) THEN
    ALTER TABLE "Loan" ADD CONSTRAINT "Loan_closed_has_return" CHECK (("status" = 'CLOSED') = ("returnedAt" IS NOT NULL)) NOT VALID;
  END IF;
END $reconcile$;

ALTER TABLE "Book" VALIDATE CONSTRAINT "Book_nonnegative_price";
ALTER TABLE "Student" VALIDATE CONSTRAINT "Student_nonnegative_counters";
ALTER TABLE "LibrarySettings" VALIDATE CONSTRAINT "LibrarySettings_positive_limits";
ALTER TABLE "Sanction" VALIDATE CONSTRAINT "Sanction_nonnegative_amount";
ALTER TABLE "Loan" VALIDATE CONSTRAINT "Loan_valid_dates";
ALTER TABLE "Loan" VALIDATE CONSTRAINT "Loan_closed_has_return";

CREATE OR REPLACE FUNCTION guard_copy_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'Reservation' AND NEW."status"::text <> 'ACTIVE' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'Loan' AND NEW."status"::text NOT IN ('ACTIVE', 'OVERDUE') THEN RETURN NEW; END IF;
  PERFORM 1 FROM "Copy" WHERE "id" = NEW."copyId" FOR UPDATE;
  IF TG_TABLE_NAME = 'Reservation' THEN
    IF EXISTS (SELECT 1 FROM "Loan" WHERE "copyId" = NEW."copyId" AND "status" IN ('ACTIVE','OVERDUE')) THEN
      RAISE EXCEPTION 'Copy already has an active loan' USING ERRCODE = '23505';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "BorrowRequest" r JOIN "Copy" c ON c."bookId" = r."bookId" WHERE r.id=NEW."requestId" AND c.id=NEW."copyId" AND r."studentId"=NEW."studentId" AND r.status='ACCEPTED') THEN
      RAISE EXCEPTION 'Reservation does not match accepted request' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM "Reservation" WHERE "copyId" = NEW."copyId" AND "status" = 'ACTIVE') THEN
      RAISE EXCEPTION 'Copy already has an active reservation' USING ERRCODE = '23505';
    END IF;
    IF NEW."reservationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Reservation" WHERE id=NEW."reservationId" AND "copyId"=NEW."copyId" AND "studentId"=NEW."studentId" AND status='COLLECTED') THEN
      RAISE EXCEPTION 'Loan does not match collected reservation' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION assert_copy_circulation(copy_uuid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c "Copy"%ROWTYPE; reservations integer; loans integer;
BEGIN
  SELECT * INTO c FROM "Copy" WHERE id=copy_uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*) INTO reservations FROM "Reservation" WHERE "copyId"=copy_uuid AND status='ACTIVE';
  SELECT count(*) INTO loans FROM "Loan" WHERE "copyId"=copy_uuid AND status IN ('ACTIVE','OVERDUE');
  IF reservations + loans > 1 OR
     (c.status='AVAILABLE' AND (reservations<>0 OR loans<>0 OR c.condition<>'GOOD')) OR
     (c.status='RESERVED' AND (reservations<>1 OR loans<>0 OR c.condition<>'GOOD')) OR
     (c.status='LOANED' AND (reservations<>0 OR loans<>1 OR c.condition<>'GOOD')) OR
     (c.status='WITHDRAWN' AND (reservations<>0 OR loans<>0)) THEN
    RAISE EXCEPTION 'Inconsistent physical copy circulation' USING ERRCODE = '23514';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION check_copy_circulation_deferred() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='Copy' THEN
    IF TG_OP <> 'DELETE' THEN PERFORM assert_copy_circulation(NEW.id); END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN PERFORM assert_copy_circulation(OLD."copyId"); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM assert_copy_circulation(NEW."copyId"); END IF;
  END IF;
  RETURN NULL;
END $$;

DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'Reservation_guard_assignment' AND tgrelid = '"Reservation"'::regclass AND NOT tgisinternal) THEN
    EXECUTE 'CREATE TRIGGER "Reservation_guard_assignment" BEFORE INSERT OR UPDATE ON "Reservation" FOR EACH ROW EXECUTE FUNCTION guard_copy_assignment()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'Loan_guard_assignment' AND tgrelid = '"Loan"'::regclass AND NOT tgisinternal) THEN
    EXECUTE 'CREATE TRIGGER "Loan_guard_assignment" BEFORE INSERT OR UPDATE ON "Loan" FOR EACH ROW EXECUTE FUNCTION guard_copy_assignment()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'Copy_circulation_consistency' AND tgrelid = '"Copy"'::regclass AND NOT tgisinternal) THEN
    EXECUTE 'CREATE CONSTRAINT TRIGGER "Copy_circulation_consistency" AFTER INSERT OR UPDATE ON "Copy" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_copy_circulation_deferred()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'Reservation_circulation_consistency' AND tgrelid = '"Reservation"'::regclass AND NOT tgisinternal) THEN
    EXECUTE 'CREATE CONSTRAINT TRIGGER "Reservation_circulation_consistency" AFTER INSERT OR UPDATE OR DELETE ON "Reservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_copy_circulation_deferred()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'Loan_circulation_consistency' AND tgrelid = '"Loan"'::regclass AND NOT tgisinternal) THEN
    EXECUTE 'CREATE CONSTRAINT TRIGGER "Loan_circulation_consistency" AFTER INSERT OR UPDATE OR DELETE ON "Loan" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_copy_circulation_deferred()';
  END IF;
END $reconcile$;
