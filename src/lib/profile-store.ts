"use client";

/*
 * รูปโปรไฟล์ที่ใช้ร่วมกันทุกที่ในระบบ (การ์ดโปรไฟล์ · เมนูมุมขวาบน · หน้าหลัก · แถบเมนูล่าง)
 * เก็บเป็น data URL ใน localStorage จึงอยู่ข้ามการรีเฟรชหน้า
 *
 * ⚠️ เก็บ "แยกตามบทบาท" (เจ้าของแจ้ง 25 ก.ย. 2569)
 * เดิมเก็บรูปเดียวทั้งเครื่อง ตั้งรูปในบัญชีผู้ดูแลระบบแล้วบัญชีอื่นขึ้นรูปเดียวกันหมด
 * ทั้งที่เป็นคนละบัญชีคนละคน · คีย์เดิม (v1) ทิ้งไปเลย เพราะไม่รู้ว่ารูปนั้นเป็นของบัญชีไหน
 */

import { useSyncExternalStore } from "react";
import { currentRole, useRole, type Role } from "./role";
import { reportStorageError } from "./storage-health";

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

export function subscribeProfilePhoto(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** รูปของบทบาทที่กำลังใช้อยู่ — ไม่ระบุบทบาทคืออ่านของบทบาทปัจจุบัน */
export function getProfilePhoto(role?: Role): string | null {
  return read()[role ?? currentRole()] ?? null;
}

/** ตอน SSR ยังไม่มี localStorage — ให้เป็น null เสมอ */
export function getProfilePhotoServer(): string | null {
  return null;
}

export function setProfilePhoto(dataUrl: string | null, role?: Role) {
  const who = role ?? currentRole();
  const next = { ...read() };
  if (dataUrl) next[who] = dataUrl;
  else delete next[who];
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    /* รูปเก็บเป็น data URL จึงกินพื้นที่มาก เต็มเมื่อไรต้องบอกผู้ใช้ ไม่ใช่เงียบ (BUG-003) */
    reportStorageError(error);
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

/** อ่านไฟล์รูปเป็น data URL เพื่อเก็บลง localStorage ได้ */
export function readImageAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}

/** รูปโปรไฟล์ที่รับได้ — เก็บเป็น data URL ใน localStorage จึงต้องจำกัดขนาด */
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
export const PHOTO_MAX_MB = 2;

/**
 * ตรวจไฟล์ก่อนเอาไปทำรูปโปรไฟล์ (ตรวจระบบ 5 ต.ค. 2569 · BUG-002)
 * เดิมรับทุกไฟล์แล้วเงียบ เลือกไฟล์ข้อความมาก็ไม่มีอะไรเกิดขึ้น ผู้ใช้ไม่รู้ว่าพลาดตรงไหน
 * กัน accept ของช่องเลือกไฟล์อย่างเดียวไม่พอ เพราะลากวางหรือมือถือบางรุ่นข้ามได้
 */
export function checkPhotoFile(file: File): string | null {
  if (!PHOTO_TYPES.includes(file.type)) return "ไฟล์นี้ไม่ใช่รูปภาพ ใช้ได้เฉพาะ JPG PNG GIF หรือ WEBP";
  if (file.size > PHOTO_MAX_MB * 1024 * 1024) return `รูปใหญ่เกิน ${PHOTO_MAX_MB} MB ย่อรูปก่อนแล้วลองใหม่`;
  return null;
}
