-- 1. Add the missing schema column
ALTER TABLE batches ADD COLUMN IF NOT EXISTS original_quantity INTEGER DEFAULT 0;

-- 2. Backfill existing data
UPDATE batches SET original_quantity = quantity_in_stock WHERE original_quantity = 0;

-- 3. Create the robust aggregate RPC
-- We use subqueries for batches and sale_items to prevent JOIN fan-out.
-- Using SECURITY DEFINER bypasses RLS so all branches see the true cross-branch totals for shared suppliers.
CREATE OR REPLACE FUNCTION get_supplier_dashboard_stats()
RETURNS TABLE (
    id UUID,
    name TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    branch_id UUID,
    total_spent NUMERIC,
    total_profit_generated NUMERIC,
    last_purchase_date DATE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.id,
        s.name,
        s.contact_phone,
        s.contact_email,
        s.branch_id,
        COALESCE(b_agg.total_spent, 0) AS total_spent,
        COALESCE(si_agg.total_profit, 0) AS total_profit_generated,
        b_agg.last_purchase_date
    FROM suppliers s
    LEFT JOIN (
        SELECT supplier_id, 
               SUM(original_quantity * cost_per_unit) AS total_spent,
               MAX(date_purchased) AS last_purchase_date
        FROM batches
        GROUP BY supplier_id
    ) b_agg ON b_agg.supplier_id = s.id
    LEFT JOIN (
        SELECT b.supplier_id,
               SUM(si.quantity * (si.price_at_sale - b.cost_per_unit)) AS total_profit
        FROM sale_items si
        JOIN batches b ON b.id = si.batch_id
        GROUP BY b.supplier_id
    ) si_agg ON si_agg.supplier_id = s.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
