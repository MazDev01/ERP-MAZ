"use client";

/*
 * โปรเจคใหม่ของ PM — ต้นแบบ dose-erp-maz/project-new.html
 *
 * ร่าง (ชื่อ ลูกค้า วันที่ แผนงาน บันทึก) เก็บที่ระบบตั้งแต่รอบที่ 155 — ตารางค่าตั้งส่วนตัว
 * เปิดจากเครื่องไหนของคนเดียวกันก็เห็นร่างเดิม · ส่วนไฟล์และรูปยังอยู่ใน IndexedDB ของเครื่อง
 * (ดู project-files.ts) แล้วส่งขึ้นถังของระบบตอนกดสร้างโปรเจค
 *
 * ไม่มีปุ่มบันทึก — แก้อะไรก็บันทึกร่างทันทีเหมือนหน้าวางแผนงาน (กติกาเดียวกับ pm-plan)
 * ตอนกดสร้าง ร่างจะกลายเป็นแถวจริงใน projects / project_tasks (createOwnProject)
 */

import { useSyncExternalStore } from "react";
import { createPersistedStore } from "./persisted-store";

export type NewTask = {
  id: string;
  name: string;
  /** กำหนดเสร็จ (YYYY-MM-DD) — ว่าง = ยังไม่กำหนด */
  due: string;
  done: boolean;
};

export type NewPhase = {
  id: string;
  name: string;
  tasks: NewTask[];
};

export type NewProject = {
  name: string;
  /** ชื่อลูกค้าหรือบริษัท — พิมพ์เอง เพราะโปรเจคใหม่ยังไม่ผูกกับดีล */
  cus: string;
  start: string;
  due: string;
  /** ขอบเขตงานที่จะส่งมอบ */
  desc: string;
  /** บันทึกของโปรเจค — ข้อตกลงกับลูกค้า ข้อจำกัด หรือเรื่องที่ทีมต้องรู้ */
  note: string;
  phases: NewPhase[];
};

export const EMPTY_PROJECT: NewProject = {
  name: "",
  cus: "",
  start: "",
  due: "",
  desc: "",
  note: "",
  phases: [],
};

function isProject(value: unknown): value is NewProject {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return typeof p.name === "string" && Array.isArray(p.phases);
}

/*
 * ร่างเก็บที่ระบบ (รอบที่ 155) — ของเดิมอยู่ในเบราว์เซอร์เครื่องเดียว
 * ฝ่ายโครงการเริ่มร่างที่ออฟฟิศแล้วไปต่อที่บ้านไม่ได้ และล้างข้อมูลเว็บคือร่างหาย
 * ไฟล์กับรูปยังอยู่ในเครื่องเหมือนเดิม จะย้ายขึ้นถังตอนกดสร้างโปรเจค
 */
const store = createPersistedStore<NewProject>("maz-erp.pm-project-new.v1", EMPTY_PROJECT, isProject, undefined, true);

export function useNewProject() {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

/** รหัสของเฟสและงาน — ใช้เป็นคีย์ตอนวาด ไม่ได้ส่งขึ้น backend */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** แก้ช่องข้อมูลโปรเจค (ชื่อ ลูกค้า วันที่ ขอบเขต บันทึก) */
export function setField<K extends keyof NewProject>(key: K, value: NewProject[K]) {
  store.update((p) => ({ ...p, [key]: value }));
}

export function addPhase() {
  const id = uid();
  store.update((p) => ({ ...p, phases: [...p.phases, { id, name: "", tasks: [] }] }));
  return id;
}

export function renamePhase(id: string, name: string) {
  store.update((p) => ({
    ...p,
    phases: p.phases.map((ph) => (ph.id === id ? { ...ph, name } : ph)),
  }));
}

/** ลบเฟส — งานย่อยในเฟสหายไปด้วย หน้าจอจึงถามยืนยันก่อนถ้ามีงานอยู่ */
export function removePhase(id: string) {
  store.update((p) => ({ ...p, phases: p.phases.filter((ph) => ph.id !== id) }));
}

export function addTask(phaseId: string, name: string) {
  store.update((p) => ({
    ...p,
    phases: p.phases.map((ph) =>
      ph.id === phaseId
        ? { ...ph, tasks: [...ph.tasks, { id: uid(), name, due: "", done: false }] }
        : ph,
    ),
  }));
}

export function patchTask(phaseId: string, taskId: string, patch: Partial<Omit<NewTask, "id">>) {
  store.update((p) => ({
    ...p,
    phases: p.phases.map((ph) =>
      ph.id === phaseId
        ? { ...ph, tasks: ph.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) }
        : ph,
    ),
  }));
}

export function removeTask(phaseId: string, taskId: string) {
  store.update((p) => ({
    ...p,
    phases: p.phases.map((ph) =>
      ph.id === phaseId ? { ...ph, tasks: ph.tasks.filter((t) => t.id !== taskId) } : ph,
    ),
  }));
}

/** ล้างร่างทั้งหมด — ใช้ตอนเริ่มโปรเจคใหม่อีกรอบ */
export function resetNewProject() {
  store.reset();
}

/** งานทั้งหมดกับงานที่เสร็จแล้ว — ใช้กับแถบความคืบหน้าและตัวเลขหัวการ์ด */
export function planCount(p: NewProject) {
  const tasks = p.phases.flatMap((ph) => ph.tasks);
  const done = tasks.filter((t) => t.done).length;
  return {
    phases: p.phases.length,
    tasks: tasks.length,
    done,
    pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  };
}
