-- Prevent forged senders and tampering on subscription_inquiries.
-- Triggers run SECURITY INVOKER with a fixed search_path. Role truth comes from the caller's own app_users row
-- and the existing is_superadmin() helper.

create or replace function public.guard_subscription_inquiry_insert()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
v_role text;
begin
select role into v_role from public.app_users where id = auth.uid();
if v_role is null then
raise exception 'Not allowed: no profile for current user.' using errcode = '42501';
end if;

-- sender identity is always the real caller, never client-chosen
new.sender_id := auth.uid();
new.sender_role := v_role;

-- a new message starts read for its own side and unread for the other
if v_role = 'superadmin' then
new.is_read_by_superadmin := true;
new.is_read_by_pharmacy := false;
else
new.is_read_by_pharmacy := true;
new.is_read_by_superadmin := false;
end if;

return new;
end;
$$;

create or replace function public.guard_subscription_inquiry_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
-- immutable for everyone
if new.id is distinct from old.id
or new.pharmacy_id is distinct from old.pharmacy_id
or new.sender_id is distinct from old.sender_id
or new.sender_name is distinct from old.sender_name
or new.sender_role is distinct from old.sender_role
or new.message is distinct from old.message
or new.inquiry_type is distinct from old.inquiry_type
or new.requested_plan is distinct from old.requested_plan
or new.created_at is distinct from old.created_at then
raise exception 'Not allowed: inquiry content and sender are immutable.' using errcode = '42501';
end if;

-- each side may only flip its own read flag
if public.is_superadmin() then
if new.is_read_by_pharmacy is distinct from old.is_read_by_pharmacy then
raise exception 'Not allowed: superadmin cannot change the pharmacy read flag.' using errcode = '42501';
end if;
else
if new.is_read_by_superadmin is distinct from old.is_read_by_superadmin then
raise exception 'Not allowed: only the superadmin can change the superadmin read flag.' using errcode = '42501';
end if;
end if;

return new;
end;
$$;

drop trigger if exists trg_guard_subscription_inquiry_insert on public.subscription_inquiries;
create trigger trg_guard_subscription_inquiry_insert
before insert on public.subscription_inquiries
for each row execute function public.guard_subscription_inquiry_insert();

drop trigger if exists trg_guard_subscription_inquiry_update on public.subscription_inquiries;
create trigger trg_guard_subscription_inquiry_update
before update on public.subscription_inquiries
for each row execute function public.guard_subscription_inquiry_update();

-- Chat history should not be deletable from the client.
revoke delete on public.subscription_inquiries from authenticated;

revoke all on function public.guard_subscription_inquiry_insert() from public, anon;
revoke all on function public.guard_subscription_inquiry_update() from public, anon;
