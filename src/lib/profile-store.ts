"use client";

/*
 * รูปโปรไฟล์ที่ใช้ร่วมกันทุกที่ในระบบ (การ์ดโปรไฟล์ · เมนูมุมขวาบน · หน้าหลัก · แถบเมนูล่าง)
 *
 * ต่อฐานข้อมูลแล้ว (รอบที่ 153) — ไฟล์อยู่ในถัง avatars ที่อยู่เก็บใน employees.photo_path
 * รูปจึงตามคนไปทุกเครื่อง และเพื่อนร่วมงานเห็นรูปของกันและกัน
 * โหมดไม่มีฐานข้อมูลยังเก็บเป็น data URL ในเครื่องแยกตามบทบาทเหมือนเดิม
 *
 * ⚠️ เก็บ "แยกตามบทบาท" (เจ้าของแจ้ง 25 ก.ย. 2569)
 * เดิมเก็บรูปเดียวทั้งเครื่อง ตั้งรูปในบัญชีผู้ดูแลระบบแล้วบัญชีอื่นขึ้นรูปเดียวกันหมด
 * ทั้งที่เป็นคนละบัญชีคนละคน · คีย์เดิม (v1) ทิ้งไปเลย เพราะไม่รู้ว่ารูปนั้นเป็นของบัญชีไหน
 */

import { useSyncExternalStore } from "react";
import { currentRole, useRole, type Role } from "./role";
import { hasBackend } from "./supabase/env";
import { fetchPhotoUrls, removeMyPhoto, uploadMyPhoto } from "./supabase/photos";
import { meNow, subscribeMe } from "./supabase/me";

const STORAGE_KEY = "maz-hrm.profile-photo.v2";
/** คีย์เดิมที่เก็บรูปเดียวใช้ร่วมกันทุกบทบาท — ล้างทิ้งครั้งเดียวตอนอ่านครั้งแรก */
const LEGACY_KEY = "maz-hrm.profile-photo.v1";

type PhotoByRole = Partial<Record<Role, string>>;

let cache: PhotoByRole | undefined;
const listeners = new Set<() => void>();

function read(): PhotoByRole {
  if (cache) return cache;
  try {
    window.localStorage.removeItem(LEGACY_KEY);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    cache = parsed && typeof parsed === "object" ? (parsed as PhotoByRole) : {};
  } catch {
    cache = {};
  }
  return cache;
}

/* รูปของทุกคนจากฐานข้อมูล — คีย์เป็นรหัสพนักงาน · อ่านครั้งเดียวแล้วแจกทุกจุด */
let live: Record<string, string> = {};
let loaded = false;
let loading = false;
/** รหัสพนักงานของคนที่ล็อกอิน — หน้าจออ่านรูปของตัวเองผ่านตัวนี้ */
let meNo = "";

function tell() {
  for (const listener of listeners) listener();
}

function loadLive() {
  if (!hasBackend || loaded || loading) return;
  loading = true;
  void fetchPhotoUrls()
    .then((map) => {
      live = map;
      loaded = true;
    })
    .finally(() => {
      loading = false;
      tell();
    });
}

/* รหัสพนักงานของคนที่ล็อกอิน — มาจากข้อมูลตัวตนที่ระบบโหลดไว้แล้ว ไม่ต้องให้หน้าจอบอก */
function myEmpNo() {
  const me = meNow();
  if (me?.empNo && me.empNo !== meNo) meNo = me.empNo;
  return meNo;
}

/*
 * ข้อมูลตัวตนมาถึงทีหลังการโหลดหน้า และเปลี่ยนเมื่อเข้า/ออกจากระบบ
 * ตอนอยู่หน้าเข้าสู่ระบบยังไม่มีสิทธิ์อ่านรูป ถ้าจำผลว่างไว้จะไม่มีรูปทั้งเซสชัน
 * จึงสั่งอ่านใหม่ทุกครั้งที่ตัวตนเปลี่ยน (เจอตอนทดสอบรอบที่ 153)
 */
if (typeof window !== "undefined") {
  subscribeMe(() => {
    const no = meNow()?.empNo ?? "";
    if (no !== meNo) {
      meNo = no;
      loaded = false;
      live = {};
    }
    loadLive();
    tell();
  });
}

/** รูปของคนอื่นตามรหัสพนักงาน — ใช้กับรายชื่อทีม แชท และผู้รับงาน */
export function photoOf(empNo: string): string | null {
  loadLive();
  return live[empNo] ?? null;
}

/** สั่งอ่านรูปใหม่ทั้งชุด — เรียกหลังมีคนเปลี่ยนรูป */
export function refreshPhotos() {
  loaded = false;
  loadLive();
}

export function subscribeProfilePhoto(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** รูปของบทบาทที่กำลังใช้อยู่ — ไม่ระบุบทบาทคืออ่านของบทบาทปัจจุบัน */
export function getProfilePhoto(role?: Role): string | null {
  if (hasBackend) {
    loadLive();
    const no = myEmpNo();
    return (no && live[no]) || null;
  }
  return read()[role ?? currentRole()] ?? null;
}

/** ตอน SSR ยังไม่มี localStorage — ให้เป็น null เสมอ */
export function getProfilePhotoServer(): string | null {
  return null;
}

/**
 * แปลง data URL เป็นไฟล์จริง — ถอดรหัสเอง ไม่ใช้ fetch()
 * (นโยบายความปลอดภัยของหน้าเว็บบล็อก fetch ไปยัง data: — เจอตอนทดสอบรอบที่ 153)
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const type = /data:([^;]+)/.exec(head)?.[1] ?? "image/jpeg";
  const bin = window.atob(body ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * ตั้งรูปของตัวเองจากไฟล์จริง (รอบที่ 153) — อัปขึ้นถังแล้วผูกกับทะเบียน
 * คืนข้อความผิดพลาดเมื่อทำไม่สำเร็จ เพื่อให้หน้าจอบอกผู้ใช้ได้ว่าเพราะอะไร
 */
export async function saveProfilePhoto(file: Blob): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!hasBackend) {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
      reader.readAsDataURL(file);
    });
    setProfilePhoto(url);
    return { ok: true };
  }
  const res = await uploadMyPhoto(file);
  if (!res.ok) {
    /* เหตุผลจริงจากถัง/ฐานข้อมูลไว้ดูตอนไล่ปัญหา — ผู้ใช้เห็นข้อความที่อ่านรู้เรื่องด้านล่าง */
    console.error("saveProfilePhoto:", res.reason);
    return {
      ok: false,
      message:
        res.reason === "too_big"
          ? "ไฟล์ใหญ่เกิน 2 MB"
          : res.reason === "no_account"
            ? "บัญชีนี้ยังไม่ผูกกับทะเบียนพนักงาน แจ้งฝ่ายบุคคลก่อน"
            : "บันทึกรูปไม่สำเร็จ ลองใหม่อีกครั้ง",
    };
  }
  refreshPhotos();
  return { ok: true };
}

/** เอารูปของตัวเองออก */
export async function clearProfilePhoto(): Promise<void> {
  if (!hasBackend) {
    setProfilePhoto(null);
    return;
  }
  await removeMyPhoto();
  refreshPhotos();
}

export function setProfilePhoto(dataUrl: string | null, role?: Role) {
  const who = role ?? currentRole();
  const next = { ...read() };
  if (dataUrl) next[who] = dataUrl;
  else delete next[who];
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // โควตาเต็มหรือโหมดส่วนตัว — ยังให้หน้าจอเปลี่ยนตามได้
  }
  for (const listener of listeners) listener();
}

/*
 * ฮุกอ่านรูปโปรไฟล์ — ทุกที่ที่โชว์รูปต้องใช้ตัวนี้ ไม่ใช่ต่อสโตร์เอง
 * เปลี่ยนรูปแล้วทุกจุดของบทบาทนั้นต้องเปลี่ยนตามพร้อมกัน และบทบาทอื่นต้องไม่เปลี่ยนตาม
 */
export function useProfilePhoto() {
  const role = useRole();
  return useSyncExternalStore(
    subscribeProfilePhoto,
    () => getProfilePhoto(role),
    getProfilePhotoServer,
  );
}

/** รูปของคนตามรหัสพนักงาน — ใช้ในรายชื่อทีม แชท และผู้รับงาน */
export function usePhotoOf(empNo: string) {
  return useSyncExternalStore(
    subscribeProfilePhoto,
    () => photoOf(empNo),
    getProfilePhotoServer,
  );
}

/** อ่านไฟล์รูปเป็น data URL เพื่อเก็บลง localStorage ได้ */
export function readImageAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}
