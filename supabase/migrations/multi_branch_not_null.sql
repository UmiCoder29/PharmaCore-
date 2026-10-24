-- Enforce branch_id is set for all regular users
-- We allow branch_id to be NULL ONLY if the user is a global owner (can_view_all_branches = true)
-- This prevents the UI from showing "Unknown Branch" due to missing branch assignments.

ALTER TABLE app_users 
ADD CONSTRAINT app_users_branch_id_check 
CHECK (branch_id IS NOT NULL OR can_view_all_branches = true);
