/* รอบที่ 99 — หลังบ้านบัญชี ชุดแรก (SRS 1.5 M2)
   วางบิลเป็นงวด · ใบแจ้งหนี้ · รับชำระ · ใบเสร็จ · ภาษีหัก ณ ที่จ่ายที่บริษัทต้องนำส่ง

   รอบนี้ทำแค่ "ที่เก็บ" — ตาราง สิทธิ์เข้าถึง และเลขที่เอกสาร ยังไม่แตะหน้าเว็บ

   ของเดิมฝั่งบัญชีเก็บสำเนาดีลไว้เป็นก้อนของตัวเอง (AccDeal ใน acc-data.ts)
   ทั้งชื่อลูกค้า เลขที่ใบเสนอราคา ยอดก่อนภาษี และยอดหัก ณ ที่จ่าย
   ที่นี่ไม่ทำสำเนา — ผูกกับดีลของฝ่ายขายตรง ๆ แล้วอ่านยอดจากใบเสนอราคาของดีลนั้น
   ข้อมูลชุดเดียวกันอยู่สองที่เมื่อไรก็เพี้ยนเมื่อนั้น (เคยเจอมาแล้วตอนย้ายฝ่ายขาย)

   เงินที่บันทึกไว้แล้วแก้ไม่ได้และลบไม่ได้ — ใบแจ้งหนี้ที่ออกเลขแล้ว ใบเสร็จ และการรับชำระ
   จะยกเลิกหรือแก้ยอดต้องออกใบลดหนี้ ซึ่งต้องผ่านผู้บริหาร (คนละรอบ ยังไม่ทำในนี้) */

-- ─── แผนวางบิลของดีล ───────────────────────────────────────────────
/*
 * งวดวางบิลของดีลหนึ่ง — รวมทุกงวดต้องเท่ากับยอดดีลพอดี
 * เก็บทั้งสัดส่วนและจำนวนเงิน เพราะเศษสตางค์ของงวดสุดท้ายถูกปัดให้ลงตัวกับยอดรวม
 * คิดใหม่จากสัดส่วนทีหลังจะได้ยอดไม่ตรงกับใบแจ้งหนี้ที่ออกไปแล้ว
 */
create table if not exists public.deal_installments (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references public.deals (id) on delete cascade,
  seq        int  not null check (seq >= 1),
  pct        numeric not null default 0 check (pct >= 0),
  amount     numeric not null default 0 check (amount >= 0),
  due        date,
  created_at timestamptz not null default now(),
  created_by uuid references public.employees (id) on delete set null,
  unique (deal_id, seq)
);

/* ดีลใหม่ที่ฝ่ายบัญชียังไม่ได้เปิดดู — ขึ้นจุดแดงที่เมนูวางบิล (AC-BR-01) */
alter table public.deals add column if not exists acc_seen boolean not null default false;

-- ─── ใบแจ้งหนี้ ────────────────────────────────────────────────────
create table if not exists public.invoices (
  id          uuid primary key default gen_random_uuid(),
  no          text not null unique,
  deal_id     uuid not null references public.deals (id) on delete restrict,
  seq         int  not null check (seq >= 1),
  issue       date not null,
  due         date,
  /* ฐานก่อนภาษี · ภาษีมูลค่าเพิ่ม · ภาษีที่ลูกค้าหักไว้ตามใบเสนอราคา */
  base        numeric not null default 0 check (base >= 0),
  vat         numeric not null default 0 check (vat >= 0),
  wht         numeric not null default 0 check (wht >= 0),
  /* ยอดที่ลูกค้าต้องโอน = ฐาน + VAT − หัก ณ ที่จ่าย */
  total       numeric not null default 0,
  /* ยอดค้างคิดก่อนหักภาษี ณ ที่จ่าย เพราะเงินที่ลูกค้าหักไว้ถือว่าจ่ายแล้ว (นำส่งสรรพากรแทนเรา)
     ไม่งั้นงวดที่ถูกหักภาษีจะค้างยอดเท่าภาษีที่ถูกหักตลอดไป */
  outstanding numeric not null default 0,
  status      text not null default 'pending'
              check (status in ('pending', 'partial', 'paid', 'cancelled')),
  /* ยกเลิกพร้อมดีล — ต้องรู้ว่าใครสั่งและเมื่อไร */
  cancel_at   timestamptz,
  cancel_by   text not null default '',
  cancel_why  text not null default '',
  cancel_note text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid references public.employees (id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique (deal_id, seq)
);

create index if not exists invoices_deal_idx   on public.invoices (deal_id);
create index if not exists invoices_status_idx on public.invoices (status);

/* บันทึกการติดตามหนี้ของใบแจ้งหนี้ใบหนึ่ง */
create table if not exists public.invoice_collections (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  on_date    date not null,
  channel    text not null default '',
  result     text not null default '',
  next_step  text not null default '',
  by_id      uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists invoice_collections_inv_idx
  on public.invoice_collections (invoice_id, on_date desc);

-- ─── รับชำระและใบเสร็จ ─────────────────────────────────────────────
/*
 * รับชำระหนึ่งครั้ง = ออกใบเสร็จหนึ่งใบ (ต้นแบบ billing.html)
 * เก็บแยกสองตารางเพราะใบเสร็จเป็นเอกสารที่ส่งลูกค้า มีเลขที่ของตัวเอง
 * ส่วนการรับชำระเป็นรายการเงินเข้า ใช้คิดยอดค้าง
 *
 * received = เงินที่โอนเข้าบัญชีจริง ไม่รวมภาษีที่ลูกค้าหักไว้
 */
create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  on_date    date not null,
  received   numeric not null default 0 check (received >= 0),
  wht        numeric not null default 0 check (wht >= 0),
  /* ได้หนังสือรับรองการหักภาษี ณ ที่จ่ายจากลูกค้าแล้วหรือยัง */
  cert_received boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.employees (id) on delete set null
);

create index if not exists payments_inv_idx on public.payments (invoice_id);

create table if not exists public.receipts (
  id         uuid primary key default gen_random_uuid(),
  no         text not null unique,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  payment_id uuid references public.payments (id) on delete set null,
  on_date    date not null,
  base       numeric not null default 0 check (base >= 0),
  vat_amount numeric not null default 0 check (vat_amount >= 0),
  wht        numeric not null default 0 check (wht >= 0),
  /* เงินที่ได้รับจริง = ฐาน + VAT − หัก ณ ที่จ่าย
     ออกใบเสร็จเกินกว่าเงินที่ได้รับคือเอกสารเท็จ */
  total      numeric not null default 0 check (total >= 0),
  cert_received boolean not null default false,
  /* ผู้ออกจดทะเบียนภาษีมูลค่าเพิ่มไหม — กำหนดชื่อเอกสารที่พิมพ์ ผู้ใช้เลือกเองไม่ได้ */
  vat_doc    boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.employees (id) on delete set null
);

create index if not exists receipts_inv_idx on public.receipts (invoice_id);

-- ─── ภาษีหัก ณ ที่จ่ายที่บริษัทต้องนำส่ง ──────────────────────────
/*
 * คนละเรื่องกับภาษีที่ลูกค้าหักเรา — อันนี้คือตอนบริษัทจ่ายเงินให้คนอื่นแล้วต้องหักไว้นำส่ง
 * นิติบุคคลยื่น ภ.ง.ด.53 บุคคลธรรมดายื่น ภ.ง.ด.3
 */
create table if not exists public.wht_rows (
  id         uuid primary key default gen_random_uuid(),
  on_date    date not null,
  name       text not null,
  tax_id     text not null default '',
  kind       text not null check (kind in ('53', '3')),
  pay_type   text not null default '',
  base       numeric not null default 0 check (base >= 0),
  rate       numeric not null default 0 check (rate >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references public.employees (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists wht_rows_date_idx on public.wht_rows (on_date desc);

-- ─── เลขที่เอกสารและด่านกันข้อมูลเพี้ยน ───────────────────────────
create or replace function public.stamp_invoice_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.no is null or new.no = '' then new.no := public.next_sales_no('invoice', 'INV'); end if;
  return new;
end $$;

create or replace function public.stamp_receipt_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.no is null or new.no = '' then new.no := public.next_sales_no('receipt', 'RCP'); end if;
  return new;
end $$;

/*
 * ใบแจ้งหนี้ที่ออกเลขแล้วแก้ยอดไม่ได้ — จะเปลี่ยนยอดต้องออกใบลดหนี้ซึ่งต้องผ่านผู้บริหาร
 * ยอมให้ขยับเฉพาะสถานะ ยอดค้าง และร่องรอยการยกเลิก
 */
create or replace function public.lock_invoice_edit() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.no is distinct from old.no
     or new.deal_id is distinct from old.deal_id
     or new.seq is distinct from old.seq
     or new.base is distinct from old.base
     or new.vat is distinct from old.vat
     or new.wht is distinct from old.wht
     or new.total is distinct from old.total
     or new.issue is distinct from old.issue then
    raise exception 'invoice_locked';
  end if;
  if new.status = 'cancelled' and coalesce(trim(new.cancel_why), '') = '' then
    raise exception 'need_cancel_reason';
  end if;
  new.updated_at := now();
  return new;
end $$;

/* ใบเสร็จออกแล้วแก้ไม่ได้เลย นอกจากติ๊กว่าได้รับหนังสือรับรองหัก ณ ที่จ่ายแล้ว */
create or replace function public.lock_receipt_edit() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.no is distinct from old.no
     or new.invoice_id is distinct from old.invoice_id
     or new.base is distinct from old.base
     or new.vat_amount is distinct from old.vat_amount
     or new.wht is distinct from old.wht
     or new.total is distinct from old.total
     or new.on_date is distinct from old.on_date then
    raise exception 'receipt_locked';
  end if;
  return new;
end $$;

/* รับชำระแล้วแก้ยอดไม่ได้ ติ๊กได้แค่ว่าได้หนังสือรับรองแล้ว */
create or replace function public.lock_payment_edit() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.invoice_id is distinct from old.invoice_id
     or new.on_date is distinct from old.on_date
     or new.received is distinct from old.received
     or new.wht is distinct from old.wht then
    raise exception 'payment_locked';
  end if;
  return new;
end $$;

drop trigger if exists invoices_no      on public.invoices;
drop trigger if exists invoices_lock    on public.invoices;
drop trigger if exists receipts_no      on public.receipts;
drop trigger if exists receipts_lock    on public.receipts;
drop trigger if exists payments_lock    on public.payments;
drop trigger if exists wht_rows_touch   on public.wht_rows;

create trigger invoices_no    before insert on public.invoices
  for each row execute function public.stamp_invoice_no();
create trigger invoices_lock  before update on public.invoices
  for each row execute function public.lock_invoice_edit();
create trigger receipts_no    before insert on public.receipts
  for each row execute function public.stamp_receipt_no();
create trigger receipts_lock  before update on public.receipts
  for each row execute function public.lock_receipt_edit();
create trigger payments_lock  before update on public.payments
  for each row execute function public.lock_payment_edit();
create trigger wht_rows_touch before update on public.wht_rows
  for each row execute function public.touch_updated_at();

-- ─── สิทธิ์เข้าถึง ──────────────────────────────────────────────────
/*
 * ใครเห็น  : บัญชี · ผู้จัดการทั่วไป · ผู้บริหาร · ฝ่ายขาย (ต้องตามงานที่ตัวเองปิดได้)
 * ใครเขียน : บัญชี · ผู้บริหาร เท่านั้น — ฝ่ายขายดูได้อย่างเดียว ไม่ออกใบแจ้งหนี้เอง
 * ลบ       : ไม่เปิดให้ใครเลย เอกสารการเงินต้องตามรอยได้
 */
create or replace function public.can_see_acc() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('acc') or public.has_role('gm')
      or public.has_role('ceo') or public.has_role('sales')
$$;

create or replace function public.can_edit_acc() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('acc') or public.has_role('ceo')
$$;

revoke all on function public.can_see_acc() from public, anon;
revoke all on function public.can_edit_acc() from public, anon;
grant execute on function public.can_see_acc() to authenticated;
grant execute on function public.can_edit_acc() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['deal_installments', 'invoices', 'invoice_collections',
                           'payments', 'receipts', 'wht_rows']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);

    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_see_acc())',
                   t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_edit_acc())',
                   t || '_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_change', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_edit_acc()) with check (public.can_edit_acc())',
                   t || '_change', t);
  end loop;
end $$;

/* แผนวางบิลยังไม่ใช่เอกสารการเงิน ลบทิ้งแล้ววางใหม่ได้ตราบที่ยังไม่มีใบแจ้งหนี้ของงวดนั้น */
grant delete on public.deal_installments to authenticated;
drop policy if exists deal_installments_delete on public.deal_installments;
create policy deal_installments_delete on public.deal_installments
  for delete to authenticated
  using (
    public.can_edit_acc()
    and not exists (
      select 1 from public.invoices i
       where i.deal_id = public.deal_installments.deal_id
         and i.seq = public.deal_installments.seq
    )
  );
