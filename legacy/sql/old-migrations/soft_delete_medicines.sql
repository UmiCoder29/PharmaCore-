-- Migration: Add is_active column for soft-delete functionality on medicines
-- This allows medicines to be archived instead of deleted, preventing FK violations on sale_items

ALTER TABLE medicines 
ADD COLUMN is_active BOOLEAN DEFAULT true;

-- Index for faster filtering on POS and Inventory queries
CREATE INDEX IF NOT EXISTS idx_medicines_is_active ON medicines(is_active);
