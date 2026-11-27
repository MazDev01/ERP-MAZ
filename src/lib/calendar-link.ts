"use client";

/*
 * เชื่อมปฏิทินกับ Google Calendar (Requirement รอบ 10, 12 · รอบที่ 141)
 *
 * ทำสองทางที่ไม่ต้องใช้กุญแจของ Google เลย ใช้ได้ทันทีกับบัญชีไหนก็ได้
 *   1. ลิงก์ "เพิ่มลง Google Calendar" — เปิดหน้าเพิ่มกิจกรรมของ Google พร้อมกรอกข้อมูลให้แล้ว
 *   2. ไฟล์ .ics — เปิดได้ทั้ง Google Calendar, Outlook, ปฏิทินของ iPhone (นำเข้าทีละเดือน)
 *
 * ยังไม่ใช่การซิงก์สองทาง (แก้ในระบบแล้วปฏิทินเปลี่ยนตามเอง)
 * ทางนั้นต้องต่อ Google Calendar API ด้วย OAuth ซึ่งรอกุญแจชุดเดียวกับ Google Drive (รอบที่ 131)
 * ถึงตอนนั้นค่อยเพิ่มได้โดยไม่ต้องรื้อของเดิม เพราะหน้าจอเรียกผ่านไฟล์นี้ที่เดียว
 *
 * เวลาทั้งหมดเป็นเวลาไทย — ปฏิทินของ Google อ่าน TZID=Asia/Bangkok ตรง ๆ ได้
 */

const TZ = "Asia/Bangkok";

export type CalEvent = {
  title: string;
  /** วันที่เริ่ม yyyy-mm-dd */
  date: string;
  /** วันที่จบของกิจกรรมข้ามวัน — ไม่ส่งมาคือจบวันเดียวกัน */
  dateEnd?: string;
  /** เวลา HH:mm — ไม่ส่งมาทั้งคู่ถือเป็นกิจกรรมทั้งวัน */
  from?: string;
  to?: string;
  place?: string;
  detail?: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const digits = (s: string) => s.replace(/\D/g, "");

/** "2026-11-27" + "09:30" → "20261127T093000" (เวลาท้องถิ่น ไม่แปลงโซน) */
function stamp(date: string, time?: string) {
  const d = digits(date);
  if (!time) return d;
  const t = digits(time).padEnd(4, "0").slice(0, 4);
  return `${d}T${t}00`;
}

/** วันถัดไปของกิจกรรมทั้งวัน — ปฏิทินนับวันจบแบบไม่รวมวันนั้น */
function nextDay(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const nd = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  nd.setUTCDate(nd.getUTCDate() + 1);
  return `${nd.getUTCFullYear()}${pad(nd.getUTCMonth() + 1)}${pad(nd.getUTCDate())}`;
}

/** ช่วงเวลาของกิจกรรมในรูปที่ Google กับ .ics ใช้ร่วมกัน */
function span(e: CalEvent) {
  const allDay = !e.from || !e.to;
  if (allDay) {
    return { allDay, start: digits(e.date), end: nextDay(e.dateEnd || e.date) };
  }
  return { allDay, start: stamp(e.date, e.from), end: stamp(e.dateEnd || e.date, e.to) };
}

/**
 * ลิงก์เพิ่มกิจกรรมใน Google Calendar — เปิดแท็บใหม่แล้วกดบันทึกในปฏิทินของตัวเอง
 * ใช้ปฏิทินของบัญชีที่ล็อกอิน Google อยู่ ไม่ต้องตั้งค่าอะไรในระบบเรา
 */
export function gcalUrl(e: CalEvent) {
  const t = span(e);
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${t.start}/${t.end}`,
    ctz: TZ,
  });
  if (e.place) p.set("location", e.place);
  if (e.detail) p.set("details", e.detail);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

const esc = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** ตัดบรรทัดตามข้อกำหนด iCalendar (ไม่เกิน 75 ไบต์ต่อบรรทัด) */
function fold(line: string) {
  const out: string[] = [];
  let buf = "";
  let bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > 73) {
      out.push(buf);
      buf = " ";
      bytes = 1;
    }
    buf += ch;
    bytes += n;
  }
  out.push(buf);
  return out.join("\r\n");
}

/** ไฟล์ .ics ของกิจกรรมหลายรายการ — นำเข้าปฏิทินทีเดียวทั้งเดือน */
export function icsOf(events: CalEvent[], name = "MAZ") {
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ERP MAZ//TH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`,
    `X-WR-TIMEZONE:${TZ}`,
  ];
  events.forEach((e, i) => {
    const t = span(e);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:maz-${digits(e.date)}-${i}@erp.mazmaker.com`);
    lines.push(`DTSTAMP:${now}`);
    if (t.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${t.start}`);
      lines.push(`DTEND;VALUE=DATE:${t.end}`);
    } else {
      lines.push(`DTSTART;TZID=${TZ}:${t.start}`);
      lines.push(`DTEND;TZID=${TZ}:${t.end}`);
    }
    lines.push(fold(`SUMMARY:${esc(e.title)}`));
    if (e.place) lines.push(fold(`LOCATION:${esc(e.place)}`));
    if (e.detail) lines.push(fold(`DESCRIPTION:${esc(e.detail)}`));
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

/** โยนไฟล์ .ics ให้เบราว์เซอร์ดาวน์โหลด แล้วนำเข้าปฏิทินที่ไหนก็ได้ */
export function downloadIcs(filename: string, events: CalEvent[], name?: string) {
  const blob = new Blob([icsOf(events, name)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
