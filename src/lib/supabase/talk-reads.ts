"use client";

import { signedIn, supabase } from "./client";

/*
 * อ่านข้อความถึงไหนแล้ว (รอบที่ 115)
 *
 * แถวเป็นของพนักงานที่ล็อกอิน นโยบายปล่อยให้เห็นเฉพาะของตัวเอง
 * ที่อ่านมาได้จึงเป็นของเราเสมอ — รูปร่างที่คืนไปเหมือนเดิม { who: { talk: จำนวน } }
 */

type Row = { who_key: string; talk_key: string; seen: number };

export async function fetchTalkReads(): Promise<Record<string, Record<string, number>>> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return {};
  const got = await sb.from("talk_reads").select("who_key, talk_key, seen");
  if (got.error || !got.data) return {};
  const out: Record<string, Record<string, number>> = {};
  for (const r of got.data as unknown as Row[]) {
    (out[r.who_key] ??= {})[r.talk_key] = r.seen;
  }
  return out;
}

export async function sbMarkRead(who: string, talk: string, seen: number) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  await sb
    .from("talk_reads")
    .upsert({ who_key: who, talk_key: talk, seen, at: new Date().toISOString() }, { onConflict: "emp_id,who_key,talk_key" });
}
