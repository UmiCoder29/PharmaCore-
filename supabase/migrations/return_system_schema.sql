-- ==========================================
-- PharmaCore Return/Refund System Schema
-- ==========================================

-- 1. Insert default setting for admin refund threshold
INSERT INTO settings (key, value) VALUES ('refund_approval_threshold', '5000') ON CONFLICT (key) DO NOTHING;

-- 2. Create returns table
CREATE TABLE returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID REFERENCES sales(id) ON DELETE CASCADE,
    return_date TIMESTAMPTZ DEFAULT now(),
    refund_method TEXT NOT NULL CHECK (refund_method IN ('Cash', 'Store Credit')),
    total_refund_amount NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
    processed_by_user_id UUID REFERENCES app_users(id),
    branch_id UUID REFERENCES branches(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Create return_items table
CREATE TABLE return_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id UUID REFERENCES returns(id) ON DELETE CASCADE,
    sale_item_id UUID REFERENCES sale_items(id),
    medicine_id UUID REFERENCES medicines(id),
    batch_id UUID REFERENCES batches(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    reason TEXT NOT NULL,
    condition TEXT NOT NULL CHECK (condition IN ('opened', 'unopened', 'N/A')),
    refund_amount NUMERIC NOT NULL DEFAULT 0,
    quarantined BOOLEAN DEFAULT FALSE,
    restored_to_stock BOOLEAN DEFAULT FALSE
);

-- 4. Indexes for performance
CREATE INDEX idx_returns_sale ON returns(sale_id);
CREATE INDEX idx_returns_date ON returns(return_date);
CREATE INDEX idx_returns_status ON returns(status);
CREATE INDEX idx_returns_branch ON returns(branch_id);
CREATE INDEX idx_return_items_return ON return_items(return_id);
CREATE INDEX idx_return_items_quarantine ON return_items(quarantined);

-- 5. RLS Policies
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;

-- Admin: FULL access
CREATE POLICY "admin_all_returns" ON returns TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "admin_all_return_items" ON return_items TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Pharmacist: Read their own returns
CREATE POLICY "pharmacist_read_own_returns" ON returns FOR SELECT TO authenticated USING (processed_by_user_id = auth.uid());
CREATE POLICY "pharmacist_read_own_return_items" ON return_items FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM returns WHERE returns.id = return_items.return_id AND returns.processed_by_user_id = auth.uid())
);

-- Note: INSERT is handled securely via process_return function, but we add a strict policy just in case
CREATE POLICY "create_returns" ON returns
  FOR INSERT WITH CHECK (
    processed_by_user_id = auth.uid()
    OR is_admin()
  );

CREATE POLICY "create_return_items" ON return_items
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM returns WHERE returns.id = return_items.return_id AND returns.processed_by_user_id = auth.uid())
    OR is_admin()
  );

-- ==========================================
-- 6. SECURITY DEFINER FUNCTIONS
-- ==========================================

-- Function to process a return
CREATE OR REPLACE FUNCTION public.process_return(
    p_return_id UUID,
    p_sale_id UUID,
    p_items JSONB,
    p_refund_method TEXT
) RETURNS UUID AS $$
DECLARE
    v_user_id UUID;
    v_branch_id UUID;
    v_item JSONB;
    v_return_item_id UUID;
    v_sale_item RECORD;
    v_total_refund NUMERIC := 0;
    v_item_refund NUMERIC := 0;
    v_quarantined BOOLEAN;
    v_restored BOOLEAN;
    v_threshold NUMERIC;
    v_status TEXT := 'completed';
BEGIN
    -- Verify caller
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Get branch
    SELECT branch_id INTO v_branch_id FROM public.app_users WHERE id = v_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found in app_users';
    END IF;

    -- Calculate total refund securely based on original sale items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        -- Look up original sale item to enforce MRP rule (can't refund more than sale price per unit)
        SELECT * INTO v_sale_item FROM public.sale_items WHERE id = (v_item->>'sale_item_id')::UUID;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Sale item not found for ID %', v_item->>'sale_item_id';
        END IF;

        IF (v_item->>'quantity')::INTEGER > v_sale_item.quantity THEN
            RAISE EXCEPTION 'Cannot return more quantity than originally sold';
        END IF;

        -- Price is enforced from the original sale line item (price_at_sale)
        v_item_refund := ((v_sale_item.subtotal_item / v_sale_item.quantity) * (v_item->>'quantity')::INTEGER);
        v_total_refund := v_total_refund + v_item_refund;
    END LOOP;

    -- Check Approval Threshold (Cash only)
    IF p_refund_method = 'Cash' THEN
        SELECT value::NUMERIC INTO v_threshold FROM public.settings WHERE key = 'refund_approval_threshold';
        IF NOT FOUND THEN v_threshold := 5000; END IF;
        
        IF v_total_refund > v_threshold AND NOT is_admin() THEN
            v_status := 'pending';
        END IF;
    END IF;

    -- Insert return record
    INSERT INTO public.returns (
        id, sale_id, return_date, refund_method, total_refund_amount, status, processed_by_user_id, branch_id
    ) VALUES (
        p_return_id, p_sale_id, now(), p_refund_method, v_total_refund, v_status, v_user_id, v_branch_id
    );

    -- Loop through items again to insert and conditionally update stock
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_return_item_id := gen_random_uuid();
        
        -- Determine routing based on Reason & Condition
        v_quarantined := FALSE;
        v_restored := FALSE;
        
        IF v_item->>'reason' = 'Wrong item given' AND v_item->>'condition' = 'unopened' THEN
            v_restored := TRUE;
        ELSIF v_item->>'reason' = 'Customer changed mind (unopened)' AND v_item->>'condition' = 'unopened' THEN
            v_restored := TRUE;
        ELSIF v_item->>'reason' = 'Wrong prescription' THEN
            v_quarantined := TRUE;
        ELSIF v_item->>'reason' = 'Suspected counterfeit or quality issue' THEN
            v_quarantined := TRUE;
        ELSIF v_item->>'reason' = 'Other' THEN
            IF v_item->>'condition' = 'unopened' THEN
                v_restored := TRUE;
            ELSE
                v_quarantined := TRUE;
            END IF;
        ELSE
            -- Default safe fallback
            v_quarantined := TRUE;
        END IF;

        -- Fetch the exact item_refund calculated earlier
        SELECT * INTO v_sale_item FROM public.sale_items WHERE id = (v_item->>'sale_item_id')::UUID;
        v_item_refund := ((v_sale_item.subtotal_item / v_sale_item.quantity) * (v_item->>'quantity')::INTEGER);

        -- Insert return item
        INSERT INTO public.return_items (
            id, return_id, sale_item_id, medicine_id, batch_id, quantity, reason, condition, refund_amount, quarantined, restored_to_stock
        ) VALUES (
            v_return_item_id, 
            p_return_id, 
            (v_item->>'sale_item_id')::UUID,
            v_sale_item.medicine_id,
            v_sale_item.batch_id,
            (v_item->>'quantity')::INTEGER,
            v_item->>'reason',
            v_item->>'condition',
            v_item_refund,
            v_quarantined,
            v_restored
        );

        -- If completed immediately, restore stock immediately
        IF v_status = 'completed' AND v_restored = TRUE THEN
            UPDATE public.batches 
            SET quantity_in_stock = quantity_in_stock + (v_item->>'quantity')::INTEGER
            WHERE id = v_sale_item.batch_id;
        END IF;

    END LOOP;

    RETURN p_return_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function for Admin to approve a pending return
CREATE OR REPLACE FUNCTION public.approve_return(
    p_return_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_status TEXT;
    v_item RECORD;
BEGIN
    -- Verify caller is admin
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Requires admin role';
    END IF;

    -- Check if it's actually pending
    SELECT status INTO v_status FROM public.returns WHERE id = p_return_id;
    IF v_status != 'pending' THEN
        RAISE EXCEPTION 'Return is not pending approval';
    END IF;

    -- Process stock restoration for approved items
    FOR v_item IN SELECT batch_id, quantity, restored_to_stock FROM public.return_items WHERE return_id = p_return_id
    LOOP
        IF v_item.restored_to_stock = TRUE THEN
            UPDATE public.batches 
            SET quantity_in_stock = quantity_in_stock + v_item.quantity
            WHERE id = v_item.batch_id;
        END IF;
    END LOOP;

    -- Mark completed
    UPDATE public.returns SET status = 'completed', updated_at = now() WHERE id = p_return_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant permissions (to prevent permission denied errors)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
