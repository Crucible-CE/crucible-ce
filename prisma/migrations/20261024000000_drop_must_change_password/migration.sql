-- The admin "temporary password" action was replaced by one-time reset links
-- (POST /api/admin/users/[id]/reset-link), so the forced-change flag is unused.

-- AlterTable
ALTER TABLE "User" DROP COLUMN "mustChangePassword";
