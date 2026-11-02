"use client";

import { useMemo } from "react";

import {
  EXPENSE_CLAIMS,
  type ExpenseClaim,
  type FuelRow,
  type OtherRow,
} from "./expense-data";
import { checkClaim, isLocked } from "./expense-data";
import { bkkNow, nextDocNo, pad2 } from "./format";
import { ROLES, type Role } from "./role";
import { empRequestIds } from "./emp-requests";
import { HR_REIMB } from "./hr-data";
import { createRoleStore } from "./role-store";
import {
  CLAIM_REASON,
  decideClaim,
  fetchClaims,
  fileClaim,
  undoClaim,
  withdrawClaimRemote,
} from "./supabase/expense";

/* ใบเบิกของผู้ที่ล็อกอินอยู่ — แยกเก็บตามบทบาท เพราะหนึ่งบทบาทคือหนึ่งคน
   v4 — ใบตั้งต้นที่ยื่นแล้วมีเลขที่เอกสารครบทุกใบ (23 ก.ย. 2569) ของเดิมในเครื่องบางใบไม่มีเลข
   จึงขึ้นรุ่นใหม่ให้อ่านชุดตั้งต้นที่มีเลขแทน ไม่งั้นรายละเอียดเงินเดือนจะขึ้นเลขที่เป็น "—"

   ต่อฐานข้อมูลแล้วอ่านใบที่ "ยื่นแล้ว" จากตาราง expense_claims แทน */
const store = createRoleStore<ExpenseClaim[]>(
  "maz-erp.expense.v4",
  EXPENSE_CLAIMS,
  (v): v is ExpenseClaim[] => Array.isArray(v),
  /* ค่าคอมย้ายไปคิดในเงินเดือนแล้ว (ERD) — ใบที่ยังไม่ตัดสินต้องไม่มีรายการค่าคอมค้าง
     ไม่งั้นยอดเบิกจะรวมค่าคอมที่มองไม่เห็นบนหน้าจอ · ใบที่อนุมัติไปแล้วเก็บไว้เป็นประวัติ */
  (claims) =>
    claims.map((c) =>
      (c.status === "ร่าง" || c.status === "รออนุมัติ") && c.income.length ? { ...c, income: [] } : c,
    ),
  { fetch: fetchClaims, empty: [] },
);

/*
 * ใบร่างยังอยู่ในเครื่อง — ตั้งใจให้เป็นอย่างนั้น
 *
 * ใบเบิกกรอกทีละตัวอักษร (ทะเบียนรถ ระยะทาง รายละเอียด) ถ้าเขียนขึ้นฐานข้อมูล
 * ทุกครั้งที่พิมพ์ จะยิงคำขอเป็นร้อยครั้งต่อหนึ่งใบ กดยื่นทีเดียวจึงส่งทั้งใบขึ้นไป
 * (file_claim ในหลังบ้านรอบที่ 8) — คนละก้อนกับชุดตั้งต้นจำลองของ v4
 * ไม่งั้นใบจำลองจะโผล่มาปนกับใบจริงในฐานข้อมูล
 */
const DRAFT_SEED = Object.fromEntries(
  ROLES.map((r) => [r.key, [] as ExpenseClaim[]]),
) as Record<Role, ExpenseClaim[]>;

const drafts = createRoleStore<ExpenseClaim[]>(
  "maz-erp.expense.draft.v1",
  DRAFT_SEED,
  (v): v is ExpenseClaim[] => Array.isArray(v),
);

/** ต่อฐานข้อมูลแล้วการเขียนพลาดได้จริง หน้าจอต้องได้รู้ว่าพลาดเพราะอะไร */
export type ClaimWriteResult = { ok: true } | { ok: false; message: string };

function say(reason: string, extra?: { paidIn?: string }) {
  const base = CLAIM_REASON[reason] ?? "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง";
  if (reason === "already_paid" && extra?.paidIn) return `${base} — รอบ ${extra.paidIn}`;
  return base;
}

/*
 * รวมใบที่ยื่นแล้วจากฐานข้อมูลกับใบร่างในเครื่อง
 * ใบที่ยื่นแล้ว/อนุมัติแล้วถือของฐานข้อมูลเป็นหลัก — ร่างในเครื่องที่ค้างอยู่ห้ามมาทับ
 * ส่วนเดือนที่ใบถูกตีกลับ ร่างที่กำลังแก้อยู่ในเครื่องใหม่กว่า จึงให้ร่างชนะ
 */
function merge(remote: ExpenseClaim[], local: ExpenseClaim[]): ExpenseClaim[] {
  const keepRemote = remote.filter(
    (c) => isLocked(c.status) || !local.some((d) => d.month === c.month),
  );
  const keepLocal = local.filter((d) => !keepRemote.some((c) => c.month === d.month));
  return [...keepLocal, ...keepRemote];
}

export function useExpenseClaims() {
  const sent = store.use();
  const mine = drafts.use();
  return useMemo(() => (store.live ? merge(sent, mine) : sent), [sent, mine]);
}

/** ใบของฉันทั้งหมดนอก React (ร่างในเครื่อง + ใบที่ยื่นแล้ว) */
function myClaims(): ExpenseClaim[] {
  return store.live ? merge(store.current(), drafts.current()) : store.current();
}

export function monthKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** ใบเบิกของเดือนนั้น ถ้ายังไม่มีให้ถือเป็นใบร่างเปล่า จะได้กรอกได้เลย */
export function claimOf(claims: ExpenseClaim[], month: string): ExpenseClaim {
  return (
    claims.find((c) => c.month === month) ?? {
      month,
      status: "ร่าง",
      plate: "",
      nickname: "",
      fuel: [],
      income: [],
      comment: "",
      submittedAt: "",
    }
  );
}

function stampNow() {
  const d = bkkNow();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function newId(prefix: string) {
  return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

/** แก้ใบของเดือนนั้น ถ้ายังไม่มีในสโตร์ก็สร้างให้ */
/*
 * แก้ใบเบิกของเดือนนั้น
 *
 * ใบที่ยื่นไปแล้ว (รออนุมัติ / อนุมัติแล้ว) แก้ไม่ได้ กันไว้ที่นี่ ไม่ใช่เชื่อหน้าจออย่างเดียว
 * (กติกาเดียวกับ submitClaim — "กันที่ชั้นสโตร์" เจ้าของสั่ง 24 ก.ย. 2569)
 * ถ้าแก้ได้หลังยื่น ตัวเลขที่ผู้อนุมัติเห็นกับตัวเลขที่เจ้าตัวแก้จะคนละชุดกัน
 * allowLocked มีไว้ให้การเปลี่ยนสถานะที่ตั้งใจ เช่นดึงใบกลับมาแก้ (withdrawClaim)
 *
 * ต่อฐานข้อมูลแล้วเขียนลงใบร่างในเครื่อง — ใบที่ถูกตีกลับจึงต้องลอกของจากฐานข้อมูล
 * มาเป็นร่างตั้งต้นก่อน ไม่งั้นแก้ใบที่ถูกตีกลับจะได้ใบเปล่า
 */
function edit(
  month: string,
  patch: (c: ExpenseClaim) => ExpenseClaim,
  allowLocked = false,
) {
  if (store.live) {
    const now = myClaims().find((c) => c.month === month);
    if (now && !allowLocked && isLocked(now.status)) return;
    drafts.update((ds) => {
      const base = ds.find((c) => c.month === month) ?? now ?? claimOf([], month);
      const draft = patch({ ...base, status: "ร่าง", submittedAt: "" });
      return ds.some((c) => c.month === month)
        ? ds.map((c) => (c.month === month ? draft : c))
        : [draft, ...ds];
    });
    return;
  }
  store.update((claims) => {
    const found = claims.some((c) => c.month === month);
    if (!found) return [patch(claimOf(claims, month)), ...claims];
    return claims.map((c) =>
      c.month === month && (allowLocked || !isLocked(c.status)) ? patch(c) : c,
    );
  });
}

/** ลบใบร่างของเดือนนั้นทิ้ง — เรียกหลังยื่นสำเร็จ ของจริงอยู่ในฐานข้อมูลแล้ว */
function dropDraft(month: string) {
  drafts.update((ds) => ds.filter((c) => c.month !== month));
}

export function setClaimField(
  month: string,
  field: "plate" | "nickname",
  value: string,
) {
  edit(month, (c) => ({ ...c, [field]: value }));
}

/** init = ค่าตั้งต้นของแถว (ใช้ตอนเริ่มกรอกแถวว่างที่หน้าจอเติมให้ในเดือนที่ยังไม่มีรายการ) */
export function addFuelRow(month: string, init: Partial<FuelRow> = {}) {
  edit(month, (c) => ({
    ...c,
    fuel: [...c.fuel, { id: newId("F"), date: "", place: "", km: "", work: "", note: "", ...init }],
  }));
}

export function updateFuelRow(
  month: string,
  id: string,
  patch: Partial<Omit<FuelRow, "id">>,
) {
  edit(month, (c) => ({
    ...c,
    fuel: c.fuel.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  }));
}

export function removeFuelRow(month: string, id: string) {
  edit(month, (c) => ({ ...c, fuel: c.fuel.filter((r) => r.id !== id) }));
}

/* ค่าใช้จ่ายอื่นนอกจากค่าน้ำมัน — ประเภท วันที่ จำนวนเงิน รายละเอียด และหลักฐาน */
export function addOtherRow(month: string, init: Partial<OtherRow> = {}) {
  edit(month, (c) => ({
    ...c,
    other: [...(c.other ?? []), { id: newId("O"), kind: "", date: "", amount: "", note: "", ...init }],
  }));
}

export function updateOtherRow(month: string, id: string, patch: Partial<Omit<OtherRow, "id">>) {
  edit(month, (c) => ({
    ...c,
    other: (c.other ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
  }));
}

export function removeOtherRow(month: string, id: string) {
  edit(month, (c) => ({ ...c, other: (c.other ?? []).filter((r) => r.id !== id) }));
}

/** ส่งขออนุมัติ — ล็อกใบไว้ไม่ให้แก้ต่อ และบันทึกเวลาที่ยื่น */
/**
 * ยื่นใบเบิก — บอกเหตุถ้ายื่นไม่ได้ โดยไม่เปลี่ยนสถานะใบ
 *
 * ตรวจซ้ำที่นี่ ไม่ใช่เชื่อหน้าจออย่างเดียว (เจ้าของสั่ง 24 ก.ย. 2569)
 * "กันที่การส่ง ไม่ใช่ที่การอนุมัติ" — ถ้าหน้าจอไหนลืมตรวจ ใบที่กรอกไม่ครบก็ยังหลุดไปถึง GM ได้
 */
export async function submitClaim(month: string): Promise<ClaimWriteResult> {
  const draft = myClaims().find((c) => c.month === month);
  if (!draft) return { ok: false, message: "ยังไม่มีใบเบิกของเดือนนี้" };
  const problem = checkClaim(draft);
  if (!problem.ok) {
    return { ok: false, message: problem.reasons[0] ?? "กรอกข้อมูลยังไม่ครบ" };
  }

  /* เลขที่ใบและเวลาที่ยื่นออกจากฐานข้อมูล — ต้องไม่ซ้ำทั้งบริษัท
     ใบที่ถูกตีกลับแล้วยื่นใหม่ใช้เลขเดิม (file_claim เขียนทับใบของเดือนนั้น) */
  if (store.live) {
    const res = await fileClaim(draft);
    if (!res.ok) return { ok: false, message: say(res.reason) };
    dropDraft(month);
    store.refresh();
    return { ok: true };
  }

  const stamp = bkkNow();
  /* เลขที่ใบเบิกเดินต่อกันทั้งบริษัท — รวมใบของทีมงานที่ยังไม่มีบัญชี (emp-requests) และใบที่จ่ายคืนไปแล้ว (HR_REIMB) */
  const no = nextDocNo("EX", [
    ...store.all().flat().flatMap((c) => (c.no ? [c.no] : [])),
    ...empRequestIds("expense"),
    ...HR_REIMB.map((r) => r.no),
  ]);
  edit(month, (c) =>
    c.status === "ร่าง" || c.status === "ไม่อนุมัติ"
      ? {
          ...c,
          status: "รออนุมัติ",
          /* ยื่นใหม่หลังถูกตีกลับใช้เลขเดิม */
          no: c.no ?? no,
          comment: "",
          submittedAt: `${stamp.getFullYear()}-${pad2(stamp.getMonth() + 1)}-${pad2(stamp.getDate())} ${pad2(stamp.getHours())}:${pad2(stamp.getMinutes())}`,
        }
      : c,
  );
  return { ok: true };
}

/** ใบเบิกของทุกบทบาท — หน้าอนุมัติเท่านั้น */
export function useAllClaims() {
  return store.useAll();
}

/** หัวหน้าอนุมัติใบเบิกของเดือนนั้น */
export async function approveClaim(
  role: Role,
  month: string,
  comment: string,
): Promise<ClaimWriteResult> {
  if (store.live) {
    const res = await decideClaim(role, month, true, comment);
    store.refresh();
    return res.ok ? { ok: true } : { ok: false, message: say(res.reason, res) };
  }
  /* ใบที่ตัดสินไปแล้วไม่ส่งแจ้งเตือนซ้ำ — เช็คก่อนส่ง เหมือนใบลาและโอที */
  if (!store.ofRole(role).some((c) => c.month === month && c.status === "รออนุมัติ")) {
    return { ok: false, message: CLAIM_REASON.not_pending };
  }
  store.updateRole(role, (claims) =>
    claims.map((c) =>
      c.month === month && c.status === "รออนุมัติ"
        ? { ...c, status: "อนุมัติแล้ว" as const, comment, decidedAt: stampNow() }
        : c,
    ),
  );
  return { ok: true };
}

export async function rejectClaim(
  role: Role,
  month: string,
  comment: string,
): Promise<ClaimWriteResult> {
  if (store.live) {
    const res = await decideClaim(role, month, false, comment);
    store.refresh();
    return res.ok ? { ok: true } : { ok: false, message: say(res.reason, res) };
  }
  if (!store.ofRole(role).some((c) => c.month === month && c.status === "รออนุมัติ")) {
    return { ok: false, message: CLAIM_REASON.not_pending };
  }
  store.updateRole(role, (claims) =>
    claims.map((c) =>
      c.month === month && c.status === "รออนุมัติ"
        ? { ...c, status: "ไม่อนุมัติ" as const, comment, decidedAt: stampNow() }
        : c,
    ),
  );
  return { ok: true };
}

/**
 * ปิดรอบเงินเดือนแล้ว → ใบเบิกที่รวมอยู่ในรอบนั้นถือว่าจ่ายคืนแล้ว (เรียกผ่าน closePayrunFlow เท่านั้น)
 * ใบที่จ่ายแล้วไม่ถูกนับซ้ำในรอบถัดไป · ใบที่ยังไม่จ่ายเข้ารอบถัดไปเสมอ ไม่หล่นหาย
 *
 * ต่อฐานข้อมูลแล้วช่องนี้ (paid_in) ถูกตั้งโดย close_payrun() ตอนปิดรอบเงินเดือน
 * ที่นี่จึงไม่เขียนทับ — รอหน้าเงินเดือนย้ายมาใช้ฐานข้อมูลในขั้นถัดไป
 */
export function markReimbursed(items: { role: Role; month: string }[], payMonth: string) {
  if (store.live) return;
  for (const it of items) {
    store.updateRole(it.role, (claims) =>
      claims.map((c) =>
        c.month === it.month && c.status === "อนุมัติแล้ว" && !c.paidIn ? { ...c, paidIn: payMonth } : c,
      ),
    );
  }
}

/*
 * ยกเลิกการอนุมัติใบเบิก — ใบที่จ่ายคืนไปแล้ว (มี paidIn) ย้อนไม่ได้
 * เพราะเงินออกไปกับสลิปของรอบนั้นแล้ว ต้องไปเปิดรอบเงินเดือนก่อน
 */
export async function undoClaimDecision(
  role: Role,
  month: string,
  why: string,
): Promise<boolean> {
  const reason = why.trim();
  if (!reason) return false;

  if (store.live) {
    const res = await undoClaim(role, month, reason);
    store.refresh();
    return res.ok;
  }

  const claim = store.ofRole(role).find((c) => c.month === month);
  if (!claim || claim.paidIn) return false;
  if (claim.status !== "อนุมัติแล้ว" && claim.status !== "ไม่อนุมัติ") return false;
  store.updateRole(role, (claims) =>
    claims.map((c) =>
      c.month === month
        ? {
            ...c,
            status: "รออนุมัติ" as const,
            comment: `ยกเลิกการอนุมัติ: ${reason}`,
            decidedAt: undefined,
            undoneAt: stampNow(),
            undoneWhy: reason,
          }
        : c,
    ),
  );
  return true;
}

export function resetExpenseClaims() {
  store.reset();
  drafts.reset();
}

/**
 * ดึงใบที่ยื่นไปแล้วกลับมาแก้ ทำได้ตราบใดที่หัวหน้ายังไม่อนุมัติ
 *
 * ต่อฐานข้อมูลแล้วฐานข้อมูลพลิกใบเป็นร่าง (เก็บเลขที่ใบไว้ใช้ตอนยื่นใหม่)
 * แล้วลอกของในใบมาเป็นร่างในเครื่องให้แก้ต่อ เพราะร่างไม่ได้อ่านจากฐานข้อมูล
 */
export async function withdrawClaim(month: string): Promise<ClaimWriteResult> {
  if (store.live) {
    const sent = store.current().find((c) => c.month === month);
    const res = await withdrawClaimRemote(month);
    if (!res.ok) return { ok: false, message: say(res.reason, res) };
    if (sent) {
      drafts.update((ds) => [
        { ...sent, status: "ร่าง" as const, submittedAt: "" },
        ...ds.filter((c) => c.month !== month),
      ]);
    }
    store.refresh();
    return { ok: true };
  }
  edit(
    month,
    (c) => (c.status === "รออนุมัติ" ? { ...c, status: "ร่าง", submittedAt: "" } : c),
    true,
  );
  return { ok: true };
}
