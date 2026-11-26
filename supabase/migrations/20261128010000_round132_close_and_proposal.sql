/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 132 · กติกาปิดงาน และ Proposal เฉพาะงานของ BD
   (คำตอบเจ้าของ 25 พ.ย. 2569)

   1 "ปิดงาน: PM เป็นคนกดปิด · งาน DM ปิดเมื่อยิงแอดครบทุกตัว"
     ของเดิมระบบปิดโปรเจคให้เองเมื่องานย่อยครบ งาน DM จึงปิดได้ทั้งที่ยังไม่ยิงแอด
     ตอนนี้งาน DM ที่ยังมีแอดค้าง ปิดไม่ได้ ไม่ว่าจะปิดจากหน้าจอหรือจากระบบ

   2 "Proposal ทำเฉพาะงานของ BD บริการอื่นออกใบเสนอราคาได้เลย"
     คำขอก่อนการขายมีสองชนิดอยู่แล้ว (BD / SA) — ส่งข้อเสนอได้เฉพาะคำขอของ BD
   ═══════════════════════════════════════════════════════════════════ */

/* ── 1 ปิดงาน DM ได้เมื่อยิงแอดครบ ─────────────────────────────────
   "ครบ" = มีรายการยิงแอดอยู่จริง และทุกรายการถูกทำเครื่องหมายว่ายิงแล้ว */
create or replace function public.project_close_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_runs int;
  v_left int;
begin
  if new.status <> 'done' or old.status = 'done' then
    return new;
  end if;
  if coalesce(new.service, '') <> 'dm' then
    return new;
  end if;

  select count(*), count(*) filter (where not coalesce(ran, false))
    into v_runs, v_left
    from public.ad_runs where project_id = new.id;

  if v_runs = 0 then
    raise exception 'งานโฆษณายังไม่มีรายการยิงแอด ปิดงานไม่ได้'
      using errcode = 'check_violation';
  end if;
  if v_left > 0 then
    raise exception 'ยังมีแอดที่ยังไม่ได้ยิงอีก % รายการ ปิดงานไม่ได้', v_left
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists projects_close_guard on public.projects;
create trigger projects_close_guard before update of status on public.projects
  for each row execute function public.project_close_guard();

/** งาน DM นี้ปิดได้หรือยัง — หน้าจอใช้ซ่อน/บอกเหตุผลก่อนกด */
create or replace function public.project_closable(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_p    record;
  v_runs int;
  v_left int;
begin
  select * into v_p from public.projects where id = p_project;
  if v_p.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if coalesce(v_p.service, '') <> 'dm' then
    return jsonb_build_object('ok', true);
  end if;
  select count(*), count(*) filter (where not coalesce(ran, false))
    into v_runs, v_left
    from public.ad_runs where project_id = p_project;
  if v_runs = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_runs');
  end if;
  if v_left > 0 then
    return jsonb_build_object('ok', false, 'reason', 'ads_left', 'left', v_left);
  end if;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.project_closable(uuid) to authenticated;

/* ── 2 ส่งข้อเสนอได้เฉพาะคำขอของ BD ───────────────────────────────
   คำขอ SA เป็นการสรุปขอบเขตทางเทคนิค ออกใบเสนอราคาได้เลย ไม่ต้องทำ Proposal */
create or replace function public.proposal_bd_only() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text;
begin
  select kind into v_kind from public.presales_requests where id = new.request_id;
  if coalesce(v_kind, '') <> 'BD' then
    raise exception 'ส่งข้อเสนอได้เฉพาะคำขอของ BD — คำขอ % ออกใบเสนอราคาได้เลย', coalesce(v_kind, '(ไม่ทราบชนิด)')
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists presales_rounds_bd_only on public.presales_rounds;
create trigger presales_rounds_bd_only before insert on public.presales_rounds
  for each row execute function public.proposal_bd_only();

notify pgrst, 'reload schema';
