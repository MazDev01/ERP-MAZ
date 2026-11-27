"use client";

/*
 * งานรอกันตามลำดับ และสถานะ "รอข้อมูล" (ยกมาจาก ERP_Test · แผนที่ระบบ 20 ต.ค. 2569)
 *
 * สองเรื่องนี้คนละแบบกัน อย่าเอามารวมกัน
 *   ก. รองานก่อนหน้า (after) — ตามแผน เริ่มไม่ได้และส่งไม่ได้จนกว่างานก่อนหน้าจะผ่าน
 *      ไม่เก็บสถานะซ้ำ คิดจาก after ทุกครั้ง งานก่อนหน้าผ่านปุ๊บใบที่รออยู่เริ่มได้เอง
 *      ด่านจริงอยู่ที่ฐานข้อมูล (รอบที่ 145) หน้าจอแค่บอกเหตุผลและซ่อนปุ่มให้ตรงกัน
 *   ข. รอข้อมูลที่คนทำกดเอง (waitingOn) — รอนอกแผน เช่น รอรูปจากลูกค้า
 *      ไม่ล็อกการส่งงาน แต่บอกทีมว่าค้างเพราะอะไร และกันไม่ให้เวลารอกลายเป็นความช้าของคนทำ
 *
 * ลำดับงานตั้งต้นมาจากเฟส — งานในเฟสถัดไปรอ "ทุกงานในเฟสก่อนหน้าที่มีงาน"
 * ไม่มีหน้าจอให้ติ๊กทีละใบ (เจ้าของสั่งไว้ที่ ERP_Test 21 ต.ค. 2569 ว่าเอาออก)
 */

import { daysBetween } from "./format";
import type { ProjectTask } from "./pm-data";

/** งานก่อนหน้า "ผ่าน" แล้ว = ผู้ตรวจกดผ่าน (รอลูกค้าตรวจ หรือเสร็จแล้ว) */
export const passed = (t: Pick<ProjectTask, "status">) => t.status === "wait" || t.status === "done";

/**
 * ลำดับงานตั้งต้นจากเฟส — คืนชื่องานของเฟสก่อนหน้าที่ใกล้ที่สุดที่มีงาน
 * เฟสที่ไม่มีงานเลยถูกข้าม งานในเฟสแรกจึงไม่รอใคร
 */
export function autoAfter(tasks: Pick<ProjectTask, "name" | "phase">[], phase: number): string[] {
  for (let p = phase - 1; p >= 0; p -= 1) {
    const names = tasks.filter((t) => t.phase === p).map((t) => t.name);
    if (names.length) return names;
  }
  return [];
}

/** เติมลำดับงานให้ทั้งแผน — ใบที่ตั้ง after ไว้แล้วไม่ทับ (ข้อมูลเก่ายังอยู่เหมือนเดิม) */
export function withAuto<T extends Pick<ProjectTask, "name" | "phase" | "after">>(tasks: T[]): T[] {
  return tasks.map((t) => (t.after ? t : { ...t, after: autoAfter(tasks, t.phase) }));
}

/**
 * งานก่อนหน้าที่ยังไม่ผ่านของใบนี้ — ว่างคือเริ่มได้
 * รอเฉพาะใบที่ยังไม่เคยส่ง ใบที่ส่งแล้ว ถูกตีกลับ หรือผ่านแล้ว ไม่ย้อนกลับไปรอ
 */
export function blockers(tasks: ProjectTask[], t: ProjectTask): ProjectTask[] {
  if (t.status !== "todo" && t.status !== "doing") return [];
  return (t.after ?? [])
    .map((n) => tasks.find((x) => x.name === n))
    .filter((x): x is ProjectTask => Boolean(x) && !passed(x as ProjectTask));
}

/** ใบนี้ส่งงานได้ไหมตอนนี้ — ตรงกับด่านของฐานข้อมูล */
export const canSend = (tasks: ProjectTask[], t: ProjectTask) => blockers(tasks, t).length === 0;

/** รอตามแผนมากี่วัน — นับจากวันเริ่มที่วางไว้ ยังไม่ถึงวันเริ่มคือ 0 */
export const waitingDays = (t: ProjectTask, today: string) =>
  t.start && t.start <= today ? daysBetween(t.start, today) : 0;

/** รอข้อมูลที่กดเองมากี่วัน — นับจากวันที่กด */
export const manualWaitDays = (t: Pick<ProjectTask, "waitingOn">, today: string) =>
  t.waitingOn ? Math.max(0, daysBetween(t.waitingOn.since.slice(0, 10), today)) : 0;

/** ข้อความสั้น ๆ บอกว่ารออะไรอยู่ — ใช้บนชิปของใบงาน */
export function waitText(tasks: ProjectTask[], t: ProjectTask): string {
  const b = blockers(tasks, t);
  if (b.length === 1) return `รอ ${b[0].name}`;
  if (b.length > 1) return `รองานก่อนหน้า ${b.length} ใบ`;
  return "";
}
