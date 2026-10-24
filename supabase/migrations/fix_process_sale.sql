-- ==========================================
-- PharmaCore Fix: process_sale stored procedure
-- ==========================================
-- This migration fixes the foreign key constraint issue on sale_items
-- by ensuring the sales row is inserted with the exact p_sale_id
-- before inserting sale_items that reference it.

CREATE OR REPLACE FUNCTION public.process_sale(
    p_sale_id UUID,
    p_items JSONB,
    p_subtotal NUMERIC,
    p_total_tax NUMERIC,
    p_total_amount NUMERIC
) RETURNS UUID AS $$
DECLARE
    v_user_id UUID;
    v_branch_id UUID;
    v_item JSONB;
    v_sale_item_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    SELECT branch_id INTO v_branch_id FROM public.app_users WHERE id = v_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'User not found in app_users'; END IF;

    -- 1. Insert parent sale record first
    INSERT INTO public.sales (
        id, date_time, subtotal, total_tax, total_amount, cashier_user_id, branch_id
    ) VALUES (
        p_sale_id, now(), p_subtotal, p_total_tax, p_total_amount, v_user_id, v_branch_id
    );

    -- 2. Deduct stock and insert sale_items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_sale_item_id := gen_random_uuid();
        
        UPDATE public.batches 
        SET quantity_in_stock = quantity_in_stock - (v_item->>'quantity')::INTEGER
        WHERE id = (v_item->>'batch_id')::UUID;

        IF EXISTS (SELECT 1 FROM public.batches WHERE id = (v_item->>'batch_id')::UUID AND quantity_in_stock < 0) THEN
            RAISE EXCEPTION 'Negative stock not allowed for batch %', v_item->>'batch_number';
        END IF;

        INSERT INTO public.sale_items (
            id, sale_id, medicine_id, batch_id, batch_number, name, quantity,
            price_at_sale, tax_rate_at_sale, tax_amount, subtotal_item, branch_id
        ) VALUES (
            v_sale_item_id, 
            p_sale_id, 
            (v_item->>'medicine_id')::UUID, 
            (v_item->>'batch_id')::UUID, 
            v_item->>'batch_number', 
            v_item->>'name', 
            (v_item->>'quantity')::INTEGER,
            (v_item->>'price_at_sale')::NUMERIC, 
            (v_item->>'tax_rate_at_sale')::NUMERIC, 
            (v_item->>'tax_amount')::NUMERIC, 
            (v_item->>'subtotal_item')::NUMERIC,
            v_branch_id
        );
    END LOOP;

    RETURN p_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
