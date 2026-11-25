/* รอบที่ 103 — หลังบ้านฝ่ายโครงการ ชุดที่สอง (SRS 1.5 M4)
   งานเข้าใหม่ · ร่างแผนงาน · ข้อความของงานย่อย

   สามกองนี้ของเดิมอยู่ในเบราว์เซอร์ทั้งหมด และมีข้อความกำกับไว้ในโค้ดเองว่าผิดกติกา
   "TODO: ระบบจริงต้องเก็บร่างไว้ที่เซิร์ฟเวอร์ ไม่ใช่ในเบราว์เซอร์
    ผลคือเปิดจากอีกเครื่องหรืออีกคนจะไม่เห็นร่างนี้" (pm-store.ts)
   รอบนี้ย้ายขึ้นฐานข้อมูลให้ครบ */

-- ─── งานเข้าใหม่ ───────────────────────────────────────────────────
/*
 * งานที่เข้ามารอผู้จัดการโครงการรับ — เกิดตอนลูกค้าจ่ายงวดแรก (ฝั่งบัญชีออกใบเสร็จงวดที่ 1)
 * เลขที่โปรเจคออกตั้งแต่ตอนนี้ แล้วใช้เลขเดิมต่อไปจนจบงาน
 * รับงานแล้วแถวนี้ยังอยู่ (stage = plan) เพราะหน้าวางแผนยังต้องอ่านข้อเสนอกับเฟสจากตรงนี้
 */
create table if not exists public.project_inbox (
  id            uuid primary key default gen_random_uuid(),
  pj            text not null unique,
  invoice_id    uuid references public.invoices (id) on delete set null,
  deal_id       uuid references public.deals (id) on delete set null,
  service       text not null default '',
  cus           text not null default '',
  customer_id   uuid references public.customers (id) on delete set null,
  quo           text not null default '',
  quo_date      date,
  net           numeric not null default 0,
  /* จำนวนงวดตามเงื่อนไขชำระเงิน */
  seqs          int not null default 1 check (seqs >= 1),
  paid_at       date,
  sent_at       date,
  scope         text not null default '',
  items         jsonb not null default '[]'::jsonb,
  due           date,
  stage         text not null default 'new' check (stage in ('new', 'plan')),
  plan_start    date,
  plan_end      date,
  duration_days int not null default 0,
  /* งานที่มีข้อเสนอ = งานโปรเจค ต้องวางแผนและมอบหมายทีม
     งานที่ไม่มี = งานเดี่ยว ลูกค้าสั่งตรงจบในตัว ไม่ต้องเปิดโปรเจค */
  phases        jsonb not null default '[]'::jsonb,
  proposal      jsonb,
  /* งานเดี่ยวจับคนและกำหนดวันส่งตั้งแต่ตอนรับงาน */
  assign_whos   text[] not null default '{}',
  assign_due    date,
  /* ผู้จัดการโครงการเปิดดูเอกสารแล้วหรือยัง — ยังไม่เปิดขึ้นจุดแดงหน้าแถว */
  seen          boolean not null default false,
  project_start date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists project_inbox_stage_idx on public.project_inbox (stage);

-- ─── ร่างแผนงาน ────────────────────────────────────────────────────
/*
 * ร่างที่ยังไม่ยืนยัน หนึ่งโปรเจคหนึ่งร่าง — บันทึกตั้งแต่ตอนแก้ ไม่มีปุ่มบันทึก
 * อยู่ที่ฐานข้อมูลแล้ว เปิดจากอีกเครื่องหรือคนอื่นมาดูต่อก็เห็นร่างเดียวกัน
 */
create table if not exists public.project_drafts (
  pj         text primary key,
  phases     jsonb not null default '[]'::jsonb,
  plan       jsonb not null default '[]'::jsonb,
  at         timestamptz not null default now(),
  by_name    text not null default '',
  by_id      uuid references public.employees (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ─── ข้อความของงานย่อย ─────────────────────────────────────────────
/*
 * ข้อความที่ผูกกับงานย่อยใบเดียว คนละอันกับแชทโปรเจค
 * แชทโปรเจคอยู่ในหน้าของผู้จัดการโครงการ ซึ่งทีมงานเปิดไม่ได้ตามกติกาเมนูตามบทบาท
 * สายนี้ผูกกับงานใบนั้น ผู้รับงานจึงเห็นในหน้างานของตัวเองได้
 */
create table if not exists public.task_talks (
  id         uuid primary key default gen_random_uuid(),
  pj         text not null,
  task_name  text not null,
  /* "PM" หรือรหัสพนักงานของผู้รับงาน */
  who        text not null default '',
  at         timestamptz not null default now(),
  tx         text not null default '',
  /* ข้อความนี้คือการทวงงาน ผู้รับงานต้องเห็นเป็นเรื่องที่ต้องตอบ */
  nudge      boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists task_talks_key_idx on public.task_talks (pj, task_name, at);

-- ─── ด่านและเลขที่ ─────────────────────────────────────────────────
create or replace function public.stamp_inbox_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.pj is null or new.pj = '' then new.pj := public.next_sales_no('project', 'PJ'); end if;
  return new;
end $$;

drop trigger if exists project_inbox_no    on public.project_inbox;
drop trigger if exists project_inbox_touch on public.project_inbox;
drop trigger if exists project_drafts_touch on public.project_drafts;

create trigger project_inbox_no    before insert on public.project_inbox
  for each row execute function public.stamp_inbox_no();
create trigger project_inbox_touch before update on public.project_inbox
  for each row execute function public.touch_updated_at();
create trigger project_drafts_touch before update on public.project_drafts
  for each row execute function public.touch_updated_at();

-- ─── สิทธิ์เข้าถึง ──────────────────────────────────────────────────
/*
 * งานเข้าใหม่กับร่างแผน เป็นงานของผู้จัดการโครงการและหัวหน้า
 * ส่วนข้อความของงานย่อย ทุกคนที่เห็นโปรเจคพิมพ์ได้ เพราะผู้รับงานต้องตอบกลับได้
 */
do $$
declare t text;
begin
  foreach t in array array['project_inbox', 'project_drafts', 'task_talks']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_see_pm())',
                   t || '_read', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['project_inbox', 'project_drafts']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_change', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_edit_pm())',
                   t || '_write', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_edit_pm()) with check (public.can_edit_pm())',
                   t || '_change', t);
  end loop;
end $$;

drop policy if exists task_talks_write  on public.task_talks;
drop policy if exists task_talks_change on public.task_talks;
create policy task_talks_write on public.task_talks
  for insert to authenticated with check (public.can_see_pm());
create policy task_talks_change on public.task_talks
  for update to authenticated
  using (public.can_edit_pm()) with check (public.can_edit_pm());

/* ร่างแผนทิ้งได้เมื่อยืนยันแผนแล้ว — ไม่ใช่เอกสาร ไม่ต้องเก็บไว้ */
grant delete on public.project_drafts to authenticated;
drop policy if exists project_drafts_delete on public.project_drafts;
create policy project_drafts_delete on public.project_drafts
  for delete to authenticated using (public.can_edit_pm());

/* งานเข้าใหม่ที่ดีลถูกยกเลิก ต้องเอาออกจากกล่องได้ (cancelDealWork) */
grant delete on public.project_inbox to authenticated;
drop policy if exists project_inbox_delete on public.project_inbox;
create policy project_inbox_delete on public.project_inbox
  for delete to authenticated using (public.can_edit_pm());
