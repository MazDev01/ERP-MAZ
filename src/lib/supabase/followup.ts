"use client";

import { signedIn, supabase } from "./client";
import type { FCol, FMove, UserBoard } from "../followup-board";

/*
 * กระดานแผนติดตามของพนักงานขาย (รอบที่ 108)
 *
 * ฐานข้อมูลผูกแถวกับ customers.id แต่หน้าจอทั้งหมดอ้างรหัสผู้สนใจ (code)
 * ชั้นนี้จึงแปลง id ↔ code ให้ และจำคู่ไว้เพื่อไม่ต้องถามซ้ำทุกครั้งที่ย้ายการ์ด
 *
 * นโยบายปล่อยให้เห็นเฉพาะกระดานของตัวเอง — ที่อ่านมาได้จึงเป็นของคนที่ล็อกอินเสมอ
 */

/** "yyyy-mm-dd HH:mm" ตามเวลาไทย — รูปแบบเดียวกับที่สโตร์ใช้อยู่ */
function stampOf(at: string | null): string {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at.slice(0, 16).replace("T", " ");
  const th = new Date(d.getTime() + (420 + d.getTimezoneOffset()) * 60_000);
  return th.toISOString().slice(0, 16).replace("T", " ");
}

type ColRow = { id: string; name: string; cls: string; pos: number; created_at: string };
type CardRow = { customer_id: string; col_id: string | null; seen_at: string; customers: { code: string } | null };
type MoveRow = { customer_id: string; from_name: string; to_name: string; by_name: string; at: string; customers: { code: string } | null };

/** รหัสผู้สนใจ → id ในฐานข้อมูล · เติมตอนอ่านกระดาน และตอนถามเพิ่มรายที่ยังไม่รู้จัก */
const idByCode = new Map<string, string>();

export function rememberCustomerIds(pairs: Iterable<[string, string]>) {
  for (const [code, id] of pairs) idByCode.set(code, id);
}

/** id ของผู้สนใจรายนั้น — ไม่มีในที่จำไว้ก็ถามฐานข้อมูล (รับทั้งรหัสลูกค้าและรหัสผู้สนใจเดิม) */
async function customerIdOf(code: string): Promise<string | null> {
  const known = idByCode.get(code);
  if (known) return known;
  const sb = supabase();
  if (!sb) return null;
  const got = await sb.from("customers").select("id").or(`code.eq.${code},lead_code.eq.${code}`).maybeSingle();
  const id = (got.data as { id?: string } | null)?.id ?? null;
  if (id) idByCode.set(code, id);
  return id;
}

export async function fetchBoard(): Promise<UserBoard> {
  const empty: UserBoard = { cols: [], place: {}, seen: {}, history: {} };
  const sb = supabase();
  if (!sb || !(await signedIn())) return empty;

  const [cols, cards, moves] = await Promise.all([
    sb.from("followup_cols").select("id, name, cls, pos, created_at").order("pos").order("created_at"),
    sb.from("followup_cards").select("customer_id, col_id, seen_at, customers(code)"),
    sb.from("followup_moves").select("customer_id, from_name, to_name, by_name, at, customers(code)").order("at"),
  ]);
  if (cols.error || cards.error || moves.error) return empty;

  const out: UserBoard = {
    cols: ((cols.data ?? []) as unknown as ColRow[]).map<FCol>((c) => ({ id: c.id, name: c.name, cls: c.cls })),
    place: {},
    seen: {},
    history: {},
  };
  for (const r of (cards.data ?? []) as unknown as CardRow[]) {
    const code = r.customers?.code;
    if (!code) continue;
    idByCode.set(code, r.customer_id);
    if (r.col_id) out.place[code] = r.col_id;
    out.seen[code] = stampOf(r.seen_at);
  }
  for (const r of (moves.data ?? []) as unknown as MoveRow[]) {
    const code = r.customers?.code;
    if (!code) continue;
    idByCode.set(code, r.customer_id);
    const m: FMove = { from: r.from_name, to: r.to_name, at: stampOf(r.at), by: r.by_name };
    out.history[code] = [...(out.history[code] ?? []), m];
  }
  return out;
}

export async function sbAddCol(c: { name: string; cls: string }, pos: number) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  await sb.from("followup_cols").insert({ name: c.name, cls: c.cls, pos });
}

export async function sbUpdateCol(id: string, patch: { name?: string; cls?: string }) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  await sb.from("followup_cols").update(patch).eq("id", id);
}

/** เรียงคอลัมน์ใหม่ทั้งแถว — pos = ลำดับซ้ายไปขวา (เลื่อนคอลัมน์ก็เรียกตัวนี้) */
export async function sbOrderCols(ids: string[]) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  await Promise.all(ids.map((id, i) => sb.from("followup_cols").update({ pos: i }).eq("id", id)));
}

export async function sbDropCol(id: string, by: string) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  await sb.rpc("followup_drop_col", { p_col: id, p_by: by });
}

export async function sbMoveCard(code: string, colId: string | null, by: string) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  const id = await customerIdOf(code);
  if (!id) return;
  await sb.rpc("followup_move", { p_customer: id, p_to: colId, p_by: by });
}

/** จดวันที่การ์ดโผล่บนกระดานครั้งแรก — การ์ดที่มีแถวแล้วไม่แตะ */
export async function sbMarkSeen(codes: string[]) {
  const sb = supabase();
  if (!sb || !(await signedIn()) || !codes.length) return;
  const rows: { customer_id: string }[] = [];
  for (const code of codes) {
    const id = await customerIdOf(code);
    if (id) rows.push({ customer_id: id });
  }
  if (!rows.length) return;
  await sb.from("followup_cards").upsert(rows, { onConflict: "emp_id,customer_id", ignoreDuplicates: true });
}
