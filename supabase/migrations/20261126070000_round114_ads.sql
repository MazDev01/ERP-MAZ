/* รอบที่ 114 — งานโฆษณา (ใบสั่งรัน และผลของชิ้นงาน)

   เดิมเก็บใน localStorage ของเครื่องที่กรอก (maz-erp.ads.v2)
   ใบสั่งรันคือ "ให้เอาเงินลูกค้าไปยิงโฆษณา" และผลคือตัวเลขที่ใช้รายงานลูกค้า
   สองอย่างนี้อยู่ในเครื่องใครเครื่องมันไม่ได้ (ผู้ใช้สั่ง 25 พ.ย. 2569)

   ทั้งสองตารางอ้างโปรเจคด้วย project_id · รอบเดือนเป็นข้อความ YYYY-MM
   ใบสั่งรันไม่มีรหัสของตัวเอง หน้าจออ้างด้วย รอบ + ช่องทาง + เครื่องมือ
   ชิ้นงานอ้างด้วย รอบ + ชื่อชิ้นงาน — ใส่คีย์ไม่ซ้ำตามนั้นให้ตรงกัน

   แผนสื่อ (AD_PLANS) ยังเป็นข้อมูลตั้งต้นในโค้ด หน้าจอแก้ไม่ได้ จึงยังไม่มีตาราง */

/* ─── ใบสั่งรันโฆษณา ──────────────────────────────────────────────
   สั่งแล้วสถานะเริ่มที่ "ยังไม่รัน" ต้องกลับมากดยืนยันเมื่อรันจริง
   เพราะวันที่สั่งกับวันที่เงินออกจริงไม่ใช่วันเดียวกัน
   ผู้สั่งและผู้ยืนยันเก็บไว้ทั้งคู่ ตรวจย้อนได้ว่าใครสั่งให้เงินลูกค้าออก (PM-BR-10) */
create table if not exists public.ad_runs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  /* รอบเดือน YYYY-MM */
  round       text not null check (round ~ '^\d{4}-\d{2}$'),
  /* รหัสพนักงานผู้ดูแลสื่อ และผู้ดูแลลูกค้า */
  media       text not null default '',
  ae          text not null default '',
  ordered_at  date,
  channel     text not null check (btrim(channel) <> ''),
  tool        text not null check (btrim(tool) <> ''),
  start_on    date,
  end_on      date,
  budget      numeric(14, 2) not null default 0 check (budget >= 0),
  ran         boolean not null default false,
  note        text not null default '',
  ordered_by  text not null default '',
  ran_by      text not null default '',
  ran_at      timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.employees (id) on delete set null,
  unique (project_id, round, channel, tool),
  constraint ad_runs_span check (end_on is null or start_on is null or end_on >= start_on)
);

create index if not exists ad_runs_proj_idx on public.ad_runs (project_id, round);

/* ─── ชิ้นงานโฆษณาและผลที่กรอก ────────────────────────────────────
   m ว่าง (null) = ยังไม่ได้กรอกผล · ตัวเลขทั้งชุดเก็บเป็น jsonb ก้อนเดียว
   ชุดเดียวกับที่หน้าจอใช้ (impression reach engagement reactions comments
   saves shares clicks spent) เพิ่มตัวใหม่ทีหลังไม่ต้องแก้ตาราง
   ผลโฆษณาคีย์มือ จึงบันทึกผู้กรอกและเวลาทุกครั้ง (PM-BR-10) */
create table if not exists public.ad_contents (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  round       text not null check (round ~ '^\d{4}-\d{2}$'),
  name        text not null check (btrim(name) <> ''),
  kind        text not null default 'Single' check (kind in ('Single', 'Album', 'VDO')),
  m           jsonb,
  by_name     text not null default '',
  at          timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.employees (id) on delete set null,
  unique (project_id, round, name)
);

create index if not exists ad_contents_proj_idx on public.ad_contents (project_id, round);

/* ─── สิทธิ์ ────────────────────────────────────────────────────────
   อ่าน: ฝ่ายโครงการ หัวหน้า ผู้บริหาร และบัญชี (ต้องกระทบยอดงบโฆษณากับบิล)
         ไม่เปิดให้พนักงานทั่วไปเหมือนตารางงานอื่นของ PM เพราะนี่คือเงินของลูกค้า
   เขียน: ฝ่ายโครงการ หัวหน้า ผู้บริหาร (can_edit_pm)
   ลบใบสั่งรันไม่ได้ — สั่งแล้วเงินลูกค้าออกไปแล้ว ประวัติต้องอยู่ */
create or replace function public.can_see_ads() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('pm') or public.has_role('gm')
      or public.has_role('ceo') or public.has_role('acc')
$$;

revoke all on function public.can_see_ads() from public, anon;
grant execute on function public.can_see_ads() to authenticated;
alter table public.ad_runs     enable row level security;
alter table public.ad_contents enable row level security;

revoke all on public.ad_runs     from public, anon;
revoke all on public.ad_contents from public, anon;
grant select, insert, update on public.ad_runs     to authenticated;
grant select, insert, update on public.ad_contents to authenticated;

drop policy if exists ad_runs_read      on public.ad_runs;
drop policy if exists ad_runs_write     on public.ad_runs;
drop policy if exists ad_runs_change    on public.ad_runs;
drop policy if exists ad_contents_read   on public.ad_contents;
drop policy if exists ad_contents_write  on public.ad_contents;
drop policy if exists ad_contents_change on public.ad_contents;

create policy ad_runs_read on public.ad_runs
  for select to authenticated using (public.can_see_ads());
create policy ad_runs_write on public.ad_runs
  for insert to authenticated with check (public.can_edit_pm());
create policy ad_runs_change on public.ad_runs
  for update to authenticated using (public.can_edit_pm()) with check (public.can_edit_pm());

create policy ad_contents_read on public.ad_contents
  for select to authenticated using (public.can_see_ads());
create policy ad_contents_write on public.ad_contents
  for insert to authenticated with check (public.can_edit_pm());
create policy ad_contents_change on public.ad_contents
  for update to authenticated using (public.can_edit_pm()) with check (public.can_edit_pm());

/* ─── ยืนยันว่ารันจริงแล้ว ────────────────────────────────────────
   กดได้ครั้งเดียว — ยืนยันซ้ำต้องไม่ทับชื่อผู้ยืนยันกับเวลาของครั้งแรก */
create or replace function public.ad_run_mark(p_run uuid, p_by text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if not public.can_edit_pm() then
    return jsonb_build_object('ok', false, 'reason', 'denied');
  end if;
  update public.ad_runs
     set ran = true, ran_by = coalesce(p_by, ''), ran_at = now()
   where id = p_run and ran = false
  returning true into v_ok;
  if v_ok is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found_or_done');
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.ad_run_mark(uuid, text) from public, anon;
grant execute on function public.ad_run_mark(uuid, text) to authenticated;
