-- Preserve every user and audit reference while replacing the former ADMIN
-- business role with explicit sensitive-operation permissions.
ALTER TABLE "User"
  ADD COLUMN "canManageUsers" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canManageSettings" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canViewAudit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canRevokeSanctions" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User"
SET "canManageUsers" = true,
    "canManageSettings" = true,
    "canViewAudit" = true,
    "canRevokeSanctions" = true
WHERE "role" = 'ADMIN';

UPDATE "User" SET "role" = 'LIBRARIAN' WHERE "role" = 'ADMIN';

ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
CREATE TYPE "Role_two_roles" AS ENUM ('STUDENT', 'LIBRARIAN');
ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "Role_two_roles"
  USING ("role"::text::"Role_two_roles");
DROP TYPE "Role";
ALTER TYPE "Role_two_roles" RENAME TO "Role";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'STUDENT';
