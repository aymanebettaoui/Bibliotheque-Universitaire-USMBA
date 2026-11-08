-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STUDENT', 'LIBRARIAN', 'ADMIN');

-- CreateEnum
CREATE TYPE "CopyStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'LOANED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PhysicalCondition" AS ENUM ('GOOD', 'DAMAGED', 'LOST');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REFUSED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'COLLECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'OVERDUE', 'CLOSED');

-- CreateEnum
CREATE TYPE "InfractionType" AS ENUM ('LATE', 'LOSS', 'DAMAGE_MINOR', 'DAMAGE_SEVERE');

-- CreateEnum
CREATE TYPE "SanctionType" AS ENUM ('WARNING', 'SUSPENSION', 'BAN', 'FINE');

-- CreateEnum
CREATE TYPE "SanctionStatus" AS ENUM ('ACTIVE', 'PAID', 'REVOKED');

-- CreateEnum
CREATE TYPE "AcquisitionStatus" AS ENUM ('SUBMITTED', 'REVIEW', 'ACCEPTED', 'REFUSED', 'ACQUIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "googleSub" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "studentNumber" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "lateCycle" INTEGER NOT NULL DEFAULT 0,
    "suspensions" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityVerification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "studentNumber" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "nonceHash" TEXT,
    "csrfToken" TEXT NOT NULL,
    "credentialHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Author" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Author_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Book" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "isbn" TEXT,
    "publisher" TEXT,
    "year" INTEGER,
    "description" TEXT NOT NULL DEFAULT '',
    "priceDh" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "coverColor" TEXT NOT NULL DEFAULT '#1e3a5f',
    "coverUrl" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Copy" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "status" "CopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "condition" "PhysicalCondition" NOT NULL DEFAULT 'GOOD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Copy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BorrowRequest" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BorrowRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "copyId" UUID NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "copyId" UUID NOT NULL,
    "reservationId" UUID,
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "handedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "handedById" UUID,
    "returnedById" UUID,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Infraction" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "type" "InfractionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Infraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sanction" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "infractionId" UUID,
    "type" "SanctionType" NOT NULL,
    "status" "SanctionStatus" NOT NULL DEFAULT 'ACTIVE',
    "amountDh" DECIMAL(10,2),
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sanction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Acquisition" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "referenceUrl" TEXT,
    "reason" TEXT,
    "status" "AcquisitionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "comment" TEXT,
    "bookId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Acquisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusHistory" (
    "id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorId" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibrarySettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "maxLoans" INTEGER NOT NULL DEFAULT 3,
    "loanDays" INTEGER NOT NULL DEFAULT 14,
    "pickupHours" INTEGER NOT NULL DEFAULT 48,
    "lateSuspensionDays" INTEGER NOT NULL DEFAULT 7,
    "minorDamageDays" INTEGER NOT NULL DEFAULT 15,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibrarySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AuthorToBook" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_AuthorToBook_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_BookToCategory" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_BookToCategory_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Student_userId_key" ON "Student"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_studentNumber_key" ON "Student"("studentNumber");

-- CreateIndex
CREATE INDEX "IdentityVerification_userId_createdAt_idx" ON "IdentityVerification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthChallenge_tokenHash_key" ON "AuthChallenge"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AuthChallenge_nonceHash_key" ON "AuthChallenge"("nonceHash");

-- CreateIndex
CREATE UNIQUE INDEX "AuthChallenge_credentialHash_key" ON "AuthChallenge"("credentialHash");

-- CreateIndex
CREATE INDEX "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Author_name_key" ON "Author"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Book_isbn_key" ON "Book"("isbn");

-- CreateIndex
CREATE INDEX "Book_title_idx" ON "Book"("title");

-- CreateIndex
CREATE INDEX "Book_archived_createdAt_idx" ON "Book"("archived", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Copy_barcode_key" ON "Copy"("barcode");

-- CreateIndex
CREATE INDEX "Copy_bookId_status_idx" ON "Copy"("bookId", "status");

-- CreateIndex
CREATE INDEX "BorrowRequest_studentId_createdAt_idx" ON "BorrowRequest"("studentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_requestId_key" ON "Reservation"("requestId");

-- CreateIndex
CREATE INDEX "Reservation_status_expiresAt_idx" ON "Reservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Reservation_studentId_status_idx" ON "Reservation"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_reservationId_key" ON "Loan"("reservationId");

-- CreateIndex
CREATE INDEX "Loan_studentId_status_idx" ON "Loan"("studentId", "status");

-- CreateIndex
CREATE INDEX "Loan_status_dueAt_idx" ON "Loan"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "Infraction_loanId_type_key" ON "Infraction"("loanId", "type");

-- CreateIndex
CREATE INDEX "Sanction_studentId_status_idx" ON "Sanction"("studentId", "status");

-- CreateIndex
CREATE INDEX "Acquisition_studentId_createdAt_idx" ON "Acquisition"("studentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "StatusHistory_entity_entityId_idx" ON "StatusHistory"("entity", "entityId");

-- CreateIndex
CREATE INDEX "_AuthorToBook_B_index" ON "_AuthorToBook"("B");

-- CreateIndex
CREATE INDEX "_BookToCategory_B_index" ON "_BookToCategory"("B");

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityVerification" ADD CONSTRAINT "IdentityVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Copy" ADD CONSTRAINT "Copy_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowRequest" ADD CONSTRAINT "BorrowRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowRequest" ADD CONSTRAINT "BorrowRequest_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "BorrowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "Copy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "Copy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Infraction" ADD CONSTRAINT "Infraction_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Infraction" ADD CONSTRAINT "Infraction_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sanction" ADD CONSTRAINT "Sanction_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sanction" ADD CONSTRAINT "Sanction_infractionId_fkey" FOREIGN KEY ("infractionId") REFERENCES "Infraction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acquisition" ADD CONSTRAINT "Acquisition_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acquisition" ADD CONSTRAINT "Acquisition_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AuthorToBook" ADD CONSTRAINT "_AuthorToBook_A_fkey" FOREIGN KEY ("A") REFERENCES "Author"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AuthorToBook" ADD CONSTRAINT "_AuthorToBook_B_fkey" FOREIGN KEY ("B") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BookToCategory" ADD CONSTRAINT "_BookToCategory_A_fkey" FOREIGN KEY ("A") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BookToCategory" ADD CONSTRAINT "_BookToCategory_B_fkey" FOREIGN KEY ("B") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- PostgreSQL business invariants that Prisma cannot express.
CREATE UNIQUE INDEX "Reservation_one_active_per_copy" ON "Reservation" ("copyId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "Loan_one_active_per_copy" ON "Loan" ("copyId") WHERE "status" IN ('ACTIVE', 'OVERDUE');
ALTER TABLE "Book" ADD CONSTRAINT "Book_nonnegative_price" CHECK ("priceDh" >= 0);
ALTER TABLE "Student" ADD CONSTRAINT "Student_nonnegative_counters" CHECK ("lateCycle" >= 0 AND "suspensions" >= 0);
ALTER TABLE "LibrarySettings" ADD CONSTRAINT "LibrarySettings_positive_limits" CHECK ("maxLoans" BETWEEN 1 AND 20 AND "loanDays" BETWEEN 1 AND 365 AND "pickupHours" BETWEEN 1 AND 720 AND "lateSuspensionDays" BETWEEN 1 AND 365 AND "minorDamageDays" BETWEEN 1 AND 365);
ALTER TABLE "Sanction" ADD CONSTRAINT "Sanction_nonnegative_amount" CHECK ("amountDh" IS NULL OR "amountDh" >= 0);
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_valid_dates" CHECK ("dueAt" > "handedAt" AND ("returnedAt" IS NULL OR "returnedAt" >= "handedAt"));
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_closed_has_return" CHECK (("status" = 'CLOSED') = ("returnedAt" IS NOT NULL));

-- Lock the physical copy to serialize even raw SQL writes spanning two tables.
CREATE FUNCTION guard_copy_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER "Reservation_guard_assignment" BEFORE INSERT OR UPDATE ON "Reservation" FOR EACH ROW EXECUTE FUNCTION guard_copy_assignment();
CREATE TRIGGER "Loan_guard_assignment" BEFORE INSERT OR UPDATE ON "Loan" FOR EACH ROW EXECUTE FUNCTION guard_copy_assignment();

-- Deferred checks permit atomic handover/return, and forbid inconsistent commits.
CREATE FUNCTION assert_copy_circulation(copy_uuid uuid) RETURNS void LANGUAGE plpgsql AS $$
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
CREATE FUNCTION check_copy_circulation_deferred() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='Copy' THEN
    IF TG_OP <> 'DELETE' THEN PERFORM assert_copy_circulation(NEW.id); END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN PERFORM assert_copy_circulation(OLD."copyId"); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM assert_copy_circulation(NEW."copyId"); END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Copy_circulation_consistency" AFTER INSERT OR UPDATE ON "Copy" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_copy_circulation_deferred();
CREATE CONSTRAINT TRIGGER "Reservation_circulation_consistency" AFTER INSERT OR UPDATE OR DELETE ON "Reservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_copy_circulation_deferred();
CREATE CONSTRAINT TRIGGER "Loan_circulation_consistency" AFTER INSERT OR UPDATE OR DELETE ON "Loan" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_copy_circulation_deferred();
