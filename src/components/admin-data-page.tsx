"use client";

/*
 * ข้อมูลตัวอย่าง — คืนค่าข้อมูลในเครื่องกลับเป็นชุดตั้งต้น (ย้ายมาจากหน้าโปรไฟล์)
 *
 * ระบบยังไม่มี backend ทุกอย่างที่กดแก้ค้างอยู่ใน localStorage ของเครื่อง
 * ถ้าลองใช้จนข้อมูลเละก็ไม่มีทางกลับ นอกจากไปล้าง localStorage เอง
 * หน้านี้จึงเป็นทางกลับที่ปลอดภัย — เลือกคืนเฉพาะส่วนที่พังได้ ไม่ต้องล้างทั้งหมด
 *
 * แบ่งสองกลุ่ม: ข้อมูลงานของทุกฝ่าย กับการตั้งค่าระบบของผู้ดูแล
 * "คืนค่าทั้งหมด" คืนเฉพาะข้อมูลงาน ไม่แตะการตั้งค่า — กันกดทีเดียวแล้วเวลาทำงานและสิทธิ์หายไปด้วย
 */

import { useRef, useState } from "react";
import { clearRecords } from "@/lib/attendance-store";
import { resetAcc } from "@/lib/acc-store";
import { resetAccounts } from "@/lib/accounts";
import { logChange } from "@/lib/admin-log";
import { resetAds } from "@/lib/ads-store";
import { resetCrm } from "@/lib/crm-store";
import { resetDashCards } from "@/lib/dashboard-cards";
import { resetExpenseClaims } from "@/lib/expense-store";
import { resetHr } from "@/lib/hr-store";
import { resetLeaveRecords } from "@/lib/leave-store";
import { resetMenuAccess } from "@/lib/nav";
import { resetNotifySettings } from "@/lib/notify-settings";
import { resetOtRecords } from "@/lib/ot-store";
import { resetSchedule } from "@/lib/pm-schedule-store";
import { resetPm } from "@/lib/pm-store";
import { resetProfile } from "@/lib/profile-data";
import { resetTemplates } from "@/lib/presales-templates";
import { resetApprovalRoute } from "@/lib/role";
import { resetSystemSettings } from "@/lib/system-settings";
import { resetAreaSettings } from "@/lib/work-area";
import { applyBackup, backupWhen, downloadBackup, readBackup, type Backup } from "@/lib/backup";
import { AdminHead, Card } from "./admin-ui";
import { ConfirmDialog } from "./confirm-dialog";
import { TrashIcon } from "./icons";

type DataSet = { key: string; label: string; note: string; reset: () => void };

const WORK_DATA: DataSet[] = [
  { key: "crm", label: "งานขาย", note: "ผู้สนใจ · คำขอก่อนการขาย · ใบเสนอราคา · ดีล", reset: resetCrm },
  { key: "pm", label: "โครงการ", note: "งานเข้าใหม่ · โปรเจค · งานย่อยและแชท", reset: resetPm },
  { key: "ads", label: "โฆษณาและรายงาน", note: "ใบสั่งรับโฆษณา · ผลที่กรอกไว้", reset: resetAds },
  { key: "templates", label: "คลังเทมเพลต", note: "เทมเพลตข้อเสนอของทีมก่อนการขาย", reset: resetTemplates },
  { key: "pmnote", label: "ตารางงาน", note: "กิจกรรม · รายละเอียดที่พิมพ์ไว้ · รายการที่ปิดงาน", reset: resetSchedule },
  { key: "acc", label: "บัญชี", note: "งวดชำระ · ใบแจ้งหนี้ · ใบเสร็จ · ภาษี", reset: resetAcc },
  { key: "hr", label: "ฝ่ายบุคคล", note: "ข้อมูลพนักงาน · เวลาทำงาน · รอบเงินเดือน · สลิป", reset: resetHr },
  { key: "leave", label: "การลา", note: "ใบลาของทุกบทบาท", reset: resetLeaveRecords },
  { key: "ot", label: "โอที", note: "คำขอโอทีของทุกบทบาท", reset: resetOtRecords },
  { key: "expense", label: "เบิกค่าใช้จ่าย", note: "ใบเบิกของทุกบทบาท", reset: resetExpenseClaims },
  { key: "attendance", label: "การตอกบัตร", note: "การตอกบัตรเข้า/ออกของบทบาทที่ล็อกอินอยู่", reset: clearRecords },
  { key: "profile", label: "โปรไฟล์", note: "ข้อมูลส่วนตัวที่แก้ไว้ของทุกบทบาท", reset: resetProfile },
  { key: "notify", label: "ตั้งค่าแจ้งเตือน", note: "สวิตช์เปิด/ปิดแต่ละเรื่อง", reset: resetNotifySettings },
  { key: "dash", label: "การ์ดบนรายงาน", note: "การ์ดที่เลือกซ่อนไว้", reset: resetDashCards },
];

const SYSTEM_DATA: DataSet[] = [
  {
    key: "settings",
    label: "การตั้งค่าระบบ",
    note: "เวลาทำงาน · วันหยุด · สิทธิ์วันลา · ข้อมูลบริษัท · อัตราและภาษี · เลขที่เอกสาร",
    reset: resetSystemSettings,
  },
  { key: "menu", label: "เมนูที่ใช้ได้", note: "เมนูที่ปิดไว้ของทุกบทบาท", reset: () => resetMenuAccess() },
  { key: "route", label: "สายอนุมัติ", note: "ผู้อนุมัติใบลา โอที ใบเบิก", reset: resetApprovalRoute },
  { key: "area", label: "พื้นที่เข้างาน", note: "พิกัดและรัศมีของที่ทำงาน", reset: resetAreaSettings },
  { key: "accounts", label: "บัญชีผู้ใช้", note: "การระงับบัญชีและการบังคับตั้งรหัสผ่านใหม่", reset: resetAccounts },
];

export function AdminDataPage() {
  const [asking, setAsking] = useState<DataSet | null>(null);
  const [all, setAll] = useState(false);
  const [done, setDone] = useState("");
  /* ไฟล์สำรองที่เลือกมาและยังไม่ได้ยืนยัน — ยืนยันแล้วค่อยเขียนทับของเดิม */
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const [fileErr, setFileErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickFile(file: File | undefined) {
    if (!file) return;
    const got = readBackup(await file.text());
    if (!got.ok) {
      setRestoring(null);
      setFileErr(got.why);
      return;
    }
    setFileErr("");
    setRestoring(got.backup);
  }

  const list = (sets: DataSet[]) => (
    <div className="flex flex-col gap-2">
      {sets.map((d) => (
        <div key={d.key} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-border bg-card px-3.5 py-3">
          <span className="min-w-[150px] flex-1">
            <b className="block text-[13.5px] font-semibold">{d.label}</b>
            <em className="block text-[11.5px] text-muted-foreground not-italic">{d.note}</em>
          </span>
          <button type="button" className="lnk quiet max-sm:min-h-10 max-sm:px-1" aria-label={`คืนค่า${d.label}เป็นค่าเริ่มต้น`} onClick={() => setAsking(d)}>
            คืนค่าเริ่มต้น
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <AdminHead
        title="ข้อมูลตัวอย่าง"
        desc="ระบบยังไม่ได้ต่อฐานข้อมูลจริง ทุกอย่างเก็บอยู่ในเครื่องนี้ — คืนค่าเฉพาะส่วนที่ต้องการกลับเป็นชุดตั้งต้นได้จากตรงนี้"
      />

      {done && (
        <p role="status" className="rounded-[12px] bg-[var(--success-soft)] px-4 py-2.5 text-[13px] text-[var(--success)]">
          {done}
        </p>
      )}

      {fileErr && (
        <p role="alert" className="rounded-[12px] bg-[var(--destructive-soft)] px-4 py-2.5 text-[13px] text-destructive">
          {fileErr}
        </p>
      )}

      {/* สำรองข้อมูล — ยังไม่มีฐานข้อมูลจริง ข้อมูลอยู่ในเครื่องนี้เครื่องเดียว */}
      <Card
        title="สำรองข้อมูลและนำกลับเข้ามา"
        note="ข้อมูลทั้งหมดอยู่ในเครื่องนี้ ถ้าล้างข้อมูลเบราว์เซอร์หรือเปลี่ยนเครื่องจะหาย — ดาวน์โหลดไฟล์สำรองเก็บไว้ แล้วนำกลับเข้ามาทีหลังได้"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            className="btn solid btn-solid"
            onClick={() => {
              const n = downloadBackup();
              logChange("ข้อมูลตัวอย่าง", `ดาวน์โหลดไฟล์สำรองข้อมูล ${n} รายการ`);
              setFileErr("");
              setDone(`ดาวน์โหลดไฟล์สำรองแล้ว ${n} รายการ`);
            }}
          >
            ดาวน์โหลดไฟล์สำรอง
          </button>
          <button type="button" className="btn glass-thin" onClick={() => fileRef.current?.click()}>
            เลือกไฟล์สำรองที่จะนำกลับเข้ามา
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="ไฟล์สำรองข้อมูล"
            onChange={(e) => {
              void pickFile(e.target.files?.[0]);
              /* เลือกไฟล์เดิมซ้ำต้องทำงานอีกครั้ง จึงล้างค่าทุกครั้ง */
              e.target.value = "";
            }}
          />
        </div>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
          ไฟล์สำรองเก็บงานของทุกฝ่าย การตั้งค่าระบบ และข้อมูลส่วนตัวของทุกบทบาทในเครื่องนี้ ·
          ไฟล์แนบที่อัปโหลดไว้ไม่รวมอยู่ในไฟล์สำรอง
        </p>
      </Card>

      <Card
        title="ข้อมูลงานของทุกฝ่าย"
        aside={
          <button type="button" className="btn glass-thin btn-mini max-sm:!h-10 max-sm:!px-3.5 max-sm:!text-[13px]" onClick={() => setAll(true)}>
            <TrashIcon className="size-3.5" strokeWidth={2} />
            คืนค่าข้อมูลงานทั้งหมด
          </button>
        }
      >
        {list(WORK_DATA)}
      </Card>

      <Card title="การตั้งค่าระบบ" note="คืนแยกทีละหมวด ไม่รวมอยู่ในปุ่มคืนค่าข้อมูลงานทั้งหมด">
        {list(SYSTEM_DATA)}
      </Card>

      <ConfirmDialog
        open={asking !== null}
        title={`คืนค่า${asking?.label ?? ""}`}
        description={`${asking?.label ?? ""}ที่แก้ไว้จะหายทั้งหมด แล้วกลับไปเป็นชุดตั้งต้น`}
        detail="ทำแล้วย้อนกลับไม่ได้"
        confirmLabel="คืนค่า"
        tone="destructive"
        onConfirm={() => {
          if (asking) {
            asking.reset();
            logChange("ข้อมูลตัวอย่าง", `คืนค่า${asking.label}เป็นชุดตั้งต้น`);
            setDone(`คืนค่า${asking.label}เรียบร้อยแล้ว`);
          }
          setAsking(null);
        }}
        onCancel={() => setAsking(null)}
      />

      <ConfirmDialog
        open={all}
        title="คืนค่าข้อมูลงานทั้งหมด"
        description="ทุกอย่างที่กรอกหรือแก้ไว้ในงานของทุกฝ่ายจะหาย แล้วกลับไปเป็นชุดตัวอย่างเริ่มต้น"
        detail="รวมงานขาย โครงการ บัญชี ฝ่ายบุคคล และงานส่วนตัวของทุกบทบาท · ไม่รวมการตั้งค่าระบบ · ทำแล้วย้อนกลับไม่ได้"
        confirmLabel="คืนค่าทั้งหมด"
        tone="destructive"
        onConfirm={() => {
          for (const d of WORK_DATA) d.reset();
          logChange("ข้อมูลตัวอย่าง", "คืนค่าข้อมูลงานของทุกฝ่ายเป็นชุดตั้งต้น");
          setDone("คืนค่าข้อมูลงานทั้งหมดเรียบร้อยแล้ว");
          setAll(false);
        }}
        onCancel={() => setAll(false)}
      />

      <ConfirmDialog
        open={restoring !== null}
        title="นำไฟล์สำรองกลับเข้ามา"
        description={
          restoring
            ? `ไฟล์สำรองเมื่อ ${backupWhen(restoring.at)} · ${Object.keys(restoring.data).length} รายการ`
            : ""
        }
        detail="ข้อมูลที่อยู่ในเครื่องตอนนี้จะถูกเขียนทับทั้งหมด แล้วหน้าจอจะโหลดใหม่ · ทำแล้วย้อนกลับไม่ได้"
        confirmLabel="นำกลับเข้ามา"
        tone="destructive"
        onConfirm={() => {
          if (!restoring) return;
          const n = applyBackup(restoring);
          logChange("ข้อมูลตัวอย่าง", `นำไฟล์สำรองกลับเข้ามา ${n} รายการ`);
          setRestoring(null);
          /* โหลดหน้าใหม่ เพื่อให้ทุกสโตร์อ่านค่าที่เพิ่งเขียนทับ ไม่ใช่ค่าที่ค้างในหน่วยความจำ */
          window.location.reload();
        }}
        onCancel={() => setRestoring(null)}
      />
    </div>
  );
}
