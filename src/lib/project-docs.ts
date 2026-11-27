"use client";

/*
 * ไฟล์ของโปรเจค — สะพานระหว่างไฟล์ที่เก็บไว้ในเครื่องกับถังของระบบ (รอบที่ 111)
 *
 * ของเดิมไฟล์อยู่ใน IndexedDB ของเครื่องที่แนบ ทีมบนเครื่องอื่นเห็นชื่อไฟล์แต่เปิดไม่ได้
 * ตอนนี้ตอนแนบจะส่งขึ้นถัง "docs" ด้วย แล้วเก็บที่อยู่ไฟล์ไว้ในแถวของเอกสาร
 *
 * เปิดไฟล์: มีที่อยู่ในถัง → ขอลิงก์ชั่วคราวแล้วเปิด · ไม่มี → เปิดจากไฟล์ในเครื่องเหมือนเดิม
 * (แถวเก่าที่แนบไว้ก่อนรอบที่ 111 มีแต่ไฟล์ในเครื่อง)
 */

import { getFile } from "./file-store";
import type { ProjectDoc } from "./pm-data";
import { openStoredFile } from "./file-store";
import { fileUrl } from "./supabase/files";
import { sbUploadProjectFile } from "./supabase/pm";
import { hasBackend } from "./supabase/env";

/**
 * ส่งไฟล์ที่เก็บไว้ในเครื่องขึ้นถังของระบบ — คืนที่อยู่ไฟล์ หรือ undefined ถ้าส่งไม่ได้
 * ส่งไม่ได้ไม่ใช่เรื่องคอขวด แถวเอกสารยังถูกบันทึกพร้อมไฟล์ในเครื่องเหมือนเดิม
 */
export async function uploadProjectFile(pj: string, fileId: string): Promise<string | undefined> {
  if (!hasBackend) return undefined;
  const saved = await getFile(fileId);
  if (!saved?.blob) return undefined;
  /* ที่เก็บในเครื่องเก็บเป็น Blob — ประกอบกลับเป็นไฟล์พร้อมชื่อและชนิดเดิมก่อนส่งขึ้นถัง */
  const file = new File([saved.blob], saved.name, { type: saved.type || saved.blob.type });
  return uploadProjectFileBlob(pj, file);
}

/**
 * ส่งไฟล์ก้อนใหญ่จากที่เก็บในเครื่องขึ้น Google Drive (รอบที่ 131)
 * ยังไม่ได้ตั้งกุญแจ Google จะคืน ok: false พร้อมข้อความให้หน้าจอบอกผู้ใช้
 */
export async function driveFromStore(
  fileId: string,
  onProgress?: (p: number) => void,
): Promise<{ ok: true; id: string; url: string } | { ok: false; message: string } | null> {
  const saved = await getFile(fileId);
  if (!saved?.blob) return null;
  const file = new File([saved.blob], saved.name, { type: saved.type || saved.blob.type });
  const { uploadToDrive } = await import("./drive");
  const res = await uploadToDrive(file, onProgress);
  return res.ok ? { ok: true, id: res.id, url: res.url } : { ok: false, message: res.message };
}

/** ส่งไฟล์ที่มีอยู่ในมือแล้วขึ้นถัง — ใช้กับไฟล์ของร่างโปรเจคใหม่ที่เก็บ Blob ไว้เอง */
export async function uploadProjectFileBlob(pj: string, file: File): Promise<string | undefined> {
  if (!hasBackend) return undefined;
  return (await sbUploadProjectFile(pj, file)) ?? undefined;
}

/** เปิดไฟล์ของเอกสารโปรเจค — คืนข้อความบอกเหตุถ้าเปิดไม่ได้ */
export async function openProjectDoc(d: ProjectDoc): Promise<string | null> {
  if (d.path) {
    const url = await fileUrl(d.path);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return null;
    }
  }
  if (d.fileId) return openStoredFile(d.fileId);
  return "ไฟล์นี้ยังไม่ได้อัปโหลดจริง";
}

/**
 * เปิดไฟล์ที่แนบมากับรอบส่งงาน (รอบที่ 154)
 * รอบที่ส่งหลังรอบนี้มีที่อยู่ไฟล์ในถัง — เปิดได้จากทุกเครื่องที่มีสิทธิ์เห็นโปรเจค
 * รอบเก่ามีแต่ชื่อไฟล์ คืนข้อความบอกเหตุไปให้หน้าจอแสดง
 */
export async function openSubFile(
  sub: { refs?: { name: string; path: string }[] },
  name: string,
): Promise<string | null> {
  const ref = sub.refs?.find((r) => r.name === name);
  if (!ref) return "ไฟล์รอบนี้ส่งก่อนระบบเก็บไฟล์ให้ จึงเปิดจากที่นี่ไม่ได้ — ขอไฟล์จากคนส่งโดยตรง";
  const url = await fileUrl(ref.path);
  if (!url) return "เปิดไฟล์ไม่ได้ ลองใหม่อีกครั้ง";
  window.open(url, "_blank", "noopener,noreferrer");
  return null;
}
