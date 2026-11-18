-- ─── ใบที่ไม่มีอยู่แล้ว ไม่ต้องยิงซ้ำอีก ─────────────────────────
/*
 * คิวแจ้งเตือนยิงซ้ำจนครบห้าครั้งเมื่อปลายทางไม่ปิดงานให้
 * แต่ถ้า "ใบนั้นไม่มีอยู่แล้ว" (ถูกลบทิ้ง เช่นข้อมูลทดสอบ) ยิงอีกกี่ครั้งก็ไม่สำเร็จ
 * เสียเที่ยวเปล่าห้ารอบต่อหนึ่งใบ — เจอตอนล้างข้อมูลทดสอบ 18 พ.ย. 2569 (ค้าง 21 งาน)
 *
 * ให้ปลายทางสั่งปิดงานทั้งหมดของใบนั้นได้เมื่อหาใบไม่เจอ
 */
create or replace function public.push_drop(p_doc uuid)
returns void language sql security definer set search_path = '' as $$
  update public.push_outbox set done_at = now()
   where doc_id = p_doc and done_at is null;
$$;

revoke all on function public.push_drop(uuid) from public, anon, authenticated;
