/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 128 · ลิงก์ตรวจงานใส่รหัสผ่านได้ (Requirement รอบ 9)

   ลิงก์ที่หลุดออกไปไม่ควรเปิดดูงานของลูกค้าได้ทันที
   ฝ่ายโครงการตั้งรหัสตอนส่งรอบตรวจ (ไม่ตั้งก็ได้ ใช้ตัวลิงก์เป็นกุญแจเหมือนเดิม)
   เก็บเป็นลายนิ้วมือ (sha256 + เกลือของรอบ) ไม่เก็บตัวรหัส
   ═══════════════════════════════════════════════════════════════════ */

alter table public.review_rounds
  add column if not exists pass_hash text;

comment on column public.review_rounds.pass_hash is 'ลายนิ้วมือรหัสผ่านของลิงก์ · ว่าง = ไม่ต้องใส่รหัส';

/** ลายนิ้วมือของรหัส — ผูกกับโทเคนของรอบ รหัสเดียวกันต่างรอบจึงได้ค่าต่างกัน */
create or replace function public.review_pass_hash(p_token text, p_pass text)
  returns text
language sql immutable security definer set search_path = ''
as $$
  select case when coalesce(btrim(p_pass), '') = '' then null
              else encode(extensions.digest(p_token || ':' || btrim(p_pass), 'sha256'), 'hex') end
$$;

/** ตั้งหรือล้างรหัสของรอบ — ฝ่ายโครงการเท่านั้น */
create or replace function public.review_set_pass(p_token text, p_pass text)
  returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not public.can_edit_pm() then
    return jsonb_build_object('ok', false, 'reason', 'denied');
  end if;
  update public.review_rounds
     set pass_hash = public.review_pass_hash(p_token, p_pass)
   where token = p_token;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n > 0, 'locked', coalesce(btrim(p_pass), '') <> '');
end $$;

grant execute on function public.review_pass_hash(text, text) to authenticated;
grant execute on function public.review_set_pass(text, text) to authenticated;

/* ── ฝั่งลูกค้า: ต้องใส่รหัสก่อนถึงจะได้ข้อมูลของรอบ ────────────────
   รอบที่ไม่ตั้งรหัสทำงานเหมือนเดิมทุกอย่าง (รหัสที่ส่งมาถูกมองข้าม) */
drop function if exists public.review_open(text);
create or replace function public.review_open(p_token text, p_pass text default '')
  returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_r    record;
  v_over boolean;
begin
  select * into v_r from public.review_rounds where token = p_token;
  if v_r.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  /* มีรหัสแต่ยังไม่ใส่ หรือใส่ผิด — บอกแค่ว่าต้องใส่รหัส ไม่บอกอะไรของงานเลย */
  if v_r.pass_hash is not null
     and v_r.pass_hash is distinct from public.review_pass_hash(p_token, p_pass) then
    return jsonb_build_object('ok', false, 'reason', 'need_pass',
                              'wrong', coalesce(btrim(p_pass), '') <> '');
  end if;

  v_over := (now() at time zone 'Asia/Bangkok')::date > v_r.expires_at;

  return jsonb_build_object(
    'ok', true,
    'round', jsonb_build_object(
      'token', v_r.token,
      'taskName', v_r.task_name,
      'round', v_r.round,
      'createdBy', v_r.created_by,
      'createdAt', v_r.created_at,
      'expiresAt', v_r.expires_at,
      'message', v_r.message,
      'contact', v_r.contact,
      'project', v_r.project,
      'status', v_r.status,
      'submittedAt', v_r.submitted_at,
      'locked', v_r.pass_hash is not null,
      'expired', v_over),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'name', f.name, 'kind', f.kind, 'size', f.size_text,
               'url', case when v_over then null else f.url end,
               'path', case when v_over then null else f.path end,
               'poster', case when v_over then null else f.poster end,
               'duration', f.duration,
               'approved', f.approved,
               'nameOnly', f.name_only or v_over) order by f.idx)
        from public.review_files f where f.round_id = v_r.id), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'fileId', c.file_id, 'author', c.author, 'text', c.tx,
               'at', c.at, 't', c.t, 'frame', c.frame, 'pin', c.pin,
               'page', c.page, 'attach', c.attach, 'done', c.done) order by c.at)
        from public.review_comments c where c.round_id = v_r.id), '[]'::jsonb));
end $$;

grant execute on function public.review_open(text, text) to anon, authenticated;

/* ── การเขียนของลูกค้า (คอมเมนต์ อนุมัติไฟล์ ส่งผล) ต้องผ่านรหัสเดียวกัน ──
   review_live เป็นประตูของทุกฟังก์ชันฝั่งลูกค้าอยู่แล้ว เพิ่มรหัสที่ประตูนี้
   ของเดิมเรียกแบบไม่ส่งรหัส ยังใช้ได้กับรอบที่ไม่ตั้งรหัส */
drop function if exists public.review_live(text);
create or replace function public.review_live(p_token text, p_pass text default '')
  returns uuid
language sql stable security definer set search_path = ''
as $$
  select r.id from public.review_rounds r
   where r.token = p_token
     and r.status = 'open'
     and (now() at time zone 'Asia/Bangkok')::date <= r.expires_at
     and (r.pass_hash is null
          or r.pass_hash = public.review_pass_hash(p_token, p_pass))
$$;

grant execute on function public.review_live(text, text) to anon, authenticated;

/* ของเดิมต้องทิ้งก่อน ไม่งั้นมีสองชุดพร้อมกันแล้วเรียกแบบเดิมจะกำกวม */
drop function if exists public.review_comment_add(text, uuid, text, text, integer, text, jsonb, integer, jsonb);
drop function if exists public.review_comment_del(text, uuid);
drop function if exists public.review_comment_edit(text, uuid, text);
drop function if exists public.review_file_approve(text, uuid, boolean);

/* ── ฟังก์ชันเขียนของลูกค้า — รับรหัสผ่านไปที่ประตูเดียวกัน ─────────
   ยกมาจากของเดิมทั้งก้อน เติมพารามิเตอร์ท้ายสุด ของเดิมที่เรียกแบบไม่ส่งรหัส
   ยังใช้ได้กับรอบที่ไม่ได้ตั้งรหัส */
create or replace function public.review_comment_add(p_token text, p_file uuid, p_author text, p_text text, p_t integer DEFAULT NULL::integer, p_frame text DEFAULT NULL::text, p_pin jsonb DEFAULT NULL::jsonb, p_page integer DEFAULT NULL::integer, p_attach jsonb DEFAULT NULL::jsonb, p_pass text DEFAULT '')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_round uuid := public.review_live(p_token, p_pass);
  v_id    uuid;
begin
  if v_round is null then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if not exists (select 1 from public.review_files f where f.id = p_file and f.round_id = v_round) then
    return jsonb_build_object('ok', false, 'reason', 'file_not_found');
  end if;
  if btrim(coalesce(p_text, '')) = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  insert into public.review_comments (round_id, file_id, author, tx, t, frame, pin, page, attach)
  values (v_round, p_file, coalesce(p_author, ''), btrim(p_text), p_t, p_frame, p_pin, p_page, p_attach)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $function$;

create or replace function public.review_comment_del(p_token text, p_id uuid, p_pass text DEFAULT '')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_round uuid := public.review_live(p_token, p_pass);
begin
  if v_round is null then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  delete from public.review_comments where id = p_id and round_id = v_round;
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.review_comment_edit(p_token text, p_id uuid, p_text text, p_pass text DEFAULT '')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_round uuid := public.review_live(p_token, p_pass);
begin
  if v_round is null then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if btrim(coalesce(p_text, '')) = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;
  /* ปักธงบอกทริกเกอร์ว่าเป็นลูกค้าแก้ข้อความของตัวเอง (ธงอยู่แค่ในธุรกรรมนี้) */
  perform set_config('maz.review_client', 'on', true);
  update public.review_comments set tx = btrim(p_text)
   where id = p_id and round_id = v_round;
  /* เก็บธงทันทีหลังใช้ จะได้ไม่ค้างไปถึงคำสั่งอื่นในธุรกรรมเดียวกัน */
  perform set_config('maz.review_client', '', true);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.review_file_approve(p_token text, p_file uuid, p_ok boolean, p_pass text DEFAULT '')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_round uuid := public.review_live(p_token, p_pass);
begin
  if v_round is null then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  update public.review_files set approved = coalesce(p_ok, false)
   where id = p_file and round_id = v_round;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end $function$;

/* review_submit มีพารามิเตอร์ของตัวเองอยู่แล้ว เติมรหัสผ่านต่อท้าย */
drop function if exists public.review_submit(text, boolean);
create or replace function public.review_submit(p_token text, p_all boolean default false, p_pass text default '')
  returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round    uuid := public.review_live(p_token, p_pass);
  v_comments int;
  v_left     int;
  v_status   text;
  v_r        record;
  v_task     int := 0;
begin
  if v_round is null then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  if p_all then
    update public.review_files set approved = true where round_id = v_round;
  end if;

  select count(*) into v_comments from public.review_comments where round_id = v_round;
  select count(*) into v_left from public.review_files where round_id = v_round and approved = false;
  v_status := case when v_left = 0 and (p_all or v_comments = 0) then 'approved' else 'submitted' end;

  update public.review_rounds
     set status = v_status, submitted_at = now()
   where id = v_round
  returning * into v_r;

  /* ผลตรวจของลูกค้าขยับใบงานเอง (รอบที่ 124) */
  update public.project_tasks t
     set status  = case when v_status = 'approved' then 'done' else 'revise' end,
         pct     = case when v_status = 'approved' then 100 else t.pct end,
         done_at = case when v_status = 'approved' then now() else t.done_at end,
         back    = case when v_status = 'approved' then null
                        else jsonb_build_object('why', 'ลูกค้าขอแก้ ' || v_comments || ' จุด',
                                                'at', to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI'),
                                                'by', 'ลูกค้า') end
   where t.project_id = v_r.project_id
     and t.name = v_r.task_name
     and t.status = 'wait';
  get diagnostics v_task = row_count;

  if v_task > 0 then
    insert into public.project_acts (project_id, kind, who, at, tx)
    values (v_r.project_id,
            case when v_status = 'approved' then 'done' else 'status' end,
            'ลูกค้า', now(),
            case when v_status = 'approved'
                 then 'ลูกค้าอนุมัติ ' || v_r.task_name || ' รอบที่ ' || v_r.round
                 else 'ลูกค้าขอแก้ ' || v_r.task_name || ' รอบที่ ' || v_r.round end);
  end if;

  return jsonb_build_object('ok', true, 'status', v_status, 'comments', v_comments, 'task', v_task);
end $$;

do $$
declare
  v_f record;
begin
  for v_f in
    select p.oid::regprocedure::text sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('review_comment_add', 'review_comment_del', 'review_comment_edit',
                         'review_file_approve', 'review_submit')
  loop
    execute format('grant execute on function %s to anon, authenticated', v_f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
