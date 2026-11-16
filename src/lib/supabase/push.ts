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
 * ของเดิมงานนี้อยู่ที่ตัวส่งทดสอบบนคอม (tools/push-sender.mjs) ที่ /__push/*
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
