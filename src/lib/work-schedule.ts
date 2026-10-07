import { bkkNow, bkkOf, fromBkk } from "./format";
import { settings, settingsLive } from "./system-settings";
/*
 * เวลาทำงานของบริษัท — ผู้ดูแลระบบตั้งได้ที่ /admin/schedule (เก็บใน system-settings.ts)
 *
 * เป็น getter ทุกช่อง อ่านค่าล่าสุดทุกครั้งที่ใช้ ห้ามเอาไปคำนวณเก็บเป็นค่าคงที่ระดับไฟล์
 * ไม่งั้นพอผู้ดูแลแก้เวลา หน้าที่โหลดไว้แล้วจะยังคิดด้วยเวลาเก่า
 */
/*
 * บางบทบาทเข้า-ออกไม่ตรงกับเวลาบริษัท (แม่บ้าน 08:00–17:00) — ตั้งไว้ที่ schedule.shifts
 * ไม่ส่งบทบาทมา = คนที่ล็อกอินอยู่ · ส่วนพักกลางวันกับวันตัดรอบใช้ของบริษัทชุดเดียว
 */
let shiftRole = "";

/*
 * บทบาทของคนที่ล็อกอินอยู่ — role.ts ส่งเข้ามาให้ (ไฟล์นี้ import role.ts ไม่ได้ เพราะวนกับ hr-data)
 * ฝั่งเซิร์ฟเวอร์ไม่มีใครล็อกอิน จึงเป็นค่าว่าง = ใช้เวลาบริษัท
 */
export function setShiftRole(role: string) {
  shiftRole = role;
}

export function roleShift(role: string = shiftRole) {
  const sc = settings().schedule;
  /* ก่อน goLive วาดด้วยเวลาบริษัทเหมือนฝั่งเซิร์ฟเวอร์ ไม่งั้น hydrate ไม่ตรง (ดู system-settings) */
  const own = settingsLive() ? sc.shifts?.[role] : undefined;
  return { start: own?.start ?? sc.start, end: own?.end ?? sc.end };
}

/** เวลาเริ่มนับโอทีของบทบาทนั้น — ห่างจากเวลาเลิกงานเท่ากับของบริษัท (เลิก 18:00 เริ่มโอที 19:00) */
function otStartOf(role: string = shiftRole) {
  const sc = settings().schedule;
  const gap = minutesOfDay(sc.otStart) - minutesOfDay(sc.end);
  const end = minutesOfDay(roleShift(role).end);
  return hhmmOf(end + gap);
}

function hhmmOf(minute: number) {
  const m = Math.max(0, Math.min(24 * 60, minute));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export const WORK_SCHEDULE = {
  /** เวลาเข้างานของคนที่ล็อกอินอยู่ */
  get start() { return roleShift().start; },
  /** เวลาเลิกงานของคนที่ล็อกอินอยู่ */
  get end() { return roleShift().end; },
  /** ไม่มีผ่อนผันสาย — ผู้ใช้สั่งเอาช่องตั้งค่าออก (18 ก.ย. 2569) เลยเวลาเข้างานนาทีเดียวก็นับว่าสาย
   *  ตรึงเป็น 0 ไว้ ค่าที่เคยตั้งค้างในเครื่องจะได้ไม่ซ่อนการมาสายโดยไม่มีใครเห็น */
  get lateGraceMinutes() { return 0; },
  /** เริ่มพักกลางวัน */
  get lunchStart() { return settings().schedule.lunchStart; },
  /** เลิกพักกลางวัน */
  get lunchEnd() { return settings().schedule.lunchEnd; },
  /** เวลาพักกลางวันที่หักออกจากชั่วโมงทำงาน (นาที) — คิดจากช่วงพัก ไม่ได้ตั้งแยก */
  get breakMinutes() {
    return Math.max(0, minutesOfDay(this.lunchEnd) - minutesOfDay(this.lunchStart));
  },
  /** เวลาเริ่มนับโอทีของวันทำงาน */
  get otStart() { return otStartOf(); },
  /** ถ้ายังไม่ตอกออกหลังเลิกงานเกินกี่ชั่วโมง ให้เตือนว่าอาจลืม */
  get forgotPunchOutAfterHours() { return settings().schedule.forgotPunchOutAfterHours; },
};

/** ชั่วโมงที่ต้องทำงานจริงต่อวัน (เป็นมิลลิวินาที) — ของบทบาทนั้น ไม่ระบุคือคนที่ล็อกอินอยู่ */
export function targetWorkMs(role?: string) {
  const sh = roleShift(role);
  return (
    (minutesOfDay(sh.end) - minutesOfDay(sh.start) - WORK_SCHEDULE.breakMinutes) * 60_000
  );
}

export function minutesOfDay(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * แปลง "HH:MM" เป็นชั่วขณะจริงของวันเดียวกับ `sameDayAs` โดยนับวันและเวลาแบบไทย
 *
 * กะทำงานเป็นเวลาไทย ถ้าอ่านตามเขตเวลาของเครื่อง คนที่ตั้งเครื่องเป็นเขตอื่น
 * จะถูกนับว่าสายหรือไม่สายผิดไปทั้งวัน
 *
 * sameDayAs = ชั่วขณะจริง · ค่าที่คืนก็เป็นชั่วขณะจริง เทียบกับ Date อื่นได้ตรง ๆ
 */
export function scheduleTimeOn(sameDayAs: Date, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const wall = bkkOf(sameDayAs);
  wall.setHours(h, m, 0, 0);
  return fromBkk(wall);
}

/** สายกี่นาที (0 = ไม่สาย) โดยหักเวลาผ่อนผันแล้ว */
export function lateMinutes(punchIn: Date) {
  const start = scheduleTimeOn(punchIn, WORK_SCHEDULE.start);
  const diff = Math.floor((punchIn.getTime() - start.getTime()) / 60_000);
  return diff > WORK_SCHEDULE.lateGraceMinutes ? diff : 0;
}

/** ออกก่อนเวลากี่นาที (0 = ไม่ได้ออกก่อน) */
export function earlyLeaveMinutes(punchOut: Date) {
  const end = scheduleTimeOn(punchOut, WORK_SCHEDULE.end);
  const diff = Math.floor((end.getTime() - punchOut.getTime()) / 60_000);
  return diff > 0 ? diff : 0;
}

/** เลยเวลาเลิกงานมานานจนน่าจะลืมตอกบัตรออกหรือยัง */
export function looksForgotten(openedAt: Date, now: Date) {
  const end = scheduleTimeOn(openedAt, WORK_SCHEDULE.end);
  const hoursPastEnd = (now.getTime() - end.getTime()) / 3_600_000;
  return hoursPastEnd > WORK_SCHEDULE.forgotPunchOutAfterHours;
}

export function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`;
}

// ─── เวลาที่ "ต้อง" เข้า-ออก เมื่อมีใบลาครึ่งวัน ─────────────────────
/** ช่วงเวลาที่ลาไป (นาทีของวัน) */
export type LeaveWindow = { from: number; to: number } | null;

/** ครึ่งวันเช้า = 09:00–12:00 · ครึ่งวันบ่าย = 13:00–18:00 — พักกลางวันไม่ใช่เวลาลา */
const lunchFrom = () => minutesOfDay(WORK_SCHEDULE.lunchStart);
const lunchTo = () => minutesOfDay(WORK_SCHEDULE.lunchEnd);

/** ลาจบคาบพักกลางวัน → กลับเข้างานหลังพัก ไม่ใช่ตอนลาหมดพอดี */
function backAfterLunch(minute: number) {
  return minute >= lunchFrom() && minute < lunchTo() ? lunchTo() : minute;
}

/** ลาเริ่มคาบพักกลางวัน → ออกได้ตั้งแต่ก่อนพัก เพราะช่วงพักไม่ใช่เวลาทำงานอยู่แล้ว */
function leaveBeforeLunch(minute: number) {
  return minute > lunchFrom() && minute <= lunchTo() ? lunchFrom() : minute;
}

/** แปลงใบลาของวันนั้นเป็นช่วงเวลาที่ไม่ต้องอยู่ทำงาน */
export function leaveWindowOf(
  leave:
    | {
        days: number;
        half?: "morning" | "afternoon";
        startMin?: number;
        endMin?: number;
      }
    | undefined,
): LeaveWindow {
  if (!leave) return null;
  const start = minutesOfDay(WORK_SCHEDULE.start);
  const end = minutesOfDay(WORK_SCHEDULE.end);
  // เวลาที่ระบุเองมาก่อนเสมอ
  if (leave.startMin != null && leave.endMin != null) {
    return { from: leave.startMin, to: leave.endMin };
  }
  if (leave.half === "morning") return { from: start, to: lunchFrom() };
  if (leave.half === "afternoon") return { from: lunchTo(), to: end };
  return { from: start, to: end };
}

/** ลาคลุมทั้งกะ = ไม่ต้องมาทำงานวันนั้น */
export function isFullDayLeave(leave: LeaveWindow) {
  return Boolean(
    leave &&
      leave.from <= minutesOfDay(WORK_SCHEDULE.start) &&
      leave.to >= minutesOfDay(WORK_SCHEDULE.end),
  );
}

/**
 * ลาคาบเวลาเข้างาน → เริ่มงานตอนลาหมด
 * ลาทั้งวันให้กะยุบเป็นศูนย์ ไม่งั้นจะได้กะกลับหัวแบบ 18:00–09:00
 */
export function expectedInMinutes(leave: LeaveWindow) {
  const start = minutesOfDay(WORK_SCHEDULE.start);
  if (isFullDayLeave(leave)) return start;
  return leave && leave.from <= start && leave.to > start
    ? backAfterLunch(leave.to)
    : start;
}

/** ลาคาบเวลาเลิกงาน → เลิกได้ตอนลาเริ่ม */
export function expectedOutMinutes(leave: LeaveWindow) {
  const start = minutesOfDay(WORK_SCHEDULE.start);
  const end = minutesOfDay(WORK_SCHEDULE.end);
  if (isFullDayLeave(leave)) return start;
  return leave && leave.to >= end && leave.from < end
    ? leaveBeforeLunch(leave.from)
    : end;
}

/** หักพักกลางวันเฉพาะกะที่คร่อมเวลาพัก */
export function breakMinutesFor(inMin: number, outMin: number) {
  return inMin < lunchTo() && outMin > lunchFrom() ? WORK_SCHEDULE.breakMinutes : 0;
}

/** ต้องทำงานกี่นาทีในวันนั้น (หลังหักวันลาและพักกลางวัน) */
export function requiredMinutes(leave: LeaveWindow) {
  const a = expectedInMinutes(leave);
  const b = expectedOutMinutes(leave);
  return Math.max(0, b - a - breakMinutesFor(a, b));
}

/** นาทีที่เท่าไรของวัน นับตามหน้าปัดไทย — รับ "ชั่วขณะจริง" เท่านั้น */
export function minutesOfTime(instant: Date) {
  const wall = bkkOf(instant);
  return wall.getHours() * 60 + wall.getMinutes();
}

/**
 * นาทีของวันตอนนี้ตามหน้าปัดไทย
 * มีไว้เพราะ minutesOfTime(bkkNow()) แปลงเขตเวลาซ้ำ — เครื่องนอกไทยจะเพี้ยนไป 7 ชั่วโมง
 */
export function minutesNow() {
  const wall = bkkNow();
  return wall.getHours() * 60 + wall.getMinutes();
}

export function formatMinutesOfDay(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * กะของวันนั้นหลังหักวันลา (เป็นนาทีของวัน)
 * ลาคาบเวลาเข้า → เริ่มช้าลง · ลาคาบเวลาเลิก → เลิกเร็วขึ้น
 */
export function shiftOf(leave: LeaveWindow) {
  return { in: expectedInMinutes(leave), out: expectedOutMinutes(leave) };
}

/**
 * ชั่วโมงที่คิดเงินของวัน (นาที) — ตรงกับกติกาในหน้าตอกบัตร
 * มาก่อนกะ → เริ่มนับที่เวลากะ · อยู่เกินกะ → หยุดนับที่เวลาเลิก · หักพักเที่ยงเฉพาะส่วนที่คร่อมจริง
 * กะเต็ม 09:00–18:00 จึงได้ไม่เกิน 8 ชม. เสมอ — เวลาที่เกินไม่นับเข้าเงินเดือน (เป็นเรื่องของใบขอโอที)
 */
export function workedMinutesOf(
  inMin: number | null,
  outMin: number | null,
  leave: LeaveWindow,
) {
  if (inMin == null || outMin == null) return 0;
  const s = shiftOf(leave);
  const start = Math.max(inMin, s.in);
  const end = Math.min(outMin, s.out);
  if (end <= start) return 0;
  const lunch = Math.max(0, Math.min(end, lunchTo()) - Math.max(start, lunchFrom()));
  return end - start - lunch;
}

/**
 * ชั่วโมงที่อยู่จริง (นาที) — ตั้งแต่ตอกเข้าถึงตอกออก หักพักเที่ยงเฉพาะส่วนที่คร่อม
 * ใช้แสดงผลเท่านั้น · เงินเดือนคิดจาก workedMinutesOf ที่ตัดให้อยู่ในกะ
 */
export function actualMinutesOf(inMin: number | null, outMin: number | null) {
  if (inMin == null || outMin == null || outMin <= inMin) return 0;
  const lunch = Math.max(0, Math.min(outMin, lunchTo()) - Math.max(inMin, lunchFrom()));
  return outMin - inMin - lunch;
}

/** ชั่วโมงเป็นข้อความสั้น เช่น "7.5 ชม." */
export function hoursText(minutes: number) {
  return `${(minutes / 60).toFixed(1)} ชม.`;
}
