"use client";

/*
 * ตั้งค่าระบบ — หน้าเดียวรวมทุกหัวข้อ (ต้นแบบ "ตั้งค่าระบบ — ERP MAZ.html" ที่เจ้าของส่งมา 28 ก.ย. 2569)
 *
 * ซ้ายเป็นรายการหัวข้อแบ่งสามกลุ่ม ขวาเป็นหน้าของหัวข้อที่เลือก
 * เนื้อในแต่ละหัวข้อยังเป็นคอมโพเนนต์เดิมที่ใช้งานและทดสอบแล้ว ไม่ได้เขียนใหม่
 * หน้าเดิม (/admin/leave, /admin/rates, …) ยังเปิดตรงได้ เพราะกระดิ่งและลิงก์เก่าชี้ไปที่นั่น
 */

import { useEffect, useState } from "react";
import { ICONS } from "./app-shell";
import type { IconName } from "@/lib/nav";
import { AdminOptionsPage } from "./admin-options-page";
import { AdminPositionsPage } from "./admin-positions-page";
import { AdminLeavePage } from "./admin-leave-page";
import { AdminHolidaysPage } from "./admin-holidays-page";
import { AdminAttendancePage } from "./admin-attendance-page";
import { AdminRatesPage } from "./admin-rates-page";
import { AdminCompanyPage } from "./admin-company-page";

/* ไอคอนของแต่ละหัวข้อตามต้นแบบ hr-settings.html */
const SEC_ICON: Record<string, IconName> = {
  master: "planboard",
  positions: "team",
  services: "project",
  leave: "leave",
  holidays: "leave",
  attendance: "clock",
  payroll: "commission",
  wht: "tax",
  issuer: "receipt",
};

type SecKey =
  | "master"
  | "positions"
  | "services"
  | "leave"
  | "holidays"
  | "attendance"
  | "payroll"
  | "wht"
  | "issuer";

const GROUPS: { title: string; items: { key: SecKey; label: string }[] }[] = [
  {
    title: "ข้อมูลองค์กร",
    items: [
      { key: "master", label: "ข้อมูลหลัก" },
      { key: "positions", label: "ตำแหน่งและสายอนุมัติ" },
      { key: "services", label: "บริการ" },
    ],
  },
  {
    title: "การลาและเวลา",
    items: [
      { key: "leave", label: "ประเภทการลา" },
      { key: "holidays", label: "วันหยุดบริษัท" },
      { key: "attendance", label: "เวลาทำงานและจุดลงเวลา" },
    ],
  },
  {
    title: "เงินและเอกสาร",
    items: [
      { key: "payroll", label: "การคำนวณเงินเดือน" },
      { key: "wht", label: "หัก ณ ที่จ่าย" },
      { key: "issuer", label: "ข้อมูลผู้ออกเอกสาร" },
    ],
  },
];

function Section({ sec }: { sec: SecKey }) {
  switch (sec) {
    case "master":
      return <AdminOptionsPage />;
    case "positions":
      return <AdminPositionsPage />;
    case "services":
      return <AdminOptionsPage only="services" />;
    case "leave":
      return <AdminLeavePage />;
    case "holidays":
      return <AdminHolidaysPage />;
    case "attendance":
      return <AdminAttendancePage />;
    case "payroll":
      return <AdminRatesPage />;
    case "wht":
      return <AdminOptionsPage only="whtTypes" />;
    case "issuer":
      return <AdminCompanyPage />;
  }
}

function SecIcon({ name }: { name: IconName }) {
  const Icon = ICONS[name];
  return <Icon className="size-[17px] flex-none" strokeWidth={1.9} />;
}

const KEYS: SecKey[] = GROUPS.flatMap((g) => g.items.map((i) => i.key));

export function AdminSettingsPage() {
  const [sec, setSec] = useState<SecKey>("master");

  /* เปิดหัวข้อตรงจากลิงก์ได้ เช่น /admin/settings#holidays (ต้นแบบใช้ #id เหมือนกัน)
     อ่านหลังเมานต์ ไม่ใช่ตอนสร้างสเตท ไม่งั้น HTML ฝั่งเซิร์ฟเวอร์กับเบราว์เซอร์ไม่ตรงกัน */
  useEffect(() => {
    const read = () => {
      const id = window.location.hash.replace("#", "") as SecKey;
      if (KEYS.includes(id)) setSec(id);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  function go(k: SecKey) {
    setSec(k);
    window.history.replaceState(null, "", `#${k}`);
  }

  return (
    <div className="space-y-4">
      <div className="bar">
        <div>
          <h1>ตั้งค่าระบบ</h1>
          <p>ข้อมูลหลักและค่าที่ใช้คำนวณทั้งระบบ</p>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[236px_minmax(0,1fr)]">
        {/* จอคอม: รายการหัวข้อค้างอยู่ด้านซ้าย · จอแคบ: เลื่อนเป็นแถบแนวนอน */}
        <nav
          className="glass rounded-[16px] p-2 max-lg:flex max-lg:gap-1.5 max-lg:overflow-x-auto lg:sticky lg:top-4"
          aria-label="หัวข้อตั้งค่า"
        >
          {GROUPS.map((g) => (
            <div key={g.title} className="max-lg:flex max-lg:shrink-0 max-lg:items-center max-lg:gap-1.5">
              {/* ต้นแบบ: ชื่อกลุ่มเป็นตัวหนังสือเล็กสีจาง ไม่ใช่แถบสีเทา */}
              <p className="px-2.5 pt-3 pb-1 text-[11px] font-bold text-muted-foreground max-lg:pt-0">{g.title}</p>
              {g.items.map((it) => {
                const on = sec === it.key;
                return (
                  <button
                    key={it.key}
                    type="button"
                    aria-current={on}
                    onClick={() => go(it.key)}
                    /* ต้นแบบใช้พื้นชมพูอ่อนตัวอักษรแดงตอนเลือกอยู่ ไม่ใช่แถบแดงทึบ */
                    className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-left text-[13.5px] transition-colors max-lg:w-auto max-lg:shrink-0 max-lg:whitespace-nowrap ${
                      on ? "bg-[var(--accent)] font-semibold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <SecIcon name={SEC_ICON[it.key]} />
                    {it.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          <Section sec={sec} />
        </div>
      </div>
    </div>
  );
}
