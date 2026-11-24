/* รอบที่ 95 — หลังบ้านฝ่ายขาย ชุดแรก (SRS 1.5 M1)
   ผู้สนใจ/ลูกค้า · คำขอก่อนการขาย · ใบเสนอราคา · ดีล

   รอบนี้ทำแค่ "ที่เก็บ" — ตาราง สิทธิ์เข้าถึง และเลขที่เอกสาร
   ยังไม่แตะหน้าเว็บ หน้าเว็บจึงยังอ่านเขียนที่เครื่องเหมือนเดิมจนกว่าจะต่อในรอบถัดไป

   รูปข้อมูลยึดตามของจริงที่หน้าเว็บใช้อยู่ (crm-data.ts) ทุกช่อง
   เพื่อให้ย้ายข้อมูลเดิมขึ้นได้โดยไม่ต้องแก้หน้าจอ
   ชื่อคน (ผู้ดูแล · ผู้รับคำขอ) เก็บเป็นข้อความคู่กับรหัสพนักงาน เพราะทีมก่อนการขาย (BD/SA)
   ยังไม่มีแถวในทะเบียนพนักงาน ใส่รหัสไม่ได้ทุกราย */

-- ─── เลขที่เอกสารฝ่ายขาย ────────────────────────────────────────────
/*
 * ผู้สนใจใช้รหัสคนละแบบกับใบลา/โอที — LEAD-6909-001 คือ ปี พ.ศ. สองหลัก + เดือน + ลำดับสามหลัก
 * ลำดับเริ่มใหม่ทุกเดือน และเดินหน้าอย่างเดียว รายที่ปิดการขายแล้วเปลี่ยนหัวเป็น CUS- แต่เลขเดิม
 * จึงต้องนับรหัสทุกหัวในเดือนนั้น ไม่งั้นรายใหม่จะได้เลขซ้ำกับรายที่ปิดไปแล้ว
 *
 * ครั้งแรกของเดือนตั้งตัวนับจากรหัสที่มีอยู่จริงในตาราง เผื่อข้อมูลเดิมถูกย้ายขึ้นมาก่อน
 */
create or replace function public.next_lead_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_be    int  := extract(year from v_today)::int + 543;
  v_per   text := right(v_be::text, 2) || lpad(extract(month from v_today)::text, 2, '0');
  v_pre   text := coalesce(nullif(public.pay_settings() #>> array['docs', 'lead'], ''), 'LEAD');
  v_seed  int;
  v_no    int;
begin
  select coalesce(max((regexp_match(c.code, '^[A-Za-z]+-' || v_per || '-(\d+)$'))[1]::int), 0)
    into v_seed
    from public.customers c;

  insert into public.doc_counters (prefix, year_be, last_no)
  values ('LEAD:' || v_per, v_be, greatest(v_seed + 1, 1))
  on conflict (prefix, year_be)
    do update set last_no = greatest(public.doc_counters.last_no + 1, v_seed + 1)
  returning last_no into v_no;

  return v_pre || '-' || v_per || '-' || lpad(v_no::text, 3, '0');
end $$;

/* เลขที่เอกสารที่ให้ตั้งคำนำหน้าเองได้ — ใบเสนอราคาของ MAZ กับ B1 เดินคนละชุด */
create or replace function public.next_sales_no(p_key text, p_fallback text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pre text := coalesce(nullif(public.pay_settings() #>> array['docs', p_key], ''), p_fallback);
begin
  return public.next_doc_no(v_pre);
end $$;

-- ─── ผู้สนใจและลูกค้า ───────────────────────────────────────────────
/*
 * แถวเดียวกันทั้งตอนเป็นผู้สนใจและตอนเป็นลูกค้า — ปิดการขายแล้วเปลี่ยนรหัสจาก LEAD- เป็น CUS-
 * แล้วเก็บรหัสเดิมไว้ที่ lead_code ลิงก์เก่าและเอกสารเก่าจะได้ยังเปิดไปถูกราย (findParty)
 */
create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  lead_code     text,
  name          text not null,
  legal_name    text not null default '',
  contact       text not null default '',
  phone         text not null default '',
  email         text not null default '',
  address       text not null default '',
  legal_address text not null default '',
  /* "00000" = สำนักงานใหญ่ · ว่าง = ยังระบุไม่ได้ ออกใบกำกับภาษีไม่ได้ */
  branch        text not null default '',
  tax_id        text not null default '',
  source        text not null default '',
  buyer_type    text not null default 'juristic' check (buyer_type in ('juristic', 'individual')),
  status        text not null default 'รอนัดหมาย' check (status in ('รอนัดหมาย', 'ปิดงาน', 'ปฏิเสธ')),
  closed_reason text not null default '',
  /* ผู้ดูแล — ชื่อคือสิ่งที่หน้าจอแสดง รหัสพนักงานมีไว้ให้ด่านสิทธิ์ใช้ */
  owner         text not null default '',
  owner_id      uuid references public.employees (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.employees (id) on delete set null
);

create index if not exists customers_status_idx on public.customers (status);
create index if not exists customers_owner_idx  on public.customers (owner_id);
create unique index if not exists customers_lead_code_idx on public.customers (lead_code)
  where lead_code is not null;

/* บันทึกการติดต่อแต่ละครั้ง — โทร นัดพบ ส่งอีเมล */
create table if not exists public.customer_activities (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  on_date     date not null,
  channel     text not null default '',
  summary     text not null default '',
  next_action text not null default '',
  follow_up   date,
  by_id       uuid references public.employees (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists customer_activities_cust_idx
  on public.customer_activities (customer_id, on_date desc);

/* ประวัติเปลี่ยนสถานะและรับช่วงดูแล — ลบไม่ได้ ใครเปลี่ยนอะไรต้องตามรอยได้ */
create table if not exists public.customer_changes (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  kind        text not null check (kind in ('status', 'owner')),
  from_value  text not null default '',
  to_value    text not null default '',
  reason      text not null default '',
  by_name     text not null default '',
  by_id       uuid references public.employees (id) on delete set null,
  at          timestamptz not null default now()
);

create index if not exists customer_changes_cust_idx
  on public.customer_changes (customer_id, at desc);

-- ─── คำขอก่อนการขาย ────────────────────────────────────────────────
create table if not exists public.presales_requests (
  id             uuid primary key default gen_random_uuid(),
  no             text not null unique,
  customer_id    uuid not null references public.customers (id) on delete restrict,
  /* BD = ข้อเสนอเชิงธุรกิจ · SA = วิเคราะห์เชิงเทคนิค */
  kind           text not null check (kind in ('BD', 'SA')),
  problem        text not null default '',
  assignee       text not null default '',
  assignee_id    uuid references public.employees (id) on delete set null,
  due            date,
  urgency        text not null default 'ปกติ' check (urgency in ('ปกติ', 'ด่วน', 'ด่วนมาก')),
  /* ด่วนมากต้องบอกเหตุผล — ด่านอยู่ที่ทริกเกอร์ข้างล่าง */
  urgent_reason  text not null default '',
  budget         numeric not null default 0 check (budget >= 0),
  status         text not null default 'รอรับงาน'
                 check (status in ('รอรับงาน', 'กำลังทำ', 'รอข้อมูลเพิ่ม', 'ส่งกลับแล้ว', 'ปิดคำขอ')),
  ask            text not null default '',
  reply          text not null default '',
  hours          numeric not null default 0 check (hours >= 0),
  /* แผนงานของข้อเสนอเป็นช่วงสัปดาห์ PM แปลงเป็นวันจริงตอนรับงาน — เก็บทั้งก้อน */
  plan           jsonb,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.employees (id) on delete set null,
  updated_at     timestamptz not null default now()
);

create index if not exists presales_requests_cust_idx   on public.presales_requests (customer_id);
create index if not exists presales_requests_status_idx on public.presales_requests (status);

/* ข้อเสนอที่ส่งกลับแต่ละรอบ — ไฟล์ PDF หรือลิงก์ Canva */
create table if not exists public.presales_rounds (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.presales_requests (id) on delete cascade,
  round      int  not null check (round >= 1),
  at         date not null,
  by_name    text not null default '',
  by_id      uuid references public.employees (id) on delete set null,
  hours      numeric not null default 0 check (hours >= 0),
  note       text not null default '',
  /* รายการแรกอยู่ใน kind/name/url ส่วน files เก็บทั้งชุดของรอบนั้น */
  kind       text not null default 'pdf' check (kind in ('pdf', 'canva')),
  name       text not null default '',
  url        text not null default '',
  files      jsonb,
  created_at timestamptz not null default now(),
  unique (request_id, round)
);

-- ─── ใบเสนอราคา ────────────────────────────────────────────────────
/*
 * ไม่มีสถานะร่าง — บันทึกแล้วออกเลขที่ทันที แก้ใบเดิมไม่ได้
 * จะแก้ต้องออกใบใหม่แทน ใบเดิมกลายเป็น "แทนที่แล้ว" แล้วผูกกันด้วย replaces/replaced_by
 */
create table if not exists public.quotations (
  id           uuid primary key default gen_random_uuid(),
  no           text not null unique,
  customer_id  uuid not null references public.customers (id) on delete restrict,
  issuer       text not null default '',
  buyer_type   text not null default 'juristic' check (buyer_type in ('juristic', 'individual')),
  service      text not null default '',
  issued       date not null,
  valid_days   int  not null default 30 check (valid_days > 0),
  valid_until  date not null,
  amount       numeric not null default 0 check (amount >= 0),
  discount     numeric not null default 0 check (discount >= 0),
  wht          boolean not null default false,
  wht_pct      numeric,
  body         text not null default '',
  terms        text not null default '',
  status       text not null default 'ส่งแล้ว'
               check (status in ('ส่งแล้ว', 'ตอบรับ', 'ปฏิเสธ', 'หมดอายุ', 'แทนที่แล้ว')),
  revision     int  not null default 1 check (revision >= 1),
  sent_at      date,
  presales_id  uuid references public.presales_requests (id) on delete set null,
  replaces     text,
  replaced_by  text,
  rejected_at  date,
  reject_reason text not null default '',
  created_at   timestamptz not null default now(),
  created_by   uuid references public.employees (id) on delete set null,
  updated_at   timestamptz not null default now()
);

create index if not exists quotations_cust_idx   on public.quotations (customer_id);
create index if not exists quotations_status_idx on public.quotations (status);

/* ประวัติการแก้ไข พร้อมสำเนาของฉบับนั้นตอนถูกแทนที่ (ใช้เปิด "ดูฉบับนี้") */
create table if not exists public.quotation_revisions (
  id           uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations (id) on delete cascade,
  revision     int  not null check (revision >= 1),
  at           date not null,
  what         text not null default '',
  total        numeric not null default 0,
  snapshot     jsonb,
  created_at   timestamptz not null default now(),
  unique (quotation_id, revision)
);

-- ─── ดีลและใบงาน ───────────────────────────────────────────────────
create table if not exists public.deals (
  id            uuid primary key default gen_random_uuid(),
  no            text not null unique,
  customer_id   uuid not null references public.customers (id) on delete restrict,
  quotation_id  uuid references public.quotations (id) on delete set null,
  total         numeric not null default 0,
  status        text not null default 'ปิดการขาย'
                check (status in ('ปิดการขาย', 'ไม่ตกลง', 'ยกเลิก')),
  po_ref        text not null default '',
  start_on      date,
  delivery      date,
  scope         text not null default '',
  closed_at     date,
  lost_reason   text not null default '',
  /* ยกเลิกหลังปิดการขาย — ต้องมีเหตุผลเสมอ (ด่านอยู่ที่ทริกเกอร์) */
  cancel_at     date,
  cancel_by     text not null default '',
  cancel_why    text not null default '',
  /* ผู้ขายที่ปิดดีล — ฐานค่าคอมมิชชั่นของฝ่ายขาย */
  seller        text not null default '',
  seller_id     uuid references public.employees (id) on delete set null,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.employees (id) on delete set null,
  updated_at    timestamptz not null default now()
);

create index if not exists deals_cust_idx   on public.deals (customer_id);
create index if not exists deals_status_idx on public.deals (status);

/* สัญญาที่ฝ่ายขายแนบกับดีล — แนบเพิ่มได้ตลอด ลบไม่ได้ (ขอบเขตงานยึดใบเสนอราคาเสมอ) */
create table if not exists public.deal_contracts (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references public.deals (id) on delete cascade,
  no         text not null default '',
  signed     date,
  kind       text not null default 'pdf' check (kind in ('pdf', 'link')),
  name       text not null default '',
  url        text not null default '',
  by_name    text not null default '',
  by_id      uuid references public.employees (id) on delete set null,
  at         date not null default ((now() at time zone 'Asia/Bangkok')::date),
  created_at timestamptz not null default now()
);

create index if not exists deal_contracts_deal_idx on public.deal_contracts (deal_id);

create table if not exists public.job_orders (
  id         uuid primary key default gen_random_uuid(),
  no         text not null unique,
  deal_id    uuid not null references public.deals (id) on delete cascade,
  owner      text not null default '',
  owner_id   uuid references public.employees (id) on delete set null,
  item       text not null default '',
  due        date,
  status     text not null default 'สร้างแล้ว'
             check (status in ('สร้างแล้ว', 'มอบหมาย', 'กำลังทำ', 'ส่งมอบ')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_orders_deal_idx on public.job_orders (deal_id);

-- ─── ด่านกันข้อมูลเพี้ยน ───────────────────────────────────────────
/* ออกเลขที่ให้อัตโนมัติถ้าไม่ได้ส่งมา — เลขที่ต้องมาจากฐานข้อมูล ไม่ใช่จากเบราว์เซอร์
   สองเครื่องกดพร้อมกันจะได้เลขซ้ำกัน */
create or replace function public.stamp_customer_code() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.code is null or new.code = '' then new.code := public.next_lead_code(); end if;
  return new;
end $$;

create or replace function public.stamp_presales_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.no is null or new.no = '' then new.no := public.next_sales_no('presales', 'PS'); end if;
  /* ด่วนมากต้องบอกเหตุผล ไม่งั้นทุกใบจะกลายเป็นด่วนมากหมด */
  if new.urgency = 'ด่วนมาก' and coalesce(trim(new.urgent_reason), '') = '' then
    raise exception 'need_urgent_reason';
  end if;
  return new;
end $$;

create or replace function public.stamp_deal_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.no is null or new.no = '' then new.no := public.next_sales_no('deal', 'DL'); end if;
  /* ยกเลิกดีลต้องมีเหตุผลเสมอ (ของเดิมในหน้าเว็บบังคับไว้แล้ว ย้ายด่านลงมาที่ฐานข้อมูลด้วย) */
  if new.status = 'ยกเลิก' and coalesce(trim(new.cancel_why), '') = ''
                           and coalesce(trim(new.lost_reason), '') = '' then
    raise exception 'need_cancel_reason';
  end if;
  return new;
end $$;

create or replace function public.stamp_job_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.no is null or new.no = '' then new.no := public.next_sales_no('jobOrder', 'JO'); end if;
  return new;
end $$;

/* ใบเสนอราคาแก้ไม่ได้หลังออกเลขแล้ว — ยอมให้ขยับเฉพาะสถานะและร่องรอยการแทนที่
   ของเดิมในหน้าเว็บเขียนไว้ว่า "แก้ใบเดิมไม่ได้ ต้องออกใบใหม่แทน" ย้ายด่านลงมาที่ฐานข้อมูล */
create or replace function public.lock_quotation_edit() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.no is distinct from old.no
     or new.customer_id is distinct from old.customer_id
     or new.issuer is distinct from old.issuer
     or new.amount is distinct from old.amount
     or new.discount is distinct from old.discount
     or new.wht is distinct from old.wht
     or new.wht_pct is distinct from old.wht_pct
     or new.body is distinct from old.body
     or new.terms is distinct from old.terms
     or new.issued is distinct from old.issued
     or new.valid_days is distinct from old.valid_days then
    raise exception 'quotation_locked';
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists customers_code      on public.customers;
drop trigger if exists customers_touch     on public.customers;
drop trigger if exists presales_no         on public.presales_requests;
drop trigger if exists presales_touch      on public.presales_requests;
drop trigger if exists quotations_lock     on public.quotations;
drop trigger if exists deals_no            on public.deals;
drop trigger if exists deals_touch         on public.deals;
drop trigger if exists job_orders_no       on public.job_orders;
drop trigger if exists job_orders_touch    on public.job_orders;

create trigger customers_code   before insert on public.customers
  for each row execute function public.stamp_customer_code();
create trigger customers_touch  before update on public.customers
  for each row execute function public.touch_updated_at();
create trigger presales_no      before insert on public.presales_requests
  for each row execute function public.stamp_presales_no();
create trigger presales_touch   before update on public.presales_requests
  for each row execute function public.touch_updated_at();
create trigger quotations_lock  before update on public.quotations
  for each row execute function public.lock_quotation_edit();
create trigger deals_no         before insert on public.deals
  for each row execute function public.stamp_deal_no();
create trigger deals_touch      before update on public.deals
  for each row execute function public.touch_updated_at();
create trigger job_orders_no    before insert on public.job_orders
  for each row execute function public.stamp_job_no();
create trigger job_orders_touch before update on public.job_orders
  for each row execute function public.touch_updated_at();

-- ─── สิทธิ์เข้าถึง ──────────────────────────────────────────────────
/*
 * งานขายเป็นงานของทีม ไม่ใช่ของใครคนเดียว — ฝ่ายขายทุกคนเห็นทุกราย
 * เพราะต้องรับช่วงดูแลกันได้ และหัวหน้าต้องเห็นภาพรวม
 *
 * ใครเห็น  : ฝ่ายขาย · ทีมก่อนการขาย · ฝ่ายโครงการ · บัญชี · ผู้จัดการทั่วไป · ผู้บริหาร
 * ใครเขียน : ฝ่ายขาย · ผู้จัดการทั่วไป · ผู้บริหาร (ทีมก่อนการขายแก้ได้เฉพาะคำขอของตัวเอง)
 * ลบ       : ไม่เปิดให้ใครเลย เอกสารการขายต้องตามรอยได้
 */
create or replace function public.can_see_sales() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('sales') or public.has_role('ps') or public.has_role('pm')
      or public.has_role('acc')   or public.has_role('gm') or public.has_role('ceo')
$$;

create or replace function public.can_edit_sales() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('sales') or public.has_role('gm') or public.has_role('ceo')
$$;

revoke all on function public.can_see_sales() from public, anon;
revoke all on function public.can_edit_sales() from public, anon;
grant execute on function public.can_see_sales() to authenticated;
grant execute on function public.can_edit_sales() to authenticated;

revoke all on function public.next_lead_code() from public, anon;
revoke all on function public.next_sales_no(text, text) from public, anon;

do $$
declare t text;
begin
  foreach t in array array['customers', 'customer_activities', 'customer_changes',
                           'presales_requests', 'presales_rounds',
                           'quotations', 'quotation_revisions',
                           'deals', 'deal_contracts', 'job_orders']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;

/* อ่าน — ทุกบทบาทที่เกี่ยวกับงานขาย */
do $$
declare t text;
begin
  foreach t in array array['customers', 'customer_activities', 'customer_changes',
                           'presales_requests', 'presales_rounds',
                           'quotations', 'quotation_revisions',
                           'deals', 'deal_contracts', 'job_orders']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_see_sales())',
                   t || '_read', t);
  end loop;
end $$;

/* เขียน — ฝ่ายขายและหัวหน้า */
do $$
declare t text;
begin
  foreach t in array array['customers', 'customer_activities', 'customer_changes',
                           'quotations', 'quotation_revisions',
                           'deals', 'deal_contracts', 'job_orders']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_change', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_edit_sales())',
                   t || '_write', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_edit_sales()) with check (public.can_edit_sales())',
                   t || '_change', t);
  end loop;
end $$;

/* คำขอก่อนการขาย — ฝ่ายขายเป็นคนเปิดคำขอ ทีมก่อนการขายกับฝ่ายโครงการเป็นคนทำและตอบกลับ */
drop policy if exists presales_requests_write  on public.presales_requests;
drop policy if exists presales_requests_change on public.presales_requests;
create policy presales_requests_write on public.presales_requests
  for insert to authenticated with check (public.can_edit_sales());
create policy presales_requests_change on public.presales_requests
  for update to authenticated
  using (public.can_edit_sales() or public.has_role('ps') or public.has_role('pm'))
  with check (public.can_edit_sales() or public.has_role('ps') or public.has_role('pm'));

drop policy if exists presales_rounds_write  on public.presales_rounds;
drop policy if exists presales_rounds_change on public.presales_rounds;
create policy presales_rounds_write on public.presales_rounds
  for insert to authenticated
  with check (public.can_edit_sales() or public.has_role('ps') or public.has_role('pm'));
create policy presales_rounds_change on public.presales_rounds
  for update to authenticated
  using (public.can_edit_sales() or public.has_role('ps') or public.has_role('pm'))
  with check (public.can_edit_sales() or public.has_role('ps') or public.has_role('pm'));
