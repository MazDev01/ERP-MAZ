"use client";

/*
 * เวลาทำงานและจุดลงเวลา (ต้นแบบ HR-15) — หน้าเดียวรวมเวลาเข้า-ออกงานกับพิกัดที่ลงเวลาได้
 *
 * ต่างจากหน้าเดิม (/admin/schedule + /admin/areas) ตรงที่บันทึกพร้อม "วันที่เริ่มใช้ค่าใหม่"
 * ชุดเดิมเก็บเป็นประวัติ ตั้งล่วงหน้าได้ ระบบสลับให้เองเมื่อถึงวัน (settings().attHistory)
 * รอบเงินเดือนที่ปิดไปแล้วแก้ไม่ได้ — วันที่เริ่มใช้ต้องอยู่หลังวันปิดรอบล่าสุด
 */

import { useState } from "react";
import { HR_OT_DIVISOR } from "@/lib/hr-data";
import { AdminHead, Card, Input2, inputCls } from "./admin-ui";
import { AreaMap } from "./area-map";
import { CrosshairIcon } from "./icons";
import { DateField } from "./thai-date-picker";
import { thaiDate, todayIso } from "@/lib/format";
import { minutesOfDay, formatMinutes } from "@/lib/work-schedule";
import { logChange } from "@/lib/admin-log";
import { saveAttFrom, saveRoleShift, useSystemSettings, type AttChange, type LateMode, type RateSettings, type ScheduleSettings } from "@/lib/system-settings";
import { Card as UiCard, Input2 as UiInput2, SaveBar, useSectionDraft } from "./admin-ui";
import { baht, thaiMonth } from "@/lib/format";
import { RADIUS_MAX, RADIUS_MIN, locate, mapLink, saveWorkplace, useAreaSettings, workplaceOf } from "@/lib/work-area";
import { lockedUntil, useHr } from "@/lib/hr-store";
import { ROLES, type Role } from "@/lib/role";

/*
 * รัศมีกรอกเป็น "เมตร" ไม่ใช่กิโลเมตรทศนิยมแบบต้นแบบ
 * ของเดิมต้องพิมพ์ 0.15 เพื่อให้ได้ 150 เมตร ซึ่งคิดในหัวยากและพิมพ์ผิดง่าย
 * (เจ้าของสั่งให้ใช้ง่ายกว่านี้ 16 พ.ย. 2569) ปุ่มระยะที่ใช้บ่อยกดได้เลย
 */
const RADIUS_PICKS = [50, 100, 150, 300, 500];

type Draft = { start: string; end: string; lunchStart: string; lunchEnd: string; lat: string; lng: string; m: string };

function problemOf(d: Draft) {
  const t = (x: string) => minutesOfDay(x);
  if ([d.start, d.end, d.lunchStart, d.lunchEnd].some((x) => !/^\d{2}:\d{2}$/.test(x))) return "กรอกเวลาให้ครบทุกช่อง";
  if (t(d.end) <= t(d.start)) return "เวลาเลิกงานต้องหลังเวลาเข้างาน";
  if (t(d.lunchEnd) <= t(d.lunchStart)) return "เวลาสิ้นสุดพักเที่ยงต้องหลังเวลาเริ่มพัก";
  if (t(d.lunchStart) < t(d.start) || t(d.lunchEnd) > t(d.end)) return "ช่วงพักเที่ยงต้องอยู่ในเวลาทำงาน";
  const lat = Number(d.lat);
  const lng = Number(d.lng);
  const m = Number(d.m);
  if (!(d.lat.trim() && Number.isFinite(lat) && Math.abs(lat) <= 90)) return "ละติจูดต้องอยู่ระหว่าง -90 ถึง 90";
  if (!(d.lng.trim() && Number.isFinite(lng) && Math.abs(lng) <= 180)) return "ลองจิจูดต้องอยู่ระหว่าง -180 ถึง 180";
  if (!(Number.isFinite(m) && m >= RADIUS_MIN && m <= RADIUS_MAX)) return `รัศมีต้องอยู่ระหว่าง ${RADIUS_MIN} ถึง ${RADIUS_MAX} เมตร`;
  return "";
}

function statusOf(list: AttChange[], h: AttChange) {
  const today = todayIso();
  if (h.at > today) return { label: "ล่วงหน้า", cls: "bg-[var(--warning-soft)] text-[var(--warning)]" };
  const now = [...list].filter((x) => x.at <= today).sort((a, b) => a.at.localeCompare(b.at)).pop();
  return now === h
    ? { label: "ใช้อยู่", cls: "bg-[#E7F5EE] text-[#14875A]" }
    : { label: "ใช้ก่อนหน้า", cls: "bg-muted text-muted-foreground" };
}

export function AdminAttendancePage() {
  const s = useSystemSettings();
  const areas = useAreaSettings();
  const place = workplaceOf(areas);
  const hr = useHr();
  /* รอบที่ปิดแล้วแก้ไม่ได้ — ค่าใหม่เริ่มใช้ได้ตั้งแต่วันถัดจากวันปิดรอบล่าสุด */
  const locked = lockedUntil(hr);
  const minAt = locked ? nextDay(locked) : "";

  const [d, setD] = useState<Draft>(() => ({
    start: s.schedule.start,
    end: s.schedule.end,
    lunchStart: s.schedule.lunchStart,
    lunchEnd: s.schedule.lunchEnd,
    lat: String(place.lat),
    lng: String(place.lng),
    m: String(place.radius),
  }));
  const [showXY, setShowXY] = useState(false);
  const [done, setDone] = useState("");
  const [at, setAt] = useState(() => (minAt && minAt > todayIso() ? minAt : todayIso()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = <K extends keyof Draft>(k: K, v: string) => setD((x) => ({ ...x, [k]: v }));
  const bad = problemOf(d);
  const lat = Number(d.lat);
  const lng = Number(d.lng);
  const m = Number(d.m);
  const workMin = bad ? 0 : minutesOfDay(d.end) - minutesOfDay(d.start) - (minutesOfDay(d.lunchEnd) - minutesOfDay(d.lunchStart));
  const lunchMin = bad ? 0 : minutesOfDay(d.lunchEnd) - minutesOfDay(d.lunchStart);
  const dirty =
    d.start !== s.schedule.start ||
    d.end !== s.schedule.end ||
    d.lunchStart !== s.schedule.lunchStart ||
    d.lunchEnd !== s.schedule.lunchEnd ||
    lat !== place.lat ||
    lng !== place.lng ||
    Math.round(m) !== place.radius;

  function reset() {
    setD({
      start: s.schedule.start,
      end: s.schedule.end,
      lunchStart: s.schedule.lunchStart,
      lunchEnd: s.schedule.lunchEnd,
      lat: String(place.lat),
      lng: String(place.lng),
      m: String(place.radius),
    });
    setErr("");
    setDone("");
  }

  async function here() {
    setBusy(true);
    const got = await locate();
    setBusy(false);
    if ("error" in got) {
      setErr(got.error);
      return;
    }
    setErr("");
    setD((x) => ({ ...x, lat: got.fix.lat.toFixed(6), lng: got.fix.lng.toFixed(6) }));
  }

  /*
   * จุดลงเวลาไปอยู่ในฐานข้อมูล (work_areas) เพราะ clock_punch เป็นคนตัดสินว่าอยู่ในพื้นที่ไหม
   * บันทึกไม่สำเร็จต้องบอกทันที ไม่ใช่ขยับหมุดบนจอแล้วพนักงานกดเข้างานไม่ได้โดยไม่มีใครรู้
   */
  async function save() {
    if (bad) {
      setErr(bad);
      return;
    }
    if (!at) {
      setErr("เลือกวันที่เริ่มใช้ค่าใหม่");
      return;
    }
    if (minAt && at < minAt) {
      setErr(`วันที่เริ่มใช้ ${thaiDate(at)} ตกในรอบที่ปิดแล้ว เลือกตั้งแต่ ${thaiDate(minAt)} เป็นต้นไป`);
      return;
    }
    const times = { start: d.start, end: d.end, lunchStart: d.lunchStart, lunchEnd: d.lunchEnd };
    const radius = Math.round(m);
    const note = `เวลาทำงาน ${d.start}–${d.end} · พักเที่ยง ${d.lunchStart}–${d.lunchEnd} · รัศมี ${radius} ม.`;

    setBusy(true);
    const res = await saveWorkplace({ ...place, lat, lng, radius });
    setBusy(false);
    if (!res.ok) {
      setDone("");
      setErr(`บันทึกจุดลงเวลาไม่สำเร็จ: ${res.message}`);
      return;
    }

    saveAttFrom(at, times, { lat, lng, radius }, note);
    logChange("เวลาทำงาน", `เริ่มใช้ ${thaiDate(at)} · ${note}`);
    setErr("");
    setDone(
      at <= todayIso()
        ? `บันทึกแล้ว — พนักงานกดเข้างานได้ในรัศมี ${radius} เมตรจากหมุดนี้`
        : `บันทึกแล้ว — จุดลงเวลาใช้ทันที ส่วนเวลาทำงานเริ่ม ${thaiDate(at)}`,
    );
  }

  const hist = [...s.attHistory].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="space-y-4">
      <AdminHead
        title="เวลาทำงานและจุดลงเวลา"
        desc="เวลาเข้า-ออกงาน เวลาพักเที่ยง พิกัดสำนักงาน และรัศมีที่ลงเวลาได้"
      />

      <div className="grid items-start gap-4 2xl:grid-cols-2">
        <Card title="เวลาทำงาน">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input2 label="เวลาเข้างาน">
              <input type="time" value={d.start} onChange={(e) => set("start", e.target.value)} className={`${inputCls} num`} />
            </Input2>
            <Input2 label="เวลาเลิกงาน">
              <input type="time" value={d.end} onChange={(e) => set("end", e.target.value)} className={`${inputCls} num`} />
            </Input2>
            <Input2 label="เริ่มพักเที่ยง">
              <input type="time" value={d.lunchStart} onChange={(e) => set("lunchStart", e.target.value)} className={`${inputCls} num`} />
            </Input2>
            <Input2 label="สิ้นสุดพักเที่ยง">
              <input type="time" value={d.lunchEnd} onChange={(e) => set("lunchEnd", e.target.value)} className={`${inputCls} num`} />
            </Input2>
          </div>
          <p className="mt-3 rounded-[11px] border border-border bg-card px-3 py-2.5 text-[12.5px] text-muted-foreground">
            {bad ? (
              <b className="font-semibold text-destructive">{bad}</b>
            ) : (
              <>
                เวลาทำงานจริง <b className="font-semibold text-foreground">{formatMinutes(workMin)}/วัน</b> · พักเที่ยง{" "}
                <b className="font-semibold text-foreground">{formatMinutes(lunchMin)}</b>
              </>
            )}
          </p>
        </Card>

        <Card title="กะเฉพาะบทบาท">
          <RoleShifts />
        </Card>
      </div>

      {/* จุดลงเวลาเต็มความกว้าง — แผนที่ซ้าย ช่องกรอกขวา ไม่ปล่อยพื้นที่ว่างข้างขวาเหมือนเดิม
         (ผู้ใช้สั่งจัดใหม่ 8 ต.ค. 2569) */}
      <Card title="จุดลงเวลา">
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div>
          {Number.isFinite(lat) && Number.isFinite(lng) ? (
            <div className="overflow-hidden rounded-[12px] border border-border">
              <AreaMap
                lat={lat}
                lng={lng}
                radius={Number.isFinite(m) && m > 0 ? m : 150}
                onPick={(la, ln) => setD((x) => ({ ...x, lat: String(la), lng: String(ln) }))}
                className="h-[300px] w-full"
              />
              <a
                href={mapLink(lat, lng)}
                target="_blank"
                rel="noreferrer"
                className="block border-t border-border px-3 py-2 text-[12.5px] text-muted-foreground hover:text-primary"
              >
                เปิดใน Google Maps ↗
              </a>
            </div>
          ) : (
            <div className="grid h-[200px] place-items-center rounded-[12px] border border-dashed border-border text-[13px] text-muted-foreground">
              กรอกพิกัดให้ถูกต้องก่อนจึงจะเห็นแผนที่
            </div>
          )}
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            กดบนแผนที่เพื่อย้ายหมุด วงกลมเส้นประคือรัศมีที่ลงเวลาได้
          </p>
          </div>

          <div>
          {/* ขั้นที่ 1 ปักหมุด — ปุ่มเดียวจบถ้ายืนอยู่ที่ออฟฟิศ ไม่ต้องรู้ว่าละติจูดคืออะไร */}
          <p className="text-[12.5px] font-semibold text-foreground">1. ปักหมุดที่สำนักงาน</p>
          <button type="button" className="btn glass-thin mt-2 w-full justify-center" disabled={busy} onClick={() => void here()}>
            <CrosshairIcon className="size-4" strokeWidth={2.2} />
            {busy ? "กำลังหาตำแหน่ง…" : "ใช้ตำแหน่งที่ฉันอยู่ตอนนี้"}
          </button>
          <p className="mt-1.5 text-[12px] text-muted-foreground">หรือกดบนแผนที่ตรงจุดที่ต้องการ</p>

          {/* ขั้นที่ 2 รัศมี — เลือกจากระยะที่ใช้บ่อย ไม่ต้องคิดเป็นทศนิยมกิโลเมตร */}
          <p className="mt-4 text-[12.5px] font-semibold text-foreground">2. พนักงานต้องอยู่ใกล้หมุดแค่ไหน</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {RADIUS_PICKS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => set("m", String(v))}
                aria-pressed={Math.round(m) === v}
                className={`h-9 rounded-full border px-3.5 text-[13px] transition-colors ${
                  Math.round(m) === v
                    ? "border-primary bg-primary text-white"
                    : "border-border bg-card hover:border-primary"
                }`}
              >
                {v} ม.
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[12.5px] text-muted-foreground">หรือกำหนดเอง</span>
            <input
              value={d.m}
              inputMode="numeric"
              aria-label="รัศมีที่ลงเวลาได้ (เมตร)"
              onChange={(e) => set("m", e.target.value)}
              className={`${inputCls} num w-[90px]`}
            />
            <span className="text-[12.5px] text-muted-foreground">เมตร</span>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            ตั้งได้ {RADIUS_MIN} ถึง {RADIUS_MAX} เมตร · ยิ่งแคบยิ่งกันคนกดเข้างานจากที่บ้าน แต่ถ้าแคบเกินไป
            สัญญาณ GPS เพี้ยนนิดเดียวก็กดไม่ได้ (แนะนำ 100–150 เมตร)
          </p>

          {/* พิกัดตัวเลขเป็นของคนที่รู้ว่าจะกรอกอะไร — ซ่อนไว้ ไม่ให้เกะกะคนทั่วไป */}
          <button
            type="button"
            onClick={() => setShowXY((v) => !v)}
            className="mt-3 text-[12.5px] text-primary underline"
          >
            {showXY ? "ซ่อนพิกัดตัวเลข" : "กรอกพิกัดเป็นตัวเลขเอง"}
          </button>
          {showXY && (
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <Input2 label="ละติจูด">
                <input value={d.lat} inputMode="decimal" onChange={(e) => set("lat", e.target.value)} className={`${inputCls} num`} />
              </Input2>
              <Input2 label="ลองจิจูด">
                <input value={d.lng} inputMode="decimal" onChange={(e) => set("lng", e.target.value)} className={`${inputCls} num`} />
              </Input2>
            </div>
          )}
          </div>
        </div>
      </Card>

      <section className="glass rounded-[18px] px-4 py-4 sm:px-5">
        {err && (
          <p role="status" className="mb-3 rounded-[11px] border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-[12.5px] font-semibold text-destructive">
            {err}
          </p>
        )}
        {!err && done && (
          <p role="status" className="mb-3 rounded-[11px] px-3 py-2.5 text-[12.5px] font-semibold" style={{ background: "var(--success-soft)", color: "var(--success)" }}>
            {done}
          </p>
        )}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-[240px]">
            <Input2
              label="วันที่เริ่มใช้ค่าใหม่"
              hint={
                at > todayIso()
                  ? "ตั้งล่วงหน้า ระบบสลับให้เองเมื่อถึงวัน"
                  : minAt
                    ? `เลือกได้ตั้งแต่ ${thaiDate(minAt)} เป็นต้นไป`
                    : "มีผลตั้งแต่วันที่เลือกเป็นต้นไป"
              }
            >
              <DateField
                value={at}
                onChange={setAt}
                min={minAt || undefined}
                label="วันที่เริ่มใช้ค่าใหม่"
                placeholder="เลือกวันที่"
                className="h-10 rounded-[10px] text-[14px]"
              />
            </Input2>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn glass-thin disabled:opacity-45" disabled={!dirty} onClick={reset}>
              ยกเลิกการแก้
            </button>
            <button type="button" className="btn solid btn-solid disabled:opacity-45" disabled={Boolean(bad) || busy} onClick={() => void save()}>
              บันทึก
            </button>
          </div>
        </div>
      </section>

      <section className="glass overflow-hidden rounded-[18px]">
        <div className="border-b border-border px-4 py-3.5 sm:px-5">
          <h2 className="text-[14.5px] font-bold">ประวัติการตั้งค่า</h2>
        </div>
        {hist.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted-foreground">
            ยังไม่เคยบันทึกค่าใหม่ — ค่าที่ใช้อยู่ตอนนี้คือเวลา {s.schedule.start}–{s.schedule.end} พักเที่ยง{" "}
            {s.schedule.lunchStart}–{s.schedule.lunchEnd} รัศมี {place.radius / 1000} กม.
          </p>
        ) : (
          <div className="px-4 pt-3 pb-4 sm:px-5">
            <div className="grid grid-cols-[minmax(0,1fr)_84px] items-center gap-2 border-b border-border pb-2 text-[11.5px] font-bold text-muted-foreground sm:grid-cols-[130px_150px_150px_100px_84px]">
              <span>เริ่มใช้</span>
              <span className="max-sm:hidden">เวลาทำงาน</span>
              <span className="max-sm:hidden">พักเที่ยง</span>
              <span className="max-sm:hidden">รัศมี</span>
              <span className="text-right">สถานะ</span>
            </div>
            {hist.map((h) => {
              const st = statusOf(s.attHistory, h);
              return (
                <div
                  key={h.at}
                  className="grid grid-cols-[minmax(0,1fr)_84px] items-center gap-2 border-b border-border py-2.5 last:border-b-0 sm:grid-cols-[130px_150px_150px_100px_84px]"
                >
                  <span className="num text-[13.5px] font-semibold">
                    {thaiDate(h.at)}
                    <small className="block text-[11.5px] font-medium text-muted-foreground sm:hidden">
                      {h.times.start}–{h.times.end} · พัก {h.times.lunchStart}–{h.times.lunchEnd} · {h.place.radius / 1000} กม.
                    </small>
                  </span>
                  <span className="num text-[13px] max-sm:hidden">
                    {h.times.start} – {h.times.end}
                  </span>
                  <span className="num text-[13px] max-sm:hidden">
                    {h.times.lunchStart} – {h.times.lunchEnd}
                  </span>
                  <span className="num text-[13px] max-sm:hidden">{h.place.radius / 1000} กม.</span>
                  <span className="text-right">
                    <em className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold not-italic ${st.cls}`}>{st.label}</em>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ค่าที่ไม่มีในต้นแบบแต่ระบบต้องใช้ — เดิมอยู่หน้าเวลาทำงานที่ถูกยุบมารวมที่นี่ */}
      <PayAndLate />

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        ตำแหน่งจากเบราว์เซอร์ใช้ได้เฉพาะเว็บที่เปิดผ่าน https และพนักงานต้องอนุญาตให้เข้าถึงตำแหน่ง ·
        รอบเงินเดือนที่ปิดไปแล้วใช้ตัวเลขที่บันทึกไว้ตอนปิด ไม่คิดใหม่ตามค่าที่แก้
      </p>
    </div>
  );
}

/** วันถัดจากวันที่ ISO ที่ให้มา */
function nextDay(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + 1);
  const p = (n: number) => (n < 10 ? "0" : "") + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ─── รอบเงินเดือน เริ่มนับโอที และการหักมาสาย ─────────────────────
/*
 * ต้นแบบ HR-15 มีแค่เวลาเข้า-ออกกับจุดลงเวลา แต่ระบบมีค่าอีกสามอย่างที่ผูกกับเวลาทำงาน
 * (วันตัดรอบเงินเดือน · เริ่มนับโอที · การหักเงินมาสาย) เดิมอยู่หน้า /admin/schedule ที่ยุบทิ้งแล้ว
 * จึงย้ายมาไว้ท้ายหัวข้อนี้ ไม่ใช่ทำหายไปพร้อมหน้าเดิม
 */
const SCHED_LABEL: Partial<Record<keyof ScheduleSettings, string>> = {
  otStart: "เริ่มนับโอทีวันทำงาน",
  forgotPunchOutAfterHours: "เตือนลืมตอกออก (ชม.หลังเลิกงาน)",
  payCutDay: "วันตัดรอบเงินเดือน",
};
const LATE_MODE_LABEL: Record<"wage" | "fixed", string> = {
  wage: "หักตามฐานเงินเดือน",
  fixed: "กำหนดเอง (บาทต่อนาที)",
};
const modeOf = (m: LateMode) => (m === "fixed" ? "fixed" : "wage");
const SAMPLE_SALARY = 30000;
const SAMPLE_MONTH = "2026-09";

function describeSched(a: ScheduleSettings, b: ScheduleSettings) {
  return (Object.keys(SCHED_LABEL) as (keyof ScheduleSettings)[])
    .filter((k) => a[k] !== b[k])
    .map((k) => `${SCHED_LABEL[k]} ${a[k]} → ${b[k]}`);
}
function describeLate(a: RateSettings, b: RateSettings) {
  const out: string[] = [];
  if (modeOf(a.lateMode) !== modeOf(b.lateMode))
    out.push(`หักเงินมาสาย: ${LATE_MODE_LABEL[modeOf(a.lateMode)]} → ${LATE_MODE_LABEL[modeOf(b.lateMode)]}`);
  if (b.lateMode === "fixed" && a.latePerMinute !== b.latePerMinute)
    out.push(`หักมาสายนาทีละ ${a.latePerMinute} → ${b.latePerMinute} บาท`);
  return out;
}

function PayAndLate() {
  const d = useSectionDraft("schedule", "เวลาทำงาน", describeSched);
  const r = useSectionDraft("rates", "เวลาทำงาน", describeLate);
  const s = d.draft;
  const late = r.draft;
  const mode = modeOf(late.lateMode);
  const wagePerMin = SAMPLE_SALARY / HR_OT_DIVISOR.days / HR_OT_DIVISOR.hours / 60;
  const bad =
    !(Number.isInteger(s.payCutDay) && s.payCutDay >= 1 && s.payCutDay <= 28)
      ? "วันตัดรอบเงินเดือนต้องเป็นวันที่ 1–28"
      : !(s.forgotPunchOutAfterHours >= 1 && s.forgotPunchOutAfterHours <= 12)
        ? "เตือนลืมตอกออกได้ 1–12 ชั่วโมง"
        : mode === "fixed" && !(late.latePerMinute > 0 && late.latePerMinute <= 100)
          ? "หักมาสายนาทีละต้องมากกว่า 0 และไม่เกิน 100 บาท"
          : "";
  const set = <K extends keyof ScheduleSettings>(k: K, v: ScheduleSettings[K]) => d.setDraft({ ...s, [k]: v });
  const [cy, cm] = SAMPLE_MONTH.split("-").map(Number);
  const cutText = `${thaiMonth(SAMPLE_MONTH)} = วันที่ ${s.payCutDay + 1} เดือนก่อน ถึงวันที่ ${s.payCutDay} ของเดือนนี้`;
  void cy;
  void cm;

  return (
    <>
      <UiCard title="รอบเงินเดือน เริ่มนับโอที และการหักมาสาย" note={bad ? undefined : `รอบ${cutText}`}>
        <div className={`grid gap-4 sm:grid-cols-2 ${mode === "fixed" ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
          <UiInput2 label={SCHED_LABEL.payCutDay ?? ""} hint="รอบถัดไปเริ่มวันรุ่งขึ้น · ตั้งได้วันที่ 1–28">
            <input
              type="number"
              min={1}
              max={28}
              value={s.payCutDay}
              onChange={(e) => set("payCutDay", Number(e.target.value))}
              className={`${inputCls} num`}
            />
          </UiInput2>
          <UiInput2 label={SCHED_LABEL.otStart ?? ""} hint="ช่วงระหว่างเลิกงานถึงเวลานี้ถือเป็นพักเย็น ไม่นับโอที">
            <input type="time" value={s.otStart} onChange={(e) => set("otStart", e.target.value)} className={`${inputCls} num`} />
          </UiInput2>
          <UiInput2 label={SCHED_LABEL.forgotPunchOutAfterHours ?? ""}>
            <input
              type="number"
              min={1}
              max={12}
              value={s.forgotPunchOutAfterHours}
              onChange={(e) => set("forgotPunchOutAfterHours", Number(e.target.value))}
              className={`${inputCls} num`}
            />
          </UiInput2>
          <UiInput2
            label="หักเงินเมื่อมาสาย"
            hint={mode === "wage" ? `เงินเดือน ${baht(SAMPLE_SALARY)} บาท → นาทีละ ${baht(wagePerMin)} บาท` : undefined}
          >
            <select
              value={mode}
              onChange={(e) => r.setDraft({ ...late, lateMode: e.target.value as LateMode })}
              className={`${inputCls} cursor-pointer`}
            >
              {(["wage", "fixed"] as const).map((m) => (
                <option key={m} value={m}>
                  {LATE_MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </UiInput2>
          {mode === "fixed" && (
            <UiInput2
              label="หักนาทีละ (บาท)"
              hint={
                late.latePerMinute > wagePerMin
                  ? `สูงกว่าค่าจ้างต่อนาทีของเงินเดือน ${baht(SAMPLE_SALARY)} บาท อาจขัดกฎหมายคุ้มครองแรงงาน`
                  : undefined
              }
            >
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={late.latePerMinute}
                onChange={(e) => r.setDraft({ ...late, latePerMinute: Number(e.target.value) })}
                className={`${inputCls} num`}
              />
            </UiInput2>
          )}
        </div>
        {/* กติกาที่เจ้าของยืนยัน 29 ก.ย. 2569 — คิดตามเวลางานอย่างเดียว ไม่หักกลบกับการอยู่เลยเวลา */}
        <p className="mt-3 rounded-[11px] border border-border bg-card px-3 py-2.5 text-[12.5px] text-muted-foreground">
          มาสายนับจากเวลาเข้างานอย่างเดียว <b className="font-semibold text-foreground">อยู่เลยเวลาเลิกงานไม่นำมาหักกลบ</b>{" "}
          เวลาที่อยู่ต่อจะเป็นโอทีก็ต่อเมื่อมีใบโอทีที่อนุมัติแล้ว
        </p>
      </UiCard>

      <SaveBar
        dirty={d.dirty || r.dirty}
        isDefault={d.isDefault && modeOf(r.saved.lateMode) === "wage"}
        invalid={bad}
        onSave={() => {
          if (d.dirty) d.save();
          if (r.dirty) r.save();
        }}
        onCancel={() => {
          d.cancel();
          r.cancel();
        }}
        onDefault={() => d.toDefault()}
      />
    </>
  );
}

/*
 * บทบาทที่เข้า-ออกไม่ตรงกับเวลาบริษัท (แม่บ้าน 08:00–17:00 · ผู้ใช้สั่ง 7 ต.ค. 2569)
 * เว้นว่างทั้งสองช่อง = ใช้เวลาบริษัทเหมือนคนอื่น · พักเที่ยงใช้ชุดเดียวกับบริษัท
 */
function RoleShifts() {
  const s = useSystemSettings();
  const shifts = s.schedule.shifts ?? {};
  /* บทบาทที่ตั้งกะไว้แล้ว ขึ้นก่อน แล้วค่อยให้เลือกเพิ่มจากบทบาทที่เหลือ */
  const [adding, setAdding] = useState<Role | "">("");
  const keys = Object.keys(shifts) as Role[];
  const rest = ROLES.filter((r) => !keys.includes(r.key));

  function set(role: string, start: string, end: string) {
    if (start && end && minutesOfDay(end) <= minutesOfDay(start)) return;
    saveRoleShift(role, start, end);
    logChange("เวลาทำงาน", start && end ? `กะของ${roleName(role)} ${start}–${end}` : `${roleName(role)} กลับไปใช้เวลาบริษัท`);
  }

  return (
    <div className="space-y-3">
      {keys.length === 0 && (
        <p className="text-[12.5px] text-muted-foreground">ยังไม่มีบทบาทที่ใช้เวลาต่างจากบริษัท</p>
      )}
      {keys.map((role) => (
        <div key={role} className="grid items-end gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
          <b className="text-[13.5px] font-semibold">{roleName(role)}</b>
          <Input2 label="เวลาเข้างาน">
            <input
              type="time"
              value={shifts[role].start}
              onChange={(e) => set(role, e.target.value, shifts[role].end)}
              className={`${inputCls} num`}
            />
          </Input2>
          <Input2 label="เวลาเลิกงาน">
            <input
              type="time"
              value={shifts[role].end}
              onChange={(e) => set(role, shifts[role].start, e.target.value)}
              className={`${inputCls} num`}
            />
          </Input2>
          <button type="button" className="btn glass-thin mb-0.5" onClick={() => set(role, "", "")}>
            ใช้เวลาบริษัท
          </button>
        </div>
      ))}
      {rest.length > 0 && (
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
          <Input2 label="เพิ่มกะของบทบาท">
            <select value={adding} onChange={(e) => setAdding(e.target.value as Role | "")} className={inputCls}>
              <option value="">เลือกบทบาท…</option>
              {rest.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </Input2>
          <button
            type="button"
            className="btn glass-thin mb-0.5"
            disabled={!adding}
            onClick={() => {
              if (!adding) return;
              set(adding, s.schedule.start, s.schedule.end);
              setAdding("");
            }}
          >
            เพิ่ม
          </button>
        </div>
      )}
    </div>
  );
}

function roleName(role: string) {
  return ROLES.find((r) => r.key === role)?.label ?? role;
}
