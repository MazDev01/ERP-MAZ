"use client";

import { useSyncExternalStore } from "react";
import { loadRecords, saveRecords, type PunchRecord } from "./attendance";
import { currentRole, ROLES, subscribeRole, type Role } from "./role";
import { hasBackend } from "./supabase/env";
import { PUNCH_REASON, fetchAllPunches, fetchMyPunches, sendPunch } from "./supabase/punches";

/*
 * localStorage และนาฬิกาเป็น "external store" ในสายตา React
 * จึงอ่านผ่าน useSyncExternalStore แทนการ setState ใน useEffect
 * (React 19 ห้าม setState ใน effect body — ทำให้ render ซ้อนกัน)
 *
 * ต่อฐานข้อมูลแล้ว (hasBackend) การตอกบัตรของตัวเองอ่านจากตาราง punches
 * แทน localStorage — แต่คืนค่าแบบ "มีแล้วค่อยว่ากัน" เพราะ useSyncExternalStore
 * ต้องได้คำตอบทันที รอ await ไม่ได้ ครั้งแรกจึงคืนลิสต์ว่างและสั่งโหลดไว้
 * พอข้อมูลมาถึงก็ bump() ให้ทุกหน้าวาดใหม่เอง
 */

// ─── รายการตอกบัตร ────────────────────────────────────────────────
const EMPTY: PunchRecord[] = [];
let recordsCache: PunchRecord[] | null = null;
/* จำไว้ว่าแคชเป็นของบทบาทไหน พอสลับบทบาทต้องอ่านของคนใหม่ ไม่ใช้ของเดิมค้าง */
let cachedRole: Role | null = null;
/** เพิ่มขึ้นทุกครั้งที่การตอกบัตรเปลี่ยน — ใช้บอก snapshot รวมว่าต้องอ่านใหม่ */
let version = 0;
const recordListeners = new Set<() => void>();

function bump() {
  version += 1;
  for (const listener of recordListeners) listener();
}

export function subscribeRecords(onChange: () => void) {
  recordListeners.add(onChange);
  const offRole = subscribeRole(onChange);
  return () => {
    recordListeners.delete(onChange);
    offRole();
  };
}

/* ─── ที่มาจากฐานข้อมูล ───────────────────────────────────────────
 * remote = null คือยังไม่เคยโหลด · loading กันยิงซ้อนตอนหลายหน้าถามพร้อมกัน
 */
let remote: PunchRecord[] | null = null;
let loading = false;

function loadRemote() {
  if (loading || remote !== null) return;
  loading = true;
  void fetchMyPunches()
    .then((list) => {
      remote = list;
    })
    .catch(() => {
      /* อ่านไม่ได้ (เน็ตหลุด / session หมดอายุ) — ให้เป็นลิสต์ว่างไว้ก่อน
         ไม่ปล่อยเป็น null ไม่งั้นจะวนยิงใหม่ทุกครั้งที่ React อ่าน snapshot */
      remote = EMPTY;
    })
    .finally(() => {
      loading = false;
      bump();
    });
}

/** สั่งอ่านจากฐานข้อมูลใหม่ — ใช้หลังตอกบัตรหรือหลังฝ่ายบุคคลแก้เวลา */
export function refreshRecords() {
  if (!hasBackend) return;
  remote = null;
  remoteAll = null;
  loadRemote();
  loadRemoteAll();
}

export function getRecordsSnapshot(): PunchRecord[] {
  if (hasBackend) {
    /* สลับบทบาท = เปลี่ยนคน ต้องอ่านของคนใหม่ ไม่ใช้ของเดิมค้าง
       ปกติบทบาทมาจากบัญชีที่ล็อกอิน แต่ตัวสลับบทบาทสำหรับทดสอบยังมีอยู่ */
    const role = currentRole();
    if (cachedRole !== role) {
      cachedRole = role;
      remote = null;
    }
    loadRemote();
    return remote ?? EMPTY;
  }
  const role = currentRole();
  if (recordsCache === null || cachedRole !== role) {
    cachedRole = role;
    recordsCache = loadRecords(role);
  }
  return recordsCache;
}

/** ตอน SSR ยังไม่มี localStorage — ให้เป็นลิสต์ว่างที่อ้างอิงเดิมเสมอ */
export function getRecordsServerSnapshot(): PunchRecord[] {
  return EMPTY;
}

/**
 * ล้างการตอกบัตรทั้งหมด — ใช้ตอนทดสอบ กู้คืนไม่ได้
 * ต่อฐานข้อมูลแล้วตัวนี้ล้างได้แค่ของในเครื่อง เพราะ punches ไม่มีสิทธิ์ลบให้ใคร
 * นอกจากฝ่ายบุคคลผ่าน hr_remove_punch ที่ต้องระบุเหตุผลและลงบันทึกไว้
 */
export function clearRecords() {
  recordsCache = EMPTY;
  cachedRole = currentRole();
  saveRecords(cachedRole, EMPTY);
  bump();
}

export type SaveResult = { ok: true } | { ok: false; message: string };

/**
 * บันทึกการตอกบัตร
 *
 * ยังไม่ต่อฐานข้อมูล: เขียนลงเครื่องแล้วถือว่าสำเร็จทันทีเหมือนเดิม
 * ต่อแล้ว: ส่งให้ฐานข้อมูลตัดสิน (เวลา พื้นที่ และลำดับเข้า–ออก) แล้วเก็บแถวที่ได้กลับมา
 *          ใส่ไว้ก่อนให้หน้าจอขยับทันที ถ้าฐานข้อมูลไม่รับก็ถอนออกและบอกเหตุผล
 */
export async function addRecord(record: PunchRecord): Promise<SaveResult> {
  if (!hasBackend) {
    recordsCache = [...getRecordsSnapshot(), record];
    cachedRole = currentRole();
    saveRecords(cachedRole, recordsCache);
    bump();
    return { ok: true };
  }

  const before = remote ?? EMPTY;
  remote = [...before, record];
  bump();

  const res = await sendPunch(record.type, record.geo, record.note).catch(() => ({
    ok: false as const,
    reason: "network",
  }));

  if (!res.ok) {
    remote = (remote ?? EMPTY).filter((r) => r.id !== record.id);
    bump();
    const detail = PUNCH_REASON[res.reason] ?? "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง";
    const dist = "dist" in res && res.dist !== undefined ? ` · ห่าง ${res.dist} ม.` : "";
    return { ok: false, message: `${detail}${dist}` };
  }

  /* เวลาที่แสดงต้องเป็นของฐานข้อมูล ไม่ใช่ของเครื่องผู้ใช้ จึงแทนแถวที่ใส่ไว้ก่อน */
  remote = (remote ?? EMPTY).map((r) => (r.id === record.id ? res.record : r));
  /* ตารางของฝ่ายบุคคลอ่านคนละชุด ต้องสั่งอ่านใหม่ด้วย ไม่งั้นเวลาที่เพิ่งตอกไม่ขึ้น */
  remoteAll = null;
  loadRemoteAll();
  bump();
  return { ok: true };
}

/*
 * การตอกบัตรของทุกบทบาทพร้อมกัน — มีที่ใช้ที่เดียวคือสะพานฝ่ายบุคคล (hr-link.ts)
 * เพราะฝ่ายบุคคลต้องเห็นเวลาเข้างานของทุกคน ไม่ใช่แค่ของคนที่ล็อกอินอยู่
 *
 * หน้าของพนักงานห้ามใช้ตัวนี้ ต้องใช้ getRecordsSnapshot ที่หั่นตามบทบาทแล้ว
 * ไม่งั้นพนักงานจะเห็นเวลาเข้าออกของเพื่อนร่วมงาน
 */
let allCache: Record<Role, PunchRecord[]> | null = null;
let allStamp = -1;

const EMPTY_ALL = Object.fromEntries(ROLES.map((r) => [r.key, EMPTY])) as Record<
  Role,
  PunchRecord[]
>;

/* ของทุกคนจากฐานข้อมูล — ฝ่ายบุคคลเท่านั้นที่ได้ครบ คนอื่นได้แต่ของตัวเอง (RLS) */
let remoteAll: Record<Role, PunchRecord[]> | null = null;
let loadingAll = false;

function loadRemoteAll() {
  if (loadingAll || remoteAll !== null) return;
  loadingAll = true;
  void fetchAllPunches()
    .then((all) => {
      remoteAll = all;
    })
    .catch(() => {
      /* อ่านไม่ได้ — ให้เป็นค่าว่างไว้ก่อน ไม่ปล่อยเป็น null ไม่งั้นจะวนยิงใหม่ไม่จบ */
      remoteAll = EMPTY_ALL;
    })
    .finally(() => {
      loadingAll = false;
      bump();
    });
}

function getAllSnapshot(): Record<Role, PunchRecord[]> {
  if (hasBackend) {
    loadRemoteAll();
    return remoteAll ?? EMPTY_ALL;
  }
  /* อ่านใหม่เมื่อมีคนตอกบัตรเพิ่มเท่านั้น จะได้คืนวัตถุอ้างอิงเดิมให้ useMemo ใช้ต่อได้ */
  if (allCache === null || allStamp !== version) {
    allStamp = version;
    allCache = Object.fromEntries(
      ROLES.map((r) => [r.key, loadRecords(r.key)]),
    ) as Record<Role, PunchRecord[]>;
  }
  return allCache;
}

export function useAllPunches() {
  return useSyncExternalStore(subscribeRecords, getAllSnapshot, () => EMPTY_ALL);
}

// ─── นาฬิกาเดินวินาที ─────────────────────────────────────────────
let tick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

export function subscribeClock(onChange: () => void) {
  clockListeners.add(onChange);
  if (timer === null) {
    // ตั้งค่าแรกทันที React จะอ่าน snapshot ซ้ำหลัง subscribe จึงไม่ค้างที่ 0
    tick = Date.now();
    timer = setInterval(() => {
      tick = Date.now();
      for (const listener of clockListeners) listener();
    }, 1000);
  }
  return () => {
    clockListeners.delete(onChange);
    if (clockListeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function getClockSnapshot() {
  return tick;
}

/** 0 = ยังไม่ mount ฝั่ง client ใช้แสดง placeholder แทนเวลา */
export function getClockServerSnapshot() {
  return 0;
}
