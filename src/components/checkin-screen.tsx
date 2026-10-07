"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  currentStatus,
  dayKey,
  formatClock,
  formatThaiDate,
  formatTime,
  newId,
  recordsOfDay,
  toSessions,
  workedMsOfDay,
  actualMsOfDay,
  type PunchRecord,
} from "@/lib/attendance";
import {
  addRecord,
  getClockServerSnapshot,
  getClockSnapshot,
  getRecordsServerSnapshot,
  getRecordsSnapshot,
  subscribeClock,
  subscribeRecords,
} from "@/lib/attendance-store";
import { bkkOf, toIsoDate, thaiDate, TH_MONTHS_FULL } from "@/lib/format";
import { leavesOnDate, useLeaveRecords } from "@/lib/leave-store";
import { useRole } from "@/lib/role";
import { canVisit } from "@/lib/nav";
import { expectedInMinutes, expectedOutMinutes, formatMinutes, formatMinutesOfDay, leaveWindowOf, looksForgotten, minutesOfTime, requiredMinutes } from "@/lib/work-schedule";
import { popupOn, useNotifySettings } from "@/lib/notify-settings";
import { areaSettings, freshFix, judge, locate, meters, useLiveGeo, type LiveGeo, type PunchGeo } from "@/lib/work-area";
import { ChevronLeftIcon, ChevronRightIcon, ClockIcon, LeaveIcon, LoginIcon, PinIcon, PlusIcon, PowerIcon } from "./icons";

const DOW_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

/* เวลาที่เตือนล่วงหน้ามาจากตั้งค่าในหน้าโปรไฟล์ ไม่ใช่ค่าคงที่ในหน้านี้ */

/** ขั้นตรวจพื้นที่ตอนกดเข้างาน — null คือไม่ได้อยู่ระหว่างตรวจ */
type Check =
  | { phase: "locating" }
  /* อยู่นอกพื้นที่ หรือหาพิกัดไม่ได้ — error มีค่าเมื่อหาพิกัดไม่ได้ */
  | { phase: "outside"; geo: PunchGeo; error?: string };

export function CheckinScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const records = useSyncExternalStore(
    subscribeRecords,
    getRecordsSnapshot,
    getRecordsServerSnapshot,
  );
  const tick = useSyncExternalStore(
    subscribeClock,
    getClockSnapshot,
    getClockServerSnapshot,
  );
  const leaveRecords = useLeaveRecords();
  const role = useRole();
  /* บางบทบาทไม่มีหน้าโอทีและหน้าบันทึกเวลาทั้งเดือน (แม่บ้าน · นักศึกษาฝึกงาน)
     ปุ่มที่พาไปหน้าที่เขาเปิดไม่ได้ต้องไม่ขึ้นเลย (พบตอนไล่กดลิงก์ 7 ต.ค. 2569) */
  const canOt = canVisit("/ot", role);
  const canRecords = canVisit("/records", role);
  const now = useMemo(() => (tick ? new Date(tick) : null), [tick]);

  const [popOpen, setPopOpen] = useState(false);
  const notify = useNotifySettings();
  const [done, setDone] = useState<{ title: string; note: string } | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  /* ปิดกล่องระหว่างรอพิกัดแล้วผลมาทีหลัง ต้องไม่บันทึกเข้างานเอง — นับรอบไว้เทียบ */
  const attempt = useRef(0);

  const today = now ? dayKey(now) : null;
  const todayRecords = today ? recordsOfDay(records, today) : [];
  const { isWorking } = currentStatus(records);
  // ตอกได้หลายรอบต่อวัน จึงต้องโชว์รอบล่าสุดเสมอ ไม่งั้นกดแล้วเลขไม่ขยับ
  const lastIn = [...todayRecords].reverse().find((r) => r.type === "in") ?? null;
  const lastOut = [...todayRecords].reverse().find((r) => r.type === "out") ?? null;
  const checkedOut = !isWorking && Boolean(lastOut);
  /* ตำแหน่งสดสำหรับป้ายสถานะ — ติดตามเฉพาะตอนยังไม่ได้เข้างาน */
  const live = useLiveGeo(!isWorking);
  const rounds = toSessions(todayRecords).length;

  const leave = today ? leavesOnDate(leaveRecords, today)[0] : undefined;
  const leaveWindow = leaveWindowOf(leave);
  const expectIn = expectedInMinutes(leaveWindow);
  const expectOut = expectedOutMinutes(leaveWindow);
  const requiredMin = requiredMinutes(leaveWindow);

  const mode: "in" | "out" = isWorking ? "out" : "in";

  /*
   * ตัวเลขของหน้าจอมือถือ (ตามแบบ checkin.html) — ใช้สูตรชุดเดียวกับจอคอม ไม่ได้คิดใหม่
   * weekDays   เจ็ดวันของสัปดาห์นี้ วันไหนตอกครบเข้า-ออกแล้วติดดาว
   */
  /* ชื่อที่ทำงานกับรัศมี อ่านจากที่ผู้ดูแลตั้งไว้ ไม่ใช่ข้อความตายตัวในหน้านี้ */
  /* อ่านผ่านฮุก ไม่ใช่ areaSettings() ตรง ๆ — ค่าที่ผู้ดูแลแก้ไว้อยู่ใน localStorage
     ถ้าอ่านตอนเรนเดอร์ ฝั่งเซิร์ฟเวอร์จะได้ค่าตั้งต้น คนละค่ากับฝั่งเครื่อง (hydration ไม่ตรง) */
  /*
   * วันที่กำลังดูอยู่ในแถบสัปดาห์ (เจ้าของสั่ง 25 ก.ย. 2569 ให้กดย้อนดูวันก่อนหน้าได้)
   * ว่าง = วันนี้ · เลือกวันย้อนหลังแล้วสามช่องเวลาเปลี่ยนตามวันนั้น
   * ตอกบัตรได้เฉพาะวันนี้ วันย้อนหลังจึงเป็นแค่การดู ไม่มีปุ่มกด
   */
  const [seeDay, setSeeDay] = useState("");
  const viewDay = seeDay && seeDay !== today ? seeDay : today;
  const viewIsToday = viewDay === today;
  const viewRecords = viewDay ? recordsOfDay(records, viewDay) : [];
  const viewLeave =
    viewIsToday || !viewDay ? leaveWindow : leaveWindowOf(leavesOnDate(leaveRecords, viewDay)[0]);
  const viewIn = [...viewRecords].reverse().find((r) => r.type === "in") ?? null;
  const viewOut = [...viewRecords].reverse().find((r) => r.type === "out") ?? null;
  const viewWorked = viewDay
    ? Math.round(workedMsOfDay(viewRecords, viewIsToday ? (tick ?? 0) : 0, viewLeave) / 60000)
    : 0;

  /* เลื่อนดูสัปดาห์ก่อนหน้า/ถัดไปได้ (ต้นแบบมือถือชุดใหม่ 30 ก.ย. 2569) */
  const [weekOffset, setWeekOffset] = useState(0);
  const weekDays = (() => {
    if (!now) return [];
    const base = bkkOf(now);
    const start = new Date(base);
    start.setDate(base.getDate() - base.getDay() + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = toIsoDate(d);
      const rows = recordsOfDay(records, iso);
      return {
        iso,
        day: d.getDate(),
        dow: DOW_SHORT[d.getDay()],
        weekend: d.getDay() % 6 === 0,
        today: iso === today,
        /* ติดดาวเมื่อวันนั้นตอกครบทั้งเข้าและออก — เห็นทั้งสัปดาห์ว่ามีวันไหนค้าง */
        done: rows.some((r) => r.type === "in") && rows.some((r) => r.type === "out"),
      };
    });
  })();

  /*
   * ลืมตอกบัตรออก — เลยเวลาเลิกงานเกินที่ผู้ดูแลตั้งไว้แต่ยังไม่ตอกออก แจ้งเข้า LINE ให้เจ้าตัว
   * ส่งจากหน้าจอที่เปิดอยู่เท่านั้น (ยังไม่มีตัวตั้งเวลาฝั่งเซิร์ฟเวอร์) และส่งได้วันละครั้ง
   */
  const forgot =
    isWorking && now != null && lastIn != null && looksForgotten(new Date(lastIn.at), now);
  useEffect(() => {
  }, [forgot, today, role]);

  const leaveText = leaveWindow
    ? `ลา ${formatMinutesOfDay(leaveWindow.from)}–${formatMinutesOfDay(leaveWindow.to)} น.`
    : "";

  const popAt = now;
  const popMode = mode;
  const popLeave = leaveWindow;
  const popExpectOut = expectedOutMinutes(popLeave);
  const popMin = popAt ? minutesOfTime(popAt) : 0;
  const popEarly = popMode === "out" ? Math.max(0, popExpectOut - popMin) : 0;

  function closePop() {
    attempt.current += 1;
    setPopOpen(false);
    setDone(null);
    setCheck(null);
  }

  function homeNote() {
    if (requiredMin === 0 && leaveWindow)
      return "วันนี้คุณลาทั้งวัน ไม่ต้องตอกบัตร — ถ้าเข้ามาทำงานก็ตอกได้ตามปกติ";
    if (checkedOut)
      return "ออกงานแล้ววันนี้ — ถ้ากลับเข้ามาทำงานต่อ กดเข้างานได้อีก";
    if (isWorking) {
      if (!popupOn(notify, "checkout"))
        return `เลิกงานเวลา ${formatMinutesOfDay(expectOut)} น. · ปิดการเตือนเช็คเอาท์ไว้`;
      const outAt = formatMinutesOfDay(Math.max(0, expectOut - notify.leadOut));
      return `ระบบจะเตือนให้เช็คเอาท์เวลา ${outAt} น.`;
    }
    const head = leaveWindow
      ? `${leaveText} · เริ่มงาน ${formatMinutesOfDay(expectIn)} น. · `
      : "";
    if (!popupOn(notify, "checkin"))
      return `${head}ปิดการเตือนเช็คอินไว้ — กดเข้างานเองได้ตลอด`;
    const lead = formatMinutesOfDay(Math.max(0, expectIn - notify.leadIn));
    return `${head}ระบบจะเตือนเวลา ${lead} น.`;
  }

  /* ข้อความใต้ปุ่มวงกลม — ตรรกะเดียวกับป้ายพื้นที่ของจอคอม (AreaBadge) */
  const areaText = (() => {
    if (isWorking) return lastIn?.geo?.status === "inside" ? "เข้างานในพื้นที่ทำงาน" : "กำลังทำงานอยู่";
    if (checkedOut && live.phase !== "ready") return "ออกงานแล้ววันนี้";
    if (live.phase === "locating") return "กำลังค้นหาพื้นที่ทำงาน…";
    if (live.phase === "error") return "เปิดตำแหน่งเพื่อเข้างาน";
    if (live.geo.status === "inside") return "อยู่ในพื้นที่ทำงาน";
    if (live.geo.status === "weak") return "สัญญาณ GPS ไม่แม่น";
    return `อยู่นอกพื้นที่ · ห่าง ${meters(live.geo.dist ?? 0)}`;
  })();

  /* ชื่อเดือนของสัปดาห์ที่กำลังดู — ใช้วันกลางสัปดาห์กันเดือนคาบเกี่ยว */
  const weekTitle = weekDays.length
    ? `${TH_MONTHS_FULL[Number(weekDays[3].iso.slice(5, 7)) - 1]} ${Number(weekDays[3].iso.slice(0, 4)) + 543}`
    : "";

  /*
   * กดเข้างาน — ขอพิกัดก่อนทุกครั้ง อยู่ในรัศมีของที่ทำงานก็บันทึกเลยเหมือนเดิม
   * อยู่นอกรัศมีเข้างานไม่ได้ (ผู้ใช้สั่ง) — ขึ้นกล่องบอกระยะ ให้ลองตรวจใหม่เมื่อถึงที่ทำงาน
   * อ่านที่ทำงานสด ๆ ตอนกด ไม่ใช่จากตอนเปิดหน้า เผื่อผู้ดูแลเพิ่งแก้
   */
  async function checkIn() {
    const rules = areaSettings();
    const mine = ++attempt.current;
    setCheck({ phase: "locating" });
    /* มีพิกัดสดจากป้ายสถานะอยู่แล้ว ใช้ต่อได้เลย ไม่ต้องรอเครื่องหาใหม่ */
    const recent = freshFix(live);
    const got = recent ? { fix: recent } : await locate();
    if (mine !== attempt.current) return;
    if ("error" in got) {
      setCheck({ phase: "outside", geo: { status: "nogps" }, error: got.error });
      return;
    }
    const geo = judge(got.fix, rules);
    if (geo.status === "inside") {
      setCheck(null);
      confirm(geo);
      return;
    }
    setCheck({ phase: "outside", geo });
  }

  function confirm(geo?: PunchGeo) {
    /* ตอนรอพิกัดนาฬิกาเดินไปแล้ว — ใช้เวลาตอนที่บันทึกจริง ไม่ใช่ตอนกดปุ่ม */
    const at = geo ? new Date() : popAt;
    if (!at) return;

    const record: PunchRecord = {
      id: newId(),
      type: popMode,
      at: at.toISOString(),
      note: geo?.why ?? "",
      ...(geo ? { geo } : {}),
    };
    addRecord(record);
    setCheck(null);

    const t = `${formatClock(at)} น.`;
    if (popMode === "out") {
      const dayList = [...todayRecords, { id: "preview", type: "out" as const, at: at.toISOString(), note: "" }];
      /* แสดงชั่วโมงจริง · ที่ขาดคิดจากชั่วโมงในกะเหมือนตอนคิดเงิน */
      const worked = Math.round(actualMsOfDay(dayList, at.getTime()) / 60_000);
      const paid = Math.round(workedMsOfDay(dayList, at.getTime(), popLeave) / 60_000);
      const missing = Math.max(0, requiredMinutes(popLeave) - paid);
      setDone(
        popEarly > 0
          ? {
              title: "บันทึกออกก่อนเวลา",
              note: `ออกงาน ${t} · ทำงาน ${formatMinutes(worked)}${missing ? ` · ขาด ${formatMinutes(missing)}` : ""}`,
            }
          : {
              title: "เช็คเอาท์สำเร็จ",
              note: `บันทึกเวลาออกงาน ${t} เรียบร้อย`,
            },
      );
    } else {
      setDone({
        title: "เช็คอินสำเร็จ",
        note:
          geo?.status === "inside"
            ? `บันทึกเวลาเข้างาน ${t} · อยู่ในพื้นที่ทำงาน`
            : `บันทึกเวลาเข้างาน ${t} เรียบร้อย`,
      });
    }

    setTimeout(closePop, 1900);
  }

  return (
    <div
      className={
        embedded
          ? ""
          : "flex min-h-dvh items-center justify-center p-0 sm:p-8"
      }
    >
      {/*
        ── โหมดมือถือ (ทำตามแบบ checkin.html · เจ้าของสั่ง 25 ก.ย. 2569) ──
        แถบสัปดาห์ติดดาว · การ์ดพื้นที่ทำงาน · หน้าปัดวงกลมใหญ่ · สามช่องเวลา
        ตัวเลขและกติกาใช้ชุดเดียวกับจอคอมทั้งหมด เปลี่ยนแค่วิธีแสดงผล
      */}
      <div className="w-full space-y-3.5 md:hidden">
        {/* หัวหน้าจอ: เดือนของสัปดาห์ที่ดูอยู่ + ปุ่มขอโอที (ต้นแบบ checkin ชุดใหม่ 30 ก.ย. 2569) */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <LeaveIcon className="size-[19px] flex-none text-primary" strokeWidth={2.2} />
              <b className="truncate text-[19px] font-bold">{weekTitle}</b>
              <button
                type="button"
                aria-label="สัปดาห์ก่อน"
                onClick={() => setWeekOffset((v) => v - 1)}
                className="glass-thin grid size-8 flex-none place-items-center rounded-full"
              >
                <ChevronLeftIcon className="size-4" strokeWidth={2.4} />
              </button>
              <button
                type="button"
                aria-label="สัปดาห์ถัดไป"
                disabled={weekOffset >= 0}
                onClick={() => setWeekOffset((v) => v + 1)}
                className="glass-thin grid size-8 flex-none place-items-center rounded-full disabled:opacity-40"
              >
                <ChevronRightIcon className="size-4" strokeWidth={2.4} />
              </button>
            </div>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {now ? formatThaiDate(now) : "—"}
              {now && <span className="num"> · {formatClock(now)} น.</span>}
            </p>
          </div>
          {canOt && <Link
            href="/ot?new=1"
            className="glass-thin flex h-9 flex-none items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold"
          >
            ขอโอที
            <PlusIcon className="size-3.5" strokeWidth={2.4} />
          </Link>}
        </div>

        <nav className="grid grid-cols-7 gap-1.5" aria-label="สัปดาห์นี้">
          {weekDays.map((d) => (
            /* กดวันย้อนหลังเพื่อดูเวลาของวันนั้น — วันข้างหน้ายังไม่มีอะไรให้ดู จึงกดไม่ได้ */
            <button
              key={d.iso}
              type="button"
              disabled={!today || d.iso > today}
              onClick={() => setSeeDay(d.iso === today ? "" : d.iso)}
              aria-current={d.iso === viewDay ? "date" : undefined}
              aria-label={`ดูเวลาของวันที่ ${d.day}`}
              className={`relative flex flex-col items-center gap-0.5 rounded-2xl border-[1.5px] py-2 text-[15px] font-semibold disabled:opacity-45 ${
                d.iso === viewDay
                  ? "border-primary bg-card shadow-[0_8px_16px_-10px_rgba(208,2,27,.7)]"
                  : d.weekend
                    ? "border-transparent bg-transparent text-muted-foreground"
                    : "border-border bg-card"
              }`}
            >
              {d.day}
              <em
                className={`text-[10.5px] font-medium not-italic ${
                  d.iso === viewDay ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {d.dow}
              </em>
              {d.done && (
                /* ดาวบอกว่าวันนั้นลงเวลาครบทั้งเข้าและออก เห็นทั้งสัปดาห์ว่ามีวันไหนค้าง */
                <svg
                  viewBox="0 0 24 24"
                  className="absolute -top-[7px] -right-[5px] size-5"
                  role="img"
                  aria-label="ลงเวลาครบ"
                >
                  <path
                    d="M12 2.6l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"
                    fill="#f5b21b"
                    stroke="#ffffff"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          ))}
        </nav>


        {/*
          ปุ่มตอกบัตรเป็นวงกลมใหญ่กลางจอ (ต้นแบบมือถือชุดใหม่ 30 ก.ย. 2569)
          ข้อความใต้ปุ่มบอกสถานะพื้นที่ทำงาน ไม่ต้องมีการ์ดแยกอีกใบ
        */}
        {viewIsToday ? (
          <div className="relative flex justify-center py-3">
            {/* วงแหวนกระเพื่อมรอบปุ่ม — ต้นแบบมือถือ (30 ก.ย. 2569) พร้อมแสงฟุ้งด้านหลัง
               กระเพื่อมเฉพาะตอนที่ยังกดได้ ไม่งั้นจะกวนสายตาตอนทำงานอยู่ */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-1/2 size-[320px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ background: "radial-gradient(circle, rgba(208,2,27,.18) 0%, rgba(208,2,27,0) 62%)" }}
            />
            {!isWorking && now && (
              <>
                <span
                  aria-hidden="true"
                  className="animate-punch-ping pointer-events-none absolute top-1/2 left-1/2 size-[236px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/25"
                />
                <span
                  aria-hidden="true"
                  className="animate-punch-ping pointer-events-none absolute top-1/2 left-1/2 size-[236px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20"
                  style={{ animationDelay: "1.1s" }}
                />
              </>
            )}
            <button
              type="button"
              disabled={!now}
              onClick={() => {
                setPopOpen(true);
                if (!isWorking) void checkIn();
              }}
              className={`relative grid size-[230px] place-items-center rounded-full text-center transition-transform active:scale-[0.98] disabled:opacity-50 ${
                isWorking
                  ? "bg-[var(--brand-700)] text-white shadow-[0_18px_40px_-16px_rgb(120_20_35/0.75)]"
                  : "bg-card text-foreground shadow-[0_18px_40px_-16px_rgb(208_2_27/0.55)]"
              }`}
            >
              <span className="px-6">
                <b className="block text-[30px] leading-tight font-bold">
                  {isWorking ? "ออกงาน" : "เข้างาน"}
                </b>
                <em className="mt-1.5 block text-[12.5px] leading-snug font-medium not-italic opacity-80">
                  {areaText}
                </em>
              </span>
            </button>
          </div>
        ) : (
          /* วันย้อนหลังตอกบัตรไม่ได้ — สรุปของวันนั้นแทนปุ่ม */
          <section className="glass rounded-[22px] px-5 py-5 text-center">
            <p className="text-[12.5px] text-muted-foreground">{viewDay ? thaiDate(viewDay) : ""}</p>
            <b className="num mt-1 block text-[26px] leading-none font-bold">
              {viewWorked ? formatMinutes(viewWorked) : "ไม่มีบันทึก"}
            </b>
            <button
              type="button"
              onClick={() => setSeeDay("")}
              className="mt-3 rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-[12.5px] font-semibold text-primary"
            >
              กลับไปวันนี้
            </button>
          </section>
        )}

        {/* สามช่องนี้เปลี่ยนตามวันที่เลือกในแถบสัปดาห์ ไม่ได้ผูกกับวันนี้อย่างเดียว */}
        <div className="grid grid-cols-3 gap-2.5">
          <MobStat tone="peach" icon="in" label="เวลาเข้างาน" value={viewIn ? formatClock(new Date(viewIn.at)) : null} />
          <MobStat tone="rose" icon="out" label="เวลาออกงาน" value={viewOut ? formatClock(new Date(viewOut.at)) : null} />
          <MobStat tone="lilac" icon="clock" label="รวมชั่วโมง" value={viewWorked ? formatMinutes(viewWorked) : null} />
        </div>


        {/* ปุ่มเข้าหน้าบันทึกเวลาทั้งเดือน — เห็นทุกขนาดจอ (ผู้ใช้สั่ง 7 ต.ค. 2569)
           เดิมซ่อนบนจอกว้างเพราะมีชิป "บันทึกเวลาของฉัน" อยู่แล้ว แต่หาไม่เจอ */}
        {canRecords && <Link
          href="/records"
          className="btn glass-thin btn-mini w-full justify-center"
        >
          ดูตารางเวลาทำงานทั้งเดือน
          <ChevronRightIcon className="size-3.5" strokeWidth={2.4} />
        </Link>}
      </div>

      {/* การ์ดตอกบัตรของจอกว้าง — เป็น section ไม่ใช่ main เพราะหน้านี้อยู่ใน <main> ของเปลือกแอปอยู่แล้ว
          <main> ซ้อน <main> ผิดมาตรฐาน HTML และโปรแกรมอ่านหน้าจอจะเจอจุดหลักสองจุดในหน้าเดียว */}
      <section
        aria-label="ตอกบัตรเข้า-ออกงาน"
        className={`glass w-full overflow-hidden max-md:hidden lg:grid lg:grid-cols-2 ${
          embedded
            ? "rounded-2xl"
            : "max-w-[460px] rounded-none sm:rounded-[28px] lg:max-w-[920px]"
        }`}
      >

        {/* ── ฝั่งแดง: นาฬิกา ── */}
        <section className="checkin-top relative px-7 pt-[26px] pb-[74px] text-center text-white lg:flex lg:flex-col lg:justify-center lg:px-10 lg:py-14 lg:pb-14">
          <span
            className="pointer-events-none absolute bottom-0 left-1/2 z-0 h-[100px] w-[112%] -translate-x-1/2 translate-y-1/2 rounded-[50%] bg-white lg:top-0 lg:bottom-auto lg:left-full lg:h-full lg:w-[160px] lg:translate-y-0 lg:-translate-x-1/2"
            aria-hidden="true"
          />
          <p className="relative z-10 text-[23px] font-bold tracking-widest opacity-90 lg:text-[26px]">
            MAZ
          </p>
          <p className="relative z-10 mt-4 text-[15px] text-white/80 lg:mt-[26px] lg:text-base">
            {greeting(now)}
          </p>
          <p className="num relative z-10 mt-0.5 text-[38px] leading-tight font-semibold sm:text-[44px] lg:text-[52px]">
            {now ? formatTime(now) : "--:--:--"}
          </p>
          <p className="relative z-10 text-sm text-white/75 lg:text-[15px]">
            {now ? formatThaiDate(now) : "—"}
          </p>
        </section>

        {/* ── ฝั่งขาว: สถานะและปุ่ม ── */}
        <section className="relative z-10 px-6 pt-16 pb-7 text-center sm:px-7 lg:flex lg:flex-col lg:justify-center lg:py-14 lg:pr-12 lg:pl-24">
          <AreaBadge
            checkedOut={checkedOut}
            isWorking={isWorking}
            geo={lastIn?.geo}
            live={live}
          />

          <p className="mt-3.5 text-sm leading-relaxed text-muted-foreground lg:text-[14.5px]">
            {homeNote()}
          </p>

          <button
              type="button"
              disabled={!now}
              onClick={() => {
                /*
                 * เข้างาน = กดแล้วบันทึกเลย ไม่ต้องถามยืนยัน (ยกเว้นอยู่นอกพื้นที่)
                 * ของเดิมขึ้นกล่องถามก่อน ซึ่งกลายเป็นหน้าประจานว่ามาสายทุกเช้าที่มาสาย
                 * และเพิ่มขั้นตอนโดยไม่ได้อะไร เพราะยังไงคนก็กดยืนยันอยู่แล้ว
                 * ออกงานยังถามอยู่ เพราะกดพลาดแล้วเท่ากับจบวันทำงาน ย้อนไม่ได้
                 */
                setPopOpen(true);
                if (!isWorking) void checkIn();
              }}
              className={[
                "mx-auto mt-5 flex h-14 w-full max-w-xs items-center justify-center gap-2.5",
                "rounded-full text-lg font-semibold text-white",
                "transition-transform active:scale-[0.98] disabled:opacity-50",
                isWorking
                  ? "bg-[var(--brand-700)] hover:brightness-110"
                  : "bg-primary hover:bg-primary-hover",
              ].join(" ")}
            >
              <PowerIcon className="size-6" strokeWidth={2} />
              {isWorking ? "ออกงาน" : "เข้างาน"}
            </button>

          <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-[22px] lg:mt-7">
            <Slot
              label={rounds > 1 ? `เข้างาน (รอบที่ ${rounds})` : "เวลาเข้างาน"}
              value={lastIn ? formatClock(new Date(lastIn.at)) : null}
            />
            <Slot
              label="เวลาออกงานล่าสุด"
              value={lastOut ? formatClock(new Date(lastOut.at)) : null}
            />
          </div>

          {/* เห็นทุกจอ รวมตอนฝังอยู่ในหน้าลงเวลางาน (ผู้ใช้สั่ง 7 ต.ค. 2569) */}
          {canRecords && (
            <Link href="/records" className="btn glass-thin btn-mini mt-6">
              ดูตารางเวลาทำงานทั้งเดือน
              <ChevronRightIcon className="size-3.5" strokeWidth={2.4} />
            </Link>
          )}

        </section>
      </section>

      {/* กล่องตอกบัตร — ยิงออกไปที่ body เพราะการ์ดตอกบัตรมี backdrop-filter
          ซึ่งกลายเป็นกรอบอ้างอิงของ position: fixed ทำให้ฉากหลังคลุมแค่การ์ด */}
      {popOpen && popAt && typeof document !== "undefined" &&
        createPortal(
        <div
          className="veil-in fixed inset-0 z-50 flex items-center justify-center bg-[rgb(28_20_45/0.42)] p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pop-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !done) closePop();
          }}
        >
          <div className="pop-in w-full max-w-[340px] rounded-[26px] bg-white px-[26px] pt-0 pb-7 text-center">
            {done ? (
              <div className="pop-rise flex flex-col items-center">
                <div className="relative -mt-12 flex size-[92px] items-center justify-center">
                  <span
                    className="halo absolute size-[92px] rounded-full bg-[var(--success)]"
                    aria-hidden="true"
                  />
                  <svg width="92" height="92" viewBox="0 0 92 92" role="img" aria-label="สำเร็จ">
                    <circle cx="46" cy="46" r="36" fill="#189a30" />
                    <path
                      className="tick"
                      d="M30 47 L41 58 L62 36"
                      fill="none"
                      stroke="#fff"
                      strokeWidth="6.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <h2 className="mt-3.5 text-2xl font-semibold">{done.title}</h2>
                <p className="mt-2 text-[14.5px] text-muted-foreground">{done.note}</p>
              </div>
            ) : check?.phase === "locating" ? (
              <div className="flex flex-col items-center pt-7" aria-live="polite">
                <span className="relative grid size-16 place-items-center rounded-full bg-[var(--warning-soft)] text-primary">
                  <span className="halo absolute size-16 rounded-full bg-primary/25" aria-hidden="true" />
                  <PinIcon className="relative size-7" strokeWidth={2} />
                </span>
                <h2 id="pop-title" className="mt-4 text-xl font-semibold">
                  กำลังตรวจพื้นที่
                </h2>
                <p className="mt-2 text-[14px] text-muted-foreground">
                  ขอตำแหน่งจากเครื่องเพื่อยืนยันว่าอยู่ในพื้นที่ทำงาน
                </p>
                <button
                  type="button"
                  onClick={closePop}
                  className="mt-6 h-[48px] w-full rounded-[24px] bg-secondary text-[15px] font-semibold text-muted-foreground"
                >
                  ยกเลิก
                </button>
              </div>
            ) : check?.phase === "outside" ? (
              <OutsidePanel check={check} onRetry={() => void checkIn()} onCancel={closePop} />
            ) : popMode === "in" ? (
              /* เข้างานที่ไม่ต้องตรวจพื้นที่บันทึกไปแล้ว รอกล่องสำเร็จขึ้น */
              null
            ) : (
              <>
                <div className="-mt-14 flex justify-center">
                  <FaceOut />
                </div>
                <h2 id="pop-title" className="mt-1.5 text-2xl font-semibold">
                  {popEarly > 0 ? "ออกก่อนเวลา" : "เลิกงานแล้ว"}
                </h2>
                <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">
                  {popEarly > 0
                    ? `ออกเวลา ${formatClock(popAt)} น. · เร็วกว่ากำหนด ${formatMinutes(popEarly)}`
                    : "ขอบคุณสำหรับวันนี้ พักผ่อนเยอะ ๆ นะ"}
                </p>

                <div className="mt-[26px] flex gap-3">
                  <button
                    type="button"
                    onClick={closePop}
                    className="h-[54px] flex-1 rounded-[27px] bg-secondary text-base font-semibold text-muted-foreground transition-transform active:scale-95"
                  >
                    ยังไม่ใช่ตอนนี้
                  </button>
                  <button
                    type="button"
                    onClick={() => confirm()}
                    className="btn-solid h-[54px] flex-1 rounded-[27px] text-base font-semibold transition-transform active:scale-95"
                  >
                    เช็คเอาท์
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
          document.body,
        )}
    </div>
  );
}

/** ป้ายบอกสถานะพื้นที่ใต้หัวการ์ด */
function AreaBadge({
  checkedOut,
  isWorking,
  geo,
  live,
}: {
  checkedOut: boolean;
  isWorking: boolean;
  geo?: PunchGeo;
  live: LiveGeo;
}) {
  /* ยังไม่ได้เข้างาน (รวมออกงานแล้ว จะกลับเข้ามาอีกรอบได้) — บอกตามตำแหน่งสดว่าตอนนี้อยู่ในพื้นที่ไหม */
  const where = (): readonly ["neutral" | "success" | "warning", string] => {
    if (live.phase === "locating") return ["neutral", "กำลังตรวจตำแหน่ง…"];
    if (live.phase === "error") return ["warning", "เปิดตำแหน่งเพื่อเข้างาน"];
    const g = live.geo;
    /* ผู้ใช้สั่ง — บอกแค่ว่าอยู่ในพื้นที่ ไม่ต้องต่อท้ายชื่อบริษัท */
    if (g.status === "inside") return ["success", "อยู่ในพื้นที่ทำงาน"];
    if (g.status === "weak") return ["warning", "สัญญาณ GPS ไม่แม่น"];
    return ["warning", `อยู่นอกพื้นที่ทำงาน · ห่าง ${meters(g.dist ?? 0)}`];
  };
  const [tone, text] = isWorking
    ? geo?.status === "inside"
      ? (["success", "เข้างานในพื้นที่ทำงาน"] as const)
      : geo && geo.status !== "off"
        ? (["warning", "เข้างานนอกพื้นที่"] as const)
        : (["success", "กำลังทำงาน"] as const)
    : checkedOut && live.phase !== "ready"
      ? (["neutral", "ออกงานแล้ว"] as const)
      : where();
  const skin = {
    neutral: "bg-[var(--neutral-soft)] text-[var(--neutral)]",
    success: "bg-[var(--success-soft)] text-[var(--success)]",
    warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
  }[tone];
  return (
    <span
      className={`inline-flex max-w-full items-center gap-2.5 self-center rounded-[20px] px-[18px] py-2.5 text-sm font-medium ${skin}`}
    >
      {!isWorking ? (
        <PinIcon className="size-4 shrink-0" strokeWidth={2.2} />
      ) : (
        <i className="size-2 shrink-0 rounded-full bg-current" aria-hidden="true" />
      )}
      {/* ชื่อที่ทำงานยาว — ให้ขึ้นบรรทัดใหม่ ไม่ตัดท้าย คนจะได้เห็นว่าอยู่ในพื้นที่ของที่ไหน */}
      <span className="min-w-0 text-left leading-snug break-words">{text}</span>
    </span>
  );
}

/** กล่องตอนอยู่นอกพื้นที่ หรือหาพิกัดไม่ได้ — เข้างานไม่ได้ ให้ลองตรวจใหม่ */
function OutsidePanel({
  check,
  onRetry,
  onCancel,
}: {
  check: { geo: PunchGeo; error?: string };
  onRetry: () => void;
  onCancel: () => void;
}) {
  const { geo, error } = check;
  const title = error
    ? "หาตำแหน่งไม่ได้"
    : geo.status === "weak"
      ? "สัญญาณ GPS ไม่แม่นพอ"
      : "อยู่นอกพื้นที่ทำงาน";
  const detail = error
    ? error
    : geo.status === "weak"
      ? `ตำแหน่งคลาดเคลื่อนประมาณ ${meters(geo.acc ?? 0)} · ลองขยับไปที่โล่งแล้วตรวจใหม่`
      : `ห่างจากที่ทำงาน ${meters(geo.dist ?? 0)}`;

  return (
    <div className="pt-7 text-left">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-[var(--warning-soft)] text-[var(--warning)]">
        <PinIcon className="size-7" strokeWidth={2} />
      </span>
      <h2 id="pop-title" className="mt-4 text-center text-xl font-semibold">
        {title}
      </h2>
      <p className="mt-2 text-center text-[14px] leading-relaxed text-muted-foreground">{detail}</p>

      <p className="mt-4 rounded-[12px] bg-[var(--destructive-soft)] px-3.5 py-2.5 text-center text-[13px] text-destructive">
        ต้องอยู่ในพื้นที่ทำงานจึงจะเข้างานได้ · ติดต่อหัวหน้าหากทำงานนอกสถานที่
      </p>

      <div className="mt-5 flex gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          className="h-[50px] flex-1 rounded-[25px] bg-secondary text-[15px] font-semibold text-muted-foreground"
        >
          ปิด
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="btn-solid h-[50px] flex-1 rounded-[25px] text-[15px] font-semibold"
        >
          ตรวจใหม่
        </button>
      </div>
    </div>
  );
}

function Slot({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="glass-thin rounded-[14px] px-2.5 py-3.5">
      <span className="block text-[12.5px] text-muted-foreground">{label}</span>
      <b
        className={`num mt-[5px] block text-[21px] ${
          value ? "font-semibold" : "font-normal text-muted-foreground"
        }`}
      >
        {value ?? "--:--"}
      </b>
    </div>
  );
}

/* now เป็นชั่วขณะจริง — ต้องแปลงเป็นหน้าปัดไทยก่อน ไม่งั้นเครื่องนอกไทยทักทายผิดช่วง */
function greeting(now: Date | null) {
  if (!now) return "สวัสดี";
  const h = bkkOf(now).getHours();
  if (h < 12) return "สวัสดี ตอนเช้า";
  if (h < 17) return "สวัสดี ตอนบ่าย";
  return "สวัสดี ตอนเย็น";
}

// ─── หน้าตัวการ์ตูน ───────────────────────────────────────────────
function Dots() {
  return (
    <>
      <circle className="bob" cx="30" cy="44" r="6" fill="#F5A8B2" />
      <circle className="bob b" cx="150" cy="56" r="5" fill="#FAD2D7" />
      <circle className="bob b" cx="26" cy="114" r="4.5" fill="#FAD2D7" />
      <circle className="bob" cx="152" cy="116" r="7" fill="#F5A8B2" />
      <circle cx="88" cy="80" r="48" fill="#FBE6E9" />
    </>
  );
}

function FaceOut() {
  return (
    <svg width="176" height="150" viewBox="0 0 176 150" role="img" aria-label="หน้าเหนื่อยแต่ยิ้ม">
      <Dots />
      <g className="bow">
        <circle cx="88" cy="80" r="42" fill="#EE9A4D" />
        <g fill="none" stroke="#3B3B4F" strokeWidth="3.4" strokeLinecap="round" opacity=".75">
          <path d="M64 60 Q74 56 84 61" />
          <path d="M112 60 Q102 56 92 61" />
        </g>
        <g fill="none" stroke="#3B3B4F" strokeWidth="4" strokeLinecap="round">
          <path d="M66 72 Q74 80 82 72" />
          <path d="M94 72 Q102 80 110 72" />
        </g>
        <ellipse cx="63" cy="88" rx="8" ry="5" fill="#E06A6A" opacity=".55" />
        <ellipse cx="113" cy="88" rx="8" ry="5" fill="#E06A6A" opacity=".55" />
        <path d="M76 94 Q88 106 100 94 Q88 100 76 94 Z" fill="#3B3B4F" />
        <path d="M76 94 Q88 106 100 94" fill="none" stroke="#3B3B4F" strokeWidth="3.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/* ช่องเวลาเล็กสามช่องบนมือถือ (ตามแบบ .ck-stat) — ยังไม่มีค่าก็ยังเห็นหัวข้อ ไม่หายไปทั้งช่อง */
function MobStat({
  tone,
  label,
  value,
  icon,
}: {
  tone: "peach" | "rose" | "lilac";
  label: string;
  value: string | null;
  /* ไอคอนตามต้นแบบ checkin.html — เข้างานเป็นลูกศรเข้า ออกงานเป็นลูกศรออก รวมชั่วโมงเป็นนาฬิกา */
  icon: "in" | "out" | "clock";
}) {
  const skin = {
    peach: "bg-[var(--warning-soft)] text-[var(--warning)]",
    rose: "bg-[var(--destructive-soft)] text-destructive",
    lilac: "bg-[var(--info-soft)] text-[var(--info)]",
  }[tone];
  return (
    <div className="glass flex min-h-[98px] flex-col justify-between rounded-[18px] p-3">
      <span className={`grid size-[30px] place-items-center rounded-[10px] ${skin}`}>
        {icon === "clock" ? (
          <ClockIcon className="size-4" strokeWidth={2.2} />
        ) : (
          <LoginIcon className={`size-4 ${icon === "out" ? "rotate-180" : ""}`} strokeWidth={2.2} />
        )}
      </span>
      <b className={`num mt-2 text-[20px] leading-none font-bold ${value ? "" : "text-muted-foreground"}`}>
        {value ?? "--:--"}
      </b>
      <span className="text-[12px] text-muted-foreground">{label}</span>
    </div>
  );
}
