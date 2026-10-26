-- PharmaCore: Pakistan / Sindh pharmacy POS foundation
-- Apply this migration after the existing schema migrations.
-- FBR transmission is deliberately not implemented here: it must be connected
-- through a licensed FBR integrator or PRAL once the business is registered.

ALTER TABLE public.medicines
  ADD COLUMN IF NOT EXISTS prescription_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS controlled_schedule TEXT,
  ADD COLUMN IF NOT EXISTS reorder_level INTEGER NOT NULL DEFAULT 10 CHECK (reorder_level >= 0);

CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT,
  cnic TEXT,
  address TEXT,
  date_of_birth DATE,
  allergies TEXT,
  notes TEXT,
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_branch_phone_unique
  ON public.customers(branch_id, phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  prescriber_name TEXT NOT NULL,
  prescriber_registration_no TEXT,
  prescription_date DATE NOT NULL,
  attachment_reference TEXT,
  status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('pending', 'verified', 'rejected', 'dispensed')),
  verified_by_user_id UUID REFERENCES public.app_users(id),
  verified_at TIMESTAMPTZ,
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id),
  ADD COLUMN IF NOT EXISTS prescription_id UUID REFERENCES public.prescriptions(id),
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'card', 'jazzcash', 'easypaisa', 'bank_transfer', 'credit', 'split')),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  ADD COLUMN IF NOT EXISTS cash_received NUMERIC,
  ADD COLUMN IF NOT EXISTS change_amount NUMERIC NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS fbr_invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS fbr_qr_payload TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS sales_invoice_number_unique
  ON public.sales(invoice_number) WHERE invoice_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sale_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'jazzcash', 'easypaisa', 'bank_transfer', 'credit')),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_customer ON public.sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_customer ON public.prescriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON public.sale_payments(sale_id);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_branch_access ON public.customers;
CREATE POLICY customers_branch_access ON public.customers FOR ALL TO authenticated
  USING (branch_id = get_user_branch_id() OR is_admin())
  WITH CHECK (branch_id = get_user_branch_id() OR is_admin());

DROP POLICY IF EXISTS prescriptions_branch_access ON public.prescriptions;
CREATE POLICY prescriptions_branch_access ON public.prescriptions FOR ALL TO authenticated
  USING (branch_id = get_user_branch_id() OR is_admin())
  WITH CHECK (branch_id = get_user_branch_id() OR is_admin());

DROP POLICY IF EXISTS sale_payments_access ON public.sale_payments;
CREATE POLICY sale_payments_access ON public.sale_payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND (s.branch_id = get_user_branch_id() OR is_admin())));

-- The sale RPC is the only writer for sale payments, keeping checkout atomic.
CREATE OR REPLACE FUNCTION public.process_sale(
  p_sale_id UUID,
  p_items JSONB,
  p_subtotal NUMERIC,
  p_total_tax NUMERIC,
  p_total_amount NUMERIC,
  p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS UUID AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_branch_id UUID;
  v_item JSONB;
  v_sale_item_id UUID;
  v_payment JSONB;
  v_invoice_number TEXT;
  v_customer_id UUID;
  v_prescription_id UUID;
  v_needs_prescription BOOLEAN;
  v_payment_total NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT branch_id INTO v_branch_id FROM public.app_users WHERE id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found in app_users'; END IF;

  v_customer_id := NULLIF(p_metadata->>'customer_id', '')::UUID;
  v_prescription_id := NULLIF(p_metadata->>'prescription_id', '')::UUID;
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) i
    JOIN public.medicines m ON m.id = (i->>'medicine_id')::UUID
    WHERE m.prescription_required OR m.controlled_schedule IS NOT NULL
  ) INTO v_needs_prescription;

  IF v_needs_prescription AND (v_customer_id IS NULL OR v_prescription_id IS NULL) THEN
    RAISE EXCEPTION 'A verified prescription and customer are required for prescription or controlled medicines';
  END IF;
  IF v_prescription_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.prescriptions p WHERE p.id = v_prescription_id
      AND p.customer_id = v_customer_id AND p.branch_id = v_branch_id AND p.status = 'verified'
  ) THEN RAISE EXCEPTION 'Prescription is not verified for this customer'; END IF;

  SELECT COALESCE(SUM((p->>'amount')::NUMERIC), 0) INTO v_payment_total
  FROM jsonb_array_elements(COALESCE(p_metadata->'payments', '[]'::JSONB)) p;
  IF v_payment_total > 0 AND abs(v_payment_total - p_total_amount) > 0.01 THEN
    RAISE EXCEPTION 'Payment total must equal the sale total';
  END IF;

  v_invoice_number := 'PC-KHI-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(p_sale_id::TEXT, '-', ''), 1, 6));
  INSERT INTO public.sales (id, date_time, invoice_number, subtotal, total_tax, total_amount, cashier_user_id, branch_id,
    customer_id, prescription_id, payment_method, discount_amount, cash_received, change_amount, notes)
  VALUES (p_sale_id, now(), v_invoice_number, p_subtotal, p_total_tax, p_total_amount, v_user_id, v_branch_id,
    v_customer_id, v_prescription_id, COALESCE(p_metadata->>'payment_method', 'cash'),
    COALESCE((p_metadata->>'discount_amount')::NUMERIC, 0), NULLIF(p_metadata->>'cash_received', '')::NUMERIC,
    COALESCE((p_metadata->>'change_amount')::NUMERIC, 0), NULLIF(p_metadata->>'notes', ''));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    UPDATE public.batches SET quantity_in_stock = quantity_in_stock - (v_item->>'quantity')::INTEGER
      WHERE id = (v_item->>'batch_id')::UUID AND quantity_in_stock >= (v_item->>'quantity')::INTEGER;
    IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient stock for batch %', v_item->>'batch_number'; END IF;
    v_sale_item_id := gen_random_uuid();
    INSERT INTO public.sale_items (id, sale_id, medicine_id, batch_id, batch_number, name, quantity, price_at_sale, tax_rate_at_sale, tax_amount, subtotal_item, branch_id)
    VALUES (v_sale_item_id, p_sale_id, (v_item->>'medicine_id')::UUID, (v_item->>'batch_id')::UUID, v_item->>'batch_number',
      v_item->>'name', (v_item->>'quantity')::INTEGER, (v_item->>'price_at_sale')::NUMERIC,
      (v_item->>'tax_rate_at_sale')::NUMERIC, (v_item->>'tax_amount')::NUMERIC, (v_item->>'subtotal_item')::NUMERIC, v_branch_id);
  END LOOP;
  FOR v_payment IN SELECT * FROM jsonb_array_elements(COALESCE(p_metadata->'payments', '[]'::JSONB)) LOOP
    INSERT INTO public.sale_payments (sale_id, method, amount, reference)
    VALUES (p_sale_id, v_payment->>'method', (v_payment->>'amount')::NUMERIC, NULLIF(v_payment->>'reference', ''));
  END LOOP;
  IF v_prescription_id IS NOT NULL THEN UPDATE public.prescriptions SET status = 'dispensed', updated_at = now() WHERE id = v_prescription_id; END IF;
  RETURN p_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
