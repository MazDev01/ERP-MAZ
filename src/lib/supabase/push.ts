import "server-only";

import webpush from "web-push";
import type { PushPayload } from "../push-scenarios";
import { adminSupabase, serverSupabase } from "./server";

/*
 * แจ้งเตือนเข้าเครื่อง (Web Push) — ฝั่งเซิร์ฟเวอร์
 *
 * เครื่องของผู้ใช้ลงทะเบียน endpoint ไว้ในตาราง push_devices แล้วเซิร์ฟเวอร์
 * ส่งข้อความเข้าเครื่องผ่านบริการของเจ้าของเบราว์เซอร์ (FCM ของ Chrome ·
 * Mozilla autopush · Apple Push ของ Safari) โดยเซ็นด้วยกุญแจ VAPID คู่เดียว
 * ของระบบนี้ บริการเหล่านั้นจึงรู้ว่าใครเป็นคนส่งและปฏิเสธคนอื่นได้
 *
 * ของเดิมงานนี้อยู่ที่ตัวส่งทดสอบบนคอมที่ /__push/* (ลบทิ้งแล้ว 17 พ.ย. 2569)
 * ซึ่งต้องรันเองและถือกุญแจของตัวเอง เปิดระบบตามปกติจึงไม่มีทางส่งถึงมือถือได้
 *
 * กุญแจลับอยู่ใน VAPID_PRIVATE_KEY ห้ามหลุดไปฝั่งเบราว์เซอร์
 * (ไฟล์นี้ import "server-only" ไว้ เผลอ import จากฝั่ง client แล้ว build พัง)
 */

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@maz.local";

/** มีกุญแจครบไหม — ไม่ครบก็ส่งไม่ได้ และหน้าจอต้องบอกเหตุ ไม่ใช่เงียบ */
export const hasPush = Boolean(PUBLIC_KEY && PRIVATE_KEY);

if (hasPush) webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);

export function pushPublicKey() {
  return PUBLIC_KEY;
}

export const PUSH_REASON: Record<string, string> = {
  no_push: "ระบบยังไม่ได้ตั้งกุญแจแจ้งเตือน",
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  no_account: "บัญชีนี้ยังไม่ผูกกับพนักงาน — แจ้งฝ่ายบุคคล",
  bad_subscription: "ข้อมูลเครื่องไม่ครบ",
  no_device: "เครื่องนี้ยังไม่ได้เปิดรับแจ้งเตือน",
};

type Sub = { endpoint?: string; keys?: { p256dh?: string; auth?: string } };

/** รหัสพนักงานของคนที่ยิงคำขอนี้มา — ถามฐานข้อมูลด้วยสิทธิ์ของเขาเอง */
async function myEmployeeId() {
  const sb = await serverSupabase();
  if (!sb) return null;
  const { data } = await sb.rpc("my_employee_id");
  return typeof data === "string" && data ? data : null;
}

export type PushResult = { ok: true; sent?: number } | { ok: false; reason: string };

/**
 * จำเครื่องนี้ไว้ว่ารับแจ้งเตือนได้
 * บันทึกผ่าน session ของผู้ใช้เอง RLS จึงกันไม่ให้ลงทะเบียนในชื่อคนอื่น
 * endpoint เป็น unique — เครื่องเดิมลงซ้ำก็ทับรายการเดิม ไม่เกิดแถวซ้ำ
 */
export async function saveDevice(subscription: Sub, label: string): Promise<PushResult> {
  const endpoint = subscription?.endpoint ?? "";
  const p256dh = subscription?.keys?.p256dh ?? "";
  const auth = subscription?.keys?.auth ?? "";
  if (!endpoint || !p256dh || !auth) return { ok: false, reason: "bad_subscription" };

  const sb = await serverSupabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const me = await myEmployeeId();
  if (!me) return { ok: false, reason: "no_account" };

  const { error } = await sb
    .from("push_devices")
    .upsert(
      { employee_id: me, endpoint, p256dh, auth_key: auth, label: label.slice(0, 80), last_seen: new Date().toISOString() },
      { onConflict: "endpoint" },
    );
  return error ? { ok: false, reason: error.message } : { ok: true };
}

/** เลิกรับแจ้งเตือนบนเครื่องนี้ */
export async function dropDevice(endpoint: string): Promise<PushResult> {
  const sb = await serverSupabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  const { error } = await sb.from("push_devices").delete().eq("endpoint", endpoint);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

type DeviceRow = { id: string; endpoint: string; p256dh: string; auth_key: string };

/**
 * ส่งเข้าทุกเครื่องของพนักงานกลุ่มนี้
 * ใช้กุญแจระบบอ่านรายชื่อเครื่อง เพราะคนส่งไม่ใช่เจ้าของเครื่อง (RLS ให้เห็นแต่ของตัวเอง)
 * ตอบ 404/410 = เครื่องถอนสิทธิ์หรือลบแอปแล้ว เก็บไว้ก็ส่งไม่ถึงอีก ลบทิ้ง
 */
export async function pushToEmployees(ids: string[], payload: Omit<PushPayload, "sentAt">): Promise<PushResult> {
  if (!hasPush) return { ok: false, reason: "no_push" };
  const sv = adminSupabase();
  if (!sv) return { ok: false, reason: "no_backend" };
  if (ids.length === 0) return { ok: false, reason: "no_device" };

  const { data } = await sv
    .from("push_devices")
    .select("id, endpoint, p256dh, auth_key")
    .in("employee_id", ids);
  const devices = (data ?? []) as DeviceRow[];
  if (devices.length === 0) return { ok: false, reason: "no_device" };

  const body = JSON.stringify({ ...payload, sentAt: Date.now() });
  const dead: string[] = [];
  const failed: string[] = [];
  let sent = 0;

  await Promise.all(
    devices.map(async (d) => {
      try {
        /* high = ปลุกเครื่องที่ล็อกจออยู่ให้ขึ้นทันที · TTL 1 ชม. เผื่อเครื่องไม่มีเน็ตชั่วคราว */
        await webpush.sendNotification(
          { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth_key } },
          body,
          { TTL: 3600, urgency: "high" },
        );
        sent += 1;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(d.id);
        else failed.push(String((e as { body?: string; message?: string }).body ?? (e as Error).message).slice(0, 120));
      }
    }),
  );

  if (dead.length) await sv.from("push_devices").delete().in("id", dead);
  /* ส่งไม่ถึงเครื่องไหนเลย ต้องบอกเหตุ ไม่ใช่ตอบว่าสำเร็จแล้วเงียบ */
  if (sent === 0) return { ok: false, reason: failed[0] ?? "no_device" };
  return { ok: true, sent };
}

/** ส่งเข้าเครื่องของตัวเอง — ปุ่มทดสอบในหน้าโปรไฟล์ใช้ทางนี้ */
export async function pushToMe(payload: Omit<PushPayload, "sentAt">): Promise<PushResult> {
  const me = await myEmployeeId();
  if (!me) return { ok: false, reason: "no_account" };
  return pushToEmployees([me], payload);
}

/* ── แจ้งเตือนตามเหตุการณ์จริงของระบบ ────────────────────────────── */

type Kind = "leave" | "ot" | "expense";

const TABLE: Record<Kind, string> = {
  leave: "leave_requests",
  ot: "ot_requests",
  expense: "expense_claims",
};

const DOC: Record<Kind, string> = { leave: "ใบลา", ot: "ใบขอโอที", expense: "ใบเบิกค่าใช้จ่าย" };

/** หน้าที่เปิดเมื่อกดแจ้งเตือน — ผู้อนุมัติไปที่คิวงาน ผู้ยื่นไปที่ใบของตัวเอง */
const MINE: Record<Kind, string> = { leave: "/leave", ot: "/ot", expense: "/expense" };

/** พนักงานที่ถือบทบาทนี้อยู่ — ใช้กุญแจระบบ เพราะคนยื่นอ่านบัญชีคนอื่นไม่ได้ (RLS) */
async function employeesWithRole(role: string): Promise<string[]> {
  const sv = adminSupabase();
  if (!sv || !role) return [];
  const { data } = await sv
    .from("user_accounts")
    .select("employee_id, roles, status")
    .eq("status", "active");
  return ((data ?? []) as { employee_id: string | null; roles: string[] | null }[])
    .filter((a) => a.employee_id && (a.roles ?? []).includes(role))
    .map((a) => a.employee_id as string);
}

/** จองสิทธิ์ส่งของคู่ (ใบ, สถานะ) นี้ — จองได้แปลว่ายังไม่มีใครส่ง */
async function claimSend(docId: string, status: string): Promise<boolean> {
  const sv = adminSupabase();
  if (!sv) return true;
  const { error } = await sv.from("push_sent").insert({ doc_id: docId, status });
  /* ชนกุญแจหลัก = มีคนส่งไปแล้ว */
  return !error;
}

async function nameOf(employeeId: string): Promise<string> {
  const sv = adminSupabase();
  if (!sv) return "";
  const { data } = await sv
    .from("employees")
    .select("first_name, last_name")
    .eq("id", employeeId)
    .maybeSingle();
  const e = data as { first_name: string; last_name: string } | null;
  return e ? `${e.first_name} ${e.last_name}`.trim() : "";
}

/**
 * แจ้งเตือนตามสถานะของใบใบหนึ่ง
 *
 * อ่านใบด้วยสิทธิ์ของคนที่เรียก (RLS) ก่อนเสมอ — ใบที่เขาไม่มีสิทธิ์เห็น ก็สั่งแจ้งเตือนไม่ได้
 * แล้วดูสถานะจริงในฐานข้อมูลเป็นตัวตัดสินว่าจะส่งอะไร ไม่เชื่อสิ่งที่หน้าจอบอกมา
 *   รออนุมัติ      → เข้าเครื่องของผู้อนุมัติตามบทบาทที่ตรึงไว้บนใบ
 *   อนุมัติ/ตีกลับ → เข้าเครื่องของผู้ยื่น
 * ไม่ส่งเข้าเครื่องของคนที่เป็นต้นเหตุเอง — เพิ่งกดเองกับมือ ไม่ต้องเตือน
 */
export async function notifyDoc(kind: Kind, id: string, asSystem = false): Promise<PushResult> {
  if (!hasPush) return { ok: false, reason: "no_push" };
  /*
   * asSystem = คำขอมาจากฐานข้อมูลเอง (ทริกเกอร์) ไม่ใช่จากเบราว์เซอร์ของใคร จึงไม่มี session ให้ใช้
   * ทางนั้นผ่านการตรวจกุญแจลับมาแล้วที่ชั้น route
   */
  const sb = asSystem ? adminSupabase() : await serverSupabase();
  if (!sb) return { ok: false, reason: "no_backend" };
  if (!TABLE[kind] || !id) return { ok: false, reason: "bad_doc" };

  const { data } = await sb
    .from(TABLE[kind])
    .select("id, no, employee_id, status, approver_role")
    .eq("id", id)
    .maybeSingle();
  const doc = data as
    | { id: string; no: string | null; employee_id: string; status: string; approver_role: string }
    | null;
  if (!doc) return { ok: false, reason: "no_doc" };

  /*
   * กันส่งซ้ำ — เรื่องเดียวกันมาได้สองทาง (หน้าจอบอกหลังกด และทริกเกอร์ของฐานข้อมูล)
   * ใครจองคู่ (ใบ, สถานะ) นี้ได้ก่อนเป็นคนส่ง อีกทางเงียบไป เครื่องปลายทางจึงไม่สั่นสองรอบ
   */
  if (!(await claimSend(doc.id, doc.status))) return { ok: true, sent: 0 };

  const me = asSystem ? null : await myEmployeeId();
  const who = await nameOf(doc.employee_id);
  const label = DOC[kind];
  const no = doc.no ?? "";

  let to: string[] = [];
  let title = "";
  let body = "";
  let url = "";

  if (doc.status === "pending") {
    to = await employeesWithRole(doc.approver_role);
    title = `${label}รออนุมัติ`;
    body = `${who} ยื่น${label} ${no}`.trim();
    url = `/approvals?kind=${kind}&find=${encodeURIComponent(no)}`;
  } else if (doc.status === "approved" || doc.status === "rejected") {
    to = [doc.employee_id];
    title = doc.status === "approved" ? `${label}ได้รับอนุมัติ` : `${label}ถูกตีกลับ`;
    body = no ? `${label} ${no}` : label;
    url = `${MINE[kind]}?find=${encodeURIComponent(no)}`;
  } else {
    return { ok: false, reason: "no_event" };
  }

  const list = to.filter((x) => x && x !== me);
  if (list.length === 0) return { ok: true, sent: 0 };

  const res = await pushToEmployees(list, {
    id: `${kind}-${doc.id}-${doc.status}`,
    title,
    body,
    url,
    /* tag เดียวกันของใบเดิมทับกัน ไม่ให้ขึ้นซ้อนกันหลายใบ */
    tag: `maz-${kind}-${doc.id}`,
    level: doc.status === "rejected" ? "late" : "info",
    vibrate: [80, 40, 80],
  });

  /* ปลายทางยังไม่ได้เปิดรับแจ้งเตือนบนเครื่องไหนเลย — เป็นเรื่องปกติ ไม่ใช่ความผิดพลาด
     (ถ้าตอบเป็นข้อผิดพลาด จะมีบรรทัดแดงใน console ทุกครั้งที่มีคนยื่นใบ) */
  return !res.ok && res.reason === "no_device" ? { ok: true, sent: 0 } : res;
}

/**
 * เซิร์ฟเวอร์รู้จักเครื่องนี้ไหม
 * เบราว์เซอร์จำ subscription ไว้เองแม้แถวในฐานข้อมูลจะหายไปแล้ว (ฝ่ายบุคคลลบ กู้ฐานข้อมูล ฯลฯ)
 * ถ้าไม่ถามก็จะขึ้นว่า "เปิดรับแจ้งเตือนแล้ว" ทั้งที่ไม่มีอะไรส่งถึงอีกเลย
 */
export async function knowsDevice(endpoint: string): Promise<boolean> {
  const sb = await serverSupabase();
  if (!sb || !endpoint) return false;
  const { data } = await sb.from("push_devices").select("id").eq("endpoint", endpoint).maybeSingle();
  return Boolean(data);
}
