-- ERP MAZ · backend รอบที่ 4 — ของระบบ
-- ตั้งค่าระบบ · วันหยุดบริษัท · ประวัติการตั้งค่า · แจ้งเตือน · ไฟล์แนบ
--
-- รอบนี้ไม่มีกติกาเรื่องเงิน แต่มีกติกาเรื่อง "ใครแก้ได้" และ "แก้แล้วต้องสืบย้อนได้"
-- ค่าตั้งค่าทุกตัวต้องอ่านจากที่นี่ที่เดียว ห้ามฝังเป็นค่าคงที่ในโค้ด (กติกาเดิมของระบบ)

-- ─── ตั้งค่าระบบ ───────────────────────────────────────────────────
/*
 * เก็บเป็นก้อน jsonb หนึ่งแถว ตามโครง SystemSettings ของหน้าเว็บ
 * เหตุที่ไม่แตกเป็นตารางย่อย — โครงยังขยับบ่อย และหน้าตั้งค่าอ่านทั้งก้อนอยู่แล้ว
 * แถวเดียวตลอด บังคับด้วย primary key ที่ตายตัว
 */
create table public.system_settings (
  id         boolean primary key default true check (id),
  data       jsonb not null default '{}',
  version    int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees (id)
);

insert into public.system_settings (id, data) values (true, '{}');

-- ─── วันหยุดบริษัท ─────────────────────────────────────────────────
create table public.holidays (
  on_date date primary key,
  name    text not null check (length(trim(name)) > 0),
  /* วันหยุดประจำปีที่เลื่อนตามปฏิทิน ปีหน้าคัดลอกมาแล้วแก้วันได้ */
  note    text not null default ''
);

-- ─── ประวัติการตั้งค่า ─────────────────────────────────────────────
/*
 * ใครเปลี่ยนอะไรเมื่อไร — หน้าประวัติการเปลี่ยนแปลงอ่านจากตารางนี้
 * เขียนได้อย่างเดียว ห้ามแก้ห้ามลบ ไม่งั้นก็ไม่ใช่ประวัติ
 */
create table public.setting_log (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  by     uuid references public.employees (id),
  by_name text not null default '',
  area   text not null,
  detail text not null,
  before jsonb,
  after  jsonb
);

create index setting_log_at_idx on public.setting_log (at desc);
create index setting_log_area_idx on public.setting_log (area, at desc);

-- ─── แจ้งเตือน ─────────────────────────────────────────────────────
/*
 * หน้าเว็บคำนวณรายการแจ้งเตือนจากสถานะปัจจุบันเอง ที่นี่เก็บเฉพาะสองอย่าง
 *   อ่านแล้วหรือยัง (ต่อคนต่อรายการ) และตั้งค่าว่าจะรับช่องทางไหนบ้าง
 * เคยพลาดมาแล้วว่าพอย้อนการอนุมัติ ข้อความเก่าหายไปเงียบ ๆ จึงมีตารางประกาศ
 * สำหรับเรื่องที่ต้องบอกเองไม่ใช่คำนวณจากสถานะ
 */
create table public.notification_reads (
  employee_id uuid not null references public.employees (id) on delete cascade,
  key         text not null,
  read_at     timestamptz not null default now(),
  primary key (employee_id, key)
);

create table public.notify_settings (
  employee_id uuid primary key references public.employees (id) on delete cascade,
  data        jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

/* เครื่องที่รับแจ้งเตือนเข้าเครื่อง (Web Push) — หนึ่งคนมีหลายเครื่องได้ */
create table public.push_devices (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth_key    text not null,
  label       text not null default '',
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);

create index push_emp_idx on public.push_devices (employee_id);

/* ประกาศจากผู้ดูแล — เรื่องที่ไม่ได้คำนวณจากสถานะ ต้องบอกเอง */
create table public.announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(trim(title)) > 0),
  detail     text not null default '',
  level      text not null default 'info' check (level in ('info', 'warn', 'late')),
  /* ว่าง = ทุกบทบาท */
  roles      text[] not null default '{}',
  from_at    timestamptz not null default now(),
  until_at   timestamptz,
  created_by uuid references public.employees (id)
);

-- ─── ไฟล์แนบ ───────────────────────────────────────────────────────
/*
 * ตัวไฟล์อยู่ใน storage bucket · ตารางนี้เก็บว่าไฟล์ไหนของเอกสารใบไหน
 * owner_kind/owner_id ชี้ไปที่ใบลา ใบเบิก หรือแฟ้มพนักงาน
 */
create table public.attachments (
  id          uuid primary key default gen_random_uuid(),
  owner_kind  text not null check (owner_kind in ('leave', 'expense', 'employee', 'ot', 'payroll')),
  owner_id    uuid not null,
  /* ที่อยู่ไฟล์ใน bucket docs: <owner_kind>/<owner_id>/<ชื่อไฟล์> */
  path        text not null unique,
  name        text not null,
  size_bytes  int not null default 0 check (size_bytes >= 0),
  mime        text not null default '',
  uploaded_by uuid references public.employees (id),
  uploaded_at timestamptz not null default now()
);

create index att_owner_idx on public.attachments (owner_kind, owner_id);

/* bucket ส่วนตัว เปิดด้วย signed URL เหมือน avatars ของรอบแรก */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('docs', 'docs', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

-- ─── บันทึกประวัติเมื่อแก้ค่าตั้งค่า ───────────────────────────────
/*
 * ลงประวัติให้เองจากฐานข้อมูล ไม่ต้องหวังว่าหน้าจอจะจำลง
 * หน้าจอยังส่งคำอธิบายที่คนอ่านรู้เรื่องมาได้ผ่าน log_setting() แยกต่างหาก
 */
create function public.touch_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.version := coalesce(old.version, 0) + 1;
  new.updated_by := public.my_employee_id();
  insert into public.setting_log (by, area, detail, before, after)
  values (public.my_employee_id(), 'ตั้งค่าระบบ',
          'แก้ค่าตั้งค่าระบบ รุ่นที่ ' || new.version, old.data, new.data);
  return new;
end $$;

create trigger settings_touch before update on public.system_settings
  for each row execute function public.touch_settings();

/* ลงประวัติพร้อมคำอธิบายของหน้าจอ — หน้าจอรู้ว่าเปลี่ยนจากอะไรเป็นอะไร */
create function public.log_setting(p_area text, p_detail text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me   uuid := public.my_employee_id();
  v_name text;
begin
  select trim(coalesce(nick, first_name)) into v_name from public.employees where id = v_me;
  insert into public.setting_log (by, by_name, area, detail)
  values (v_me, coalesce(v_name, ''), p_area, p_detail);
end $$;

-- ─── RLS ───────────────────────────────────────────────────────────
alter table public.system_settings     enable row level security;
alter table public.holidays            enable row level security;
alter table public.setting_log         enable row level security;
alter table public.notification_reads  enable row level security;
alter table public.notify_settings     enable row level security;
alter table public.push_devices        enable row level security;
alter table public.announcements       enable row level security;
alter table public.attachments         enable row level security;

/* ค่าตั้งค่าและวันหยุด — ทุกคนอ่านได้เพราะทุกหน้าใช้ แก้ได้เฉพาะฝ่ายบุคคล */
create policy settings_read on public.system_settings for select to authenticated using (true);
create policy settings_write on public.system_settings for update to authenticated
  using (public.has_role('hr')) with check (public.has_role('hr'));

create policy holiday_read on public.holidays for select to authenticated using (true);
create policy holiday_write on public.holidays for all to authenticated
  using (public.has_role('hr')) with check (public.has_role('hr'));

/* ประวัติ — ฝ่ายบุคคลกับผู้บริหารอ่านได้ ไม่มีใครแก้หรือลบได้ แม้แต่ฝ่ายบุคคล */
create policy log_read on public.setting_log for select to authenticated
  using (public.has_role('hr') or public.has_role('ceo'));

/* สถานะอ่านแล้วและการตั้งค่าแจ้งเตือน — ของใครของมัน */
create policy reads_own on public.notification_reads for all to authenticated
  using (employee_id = public.my_employee_id())
  with check (employee_id = public.my_employee_id());

create policy notify_own on public.notify_settings for all to authenticated
  using (employee_id = public.my_employee_id())
  with check (employee_id = public.my_employee_id());

create policy device_own on public.push_devices for all to authenticated
  using (employee_id = public.my_employee_id())
  with check (employee_id = public.my_employee_id());

/* ประกาศ — คนทั่วไปเห็นเฉพาะที่ยังไม่หมดอายุและตรงบทบาทของตน
   ฝ่ายบุคคลเห็นทุกเรื่องรวมของที่หมดอายุแล้ว เพราะเป็นคนดูแลประกาศ
   (นโยบายจัดการด้านล่างเป็น for all จึงครอบ select ด้วย) */
create policy announce_read on public.announcements for select to authenticated
  using (
    (until_at is null or until_at > now())
    and (cardinality(roles) = 0 or roles && public.my_roles())
  );
create policy announce_write on public.announcements for all to authenticated
  using (public.has_role('hr')) with check (public.has_role('hr'));

/* ไฟล์แนบ — คนที่เห็นใบนั้นเห็นไฟล์ของใบนั้น */
create policy att_read on public.attachments for select to authenticated
  using (
    public.has_role('hr')
    or uploaded_by = public.my_employee_id()
    or (owner_kind = 'employee' and owner_id = public.my_employee_id())
    or (owner_kind = 'leave' and exists (
          select 1 from public.leave_requests r where r.id = owner_id))
    or (owner_kind = 'expense' and exists (
          select 1 from public.expense_claims c where c.id = owner_id))
  );
create policy att_insert on public.attachments for insert to authenticated
  with check (uploaded_by = public.my_employee_id());
create policy att_delete on public.attachments for delete to authenticated
  using (uploaded_by = public.my_employee_id() or public.has_role('hr'));

/* ไฟล์ใน bucket docs — โฟลเดอร์ที่สองคือรหัสเอกสาร ตรวจสิทธิ์ผ่านตาราง attachments */
create policy docs_read on storage.objects for select to authenticated
  using (bucket_id = 'docs' and exists (
    select 1 from public.attachments a where a.path = name));
create policy docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'docs');
create policy docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'docs' and exists (
    select 1 from public.attachments a
     where a.path = name and (a.uploaded_by = public.my_employee_id() or public.has_role('hr'))));

-- ─── สิทธิ์เรียกฟังก์ชัน ───────────────────────────────────────────
grant execute on function public.log_setting(text, text) to authenticated;
