"use client";

/*
 * จัดการบัญชีผู้ใช้ของพนักงาน (ตามต้นแบบ dose-erp-maz/hr-accounts.html)
 *
 * ฝ่ายบุคคลเป็นคนสร้างบัญชีให้พนักงาน เพราะบริษัทไม่มีอีเมลพนักงาน
 * ชื่อผู้ใช้ระบบเสนอให้จากชื่อจริง แก้ได้ก่อนสร้าง และห้ามซ้ำกับคนอื่น
 *
 * รหัสที่ให้ไปเป็นรหัสชั่วคราว เข้าระบบครั้งแรกต้องตั้งรหัสใหม่เอง
 * ⚠️ ยังไม่มี backend — หน้านี้เก็บแค่ชื่อผู้ใช้กับสถานะ ไม่ได้เก็บรหัสผ่านไว้ที่ไหน
 *    ของจริงต้องสร้างบัญชีที่ระบบยืนยันตัวตนแล้วส่งรหัสชั่วคราวให้พนักงาน
 */

import { useMemo, useState } from "react";
import { thaiDate } from "@/lib/format";
import {
  HR_ACC_STATUS,
  HR_EMPTYPE,
  accountRoles,
  hrPos,
  posOf,
  type EmpAccount,
  type Employee,
} from "@/lib/hr-data";
import { resetAccount, setAccountRoles, setAccountStatus, useHr } from "@/lib/hr-store";
import { rolesOfEmployee } from "@/lib/hr-data";
import { ROLES, roleLabel, type Role } from "@/lib/role";
import { Sheet } from "./lead-dialogs";
import { Field, Input, Select } from "./ui";
import { SearchBox } from "./sales-ui";
import { PhoneCard, PhoneList } from "./acchr-phone";

/* พนักงานหนึ่งคนมีบัญชีหนึ่งบัญชีเสมอ สร้างพร้อมข้อมูลพนักงาน (ต้นแบบ 6 ต.ค. 2569)
   จึงไม่มีสถานะ "ยังไม่มีบัญชี" และไม่มีปุ่มสร้าง/ลบบัญชีในหน้านี้อีก */
type Filter = "all" | "active" | "suspended";

const FILTER_LABEL: Record<Filter, string> = {
  all: "ทั้งหมด",
  active: "ใช้งานอยู่",
  suspended: "ถูกระงับ",
};

/** รหัสชั่วคราว — ตัดตัวอักษรที่อ่านสลับกันง่าย (O 0 I l 1) ออก จะได้อ่านทางโทรศัพท์ได้ */
function tempPass() {
  const up = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const low = "abcdefghijkmnpqrstuvwxyz";
  const num = "23456789";
  const sym = "#@!";
  const pick = (s: string) => s.charAt(Math.floor(Math.random() * s.length));
  return pick(up) + pick(low) + pick(low) + pick(low) + pick(num) + pick(num) + pick(sym);
}

export function HrAccountsPage() {
  /* กล่องกำหนดบทบาทของบัญชี — เดิมอยู่หน้าบทบาทและสิทธิ์ที่ยุบทิ้งไปแล้ว (29 ก.ย. 2569) */
  const [roling, setRoling] = useState<string | null>(null);
  const hr = useHr();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  /** บัญชีที่กำลังตั้งรหัสใหม่ */
  const [editing, setEditing] = useState<{ id: string; reset: boolean } | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return hr.emp.filter((e) => {
      if (e.status !== "active" || !e.account) return false;
      if (filter !== "all" && e.account.status !== filter) return false;
      if (q && !`${e.name} ${e.account?.user ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [hr.emp, query, filter]);

  const target = editing ? hr.emp.find((e) => e.id === editing.id) : undefined;

  return (
    <div className="space-y-4">
      <div className="bar">
        {/* มุมซ้ายเดิมว่างเปล่า — ใส่หัวเรื่องกับจำนวนคนที่กำลังแสดง (เจ้าของสั่ง 6 ต.ค. 2569) */}
        <div className="max-md:hidden">
          <h1 className="text-[19px] leading-tight font-bold">จัดการบัญชีผู้ใช้</h1>
          <p className="num mt-1 text-[13px] text-muted-foreground">{rows.length} คน</p>
        </div>
        <div className="tools w-full flex-wrap items-end sm:w-auto">
          <Field label="ค้นหา" className="max-sm:w-full">
            <SearchBox value={query} onChange={setQuery} placeholder="ชื่อ หรือชื่อผู้ใช้" />
          </Field>
          <Field label="บัญชี" className="max-sm:w-full">
            <Select
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              aria-label="กรองตามสถานะบัญชี"
              className="w-auto min-w-[150px] max-sm:w-full"
            >
              {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
                <option key={f} value={f}>
                  {FILTER_LABEL[f]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      <section className="panel glass flex flex-col">
        <div className="scroll-stable min-h-0 flex-1 overflow-auto max-sm:hidden">
          <table className="data-table cards-sm min-w-[1000px]">
            <thead>
              <tr>
                <th>พนักงาน</th>
                <th style={{ width: 150 }}>ชื่อผู้ใช้</th>
                <th style={{ width: 160 }}>เมนูที่ใช้ได้</th>
                <th style={{ width: 120 }}>สถานะบัญชี</th>
                <th style={{ width: 120 }}>สร้างเมื่อ</th>
                <th style={{ width: 320 }} aria-label="จัดการ" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted-foreground">
                    ไม่พบรายการ
                  </td>
                </tr>
              ) : (
                rows.map((e) => (
                  <AccountRow
                    key={e.id}
                    emp={e}
                    onReset={() => setEditing({ id: e.id, reset: true })}
                    onRoles={() => setRoling(e.id)}
                    onToggle={() =>
                      setAccountStatus(e.id, e.account?.status === "active" ? "suspended" : "active")
                    }
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* มือถือ: การ์ดย่อคนละใบ ปุ่มจัดการบัญชีเต็มความกว้างการ์ด */}
        <PhoneList empty={rows.length === 0 ? "ไม่พบรายการ" : undefined}>
          {rows.map((e) => {
            const a = e.account;
            const st = a ? HR_ACC_STATUS[a.status] : null;
            return (
              <PhoneCard
                key={e.id}
                title={e.name}
                sub={e.pos ? hrPos(e.pos).label : "ยังไม่ได้กรอกข้อมูล"}
                badge={
                  st && (
                    <span className={`tag ${st.cls}`}>
                      <i />
                      {st.label}
                    </span>
                  )
                }
                stats={
                  a
                    ? [
                        { label: "ชื่อผู้ใช้", value: a.user },
                        { label: "สร้างเมื่อ", value: thaiDate(a.createdAt) },
                      ]
                    : undefined
                }
                actions={
                  a && (
                    <>
                      <button
                        type="button"
                        className="btn glass-thin"
                        onClick={() => setRoling(e.id)}
                      >
                        เมนูที่ใช้ได้
                      </button>
                      <button
                        type="button"
                        className="btn glass-thin"
                        onClick={() => setEditing({ id: e.id, reset: true })}
                      >
                        รีเซ็ตรหัสผ่าน
                      </button>
                      <button
                        type="button"
                        className="btn glass-thin"
                        onClick={() =>
                          setAccountStatus(e.id, a.status === "active" ? "suspended" : "active")
                        }
                      >
                        {a.status === "active" ? "ระงับบัญชี" : "คืนสิทธิ์"}
                      </button>
                    </>
                  )
                }
              />
            );
          })}
        </PhoneList>
      </section>

      {target && editing && (
        <AccountDialog
          key={target.id}
          emp={target}
          taken={hr.emp
            .filter((x) => x.id !== target.id && x.account)
            .map((x) => x.account!.user)}
          onClose={() => setEditing(null)}
        />
      )}

      {roling && hr.emp.find((e) => e.id === roling)?.account && (
        <RolesDialog emp={hr.emp.find((e) => e.id === roling)!} onClose={() => setRoling(null)} />
      )}

    </div>
  );
}

function AccountRow({
  emp,
  onReset,
  onRoles,
  onToggle,
}: {
  emp: Employee;
  onReset: () => void;
  onRoles: () => void;
  onToggle: () => void;
}) {
  const a = emp.account;
  const st = a ? HR_ACC_STATUS[a.status] : null;
  return (
    /* กดตรงไหนของแถวก็ได้เพื่อเปิด "เมนูที่ใช้ได้" ตามต้นแบบ (เจ้าของสั่ง 6 ต.ค. 2569)
       กดปุ่มในแถวให้ทำงานของปุ่มเอง จึงเช็กก่อนว่าคลิกโดนปุ่มหรือเปล่า */
    <tr
      tabIndex={0}
      className="cursor-pointer"
      onClick={(ev) => {
        if ((ev.target as HTMLElement).closest("button,a,input,select,textarea,label")) return;
        onRoles();
      }}
      onKeyDown={(ev) => {
        if (ev.target !== ev.currentTarget) return;
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        onRoles();
      }}
    >
      <td data-label="พนักงาน">
        <b className="block text-[13.5px] font-semibold">{emp.name}</b>
        {/* ใต้ชื่อบอกตำแหน่งอย่างเดียวตามต้นแบบ — ประเภทการจ้างดูที่หน้าข้อมูลพนักงาน */}
        <span className="why">
          {emp.pos ? posOf(emp).map((v) => hrPos(v).label).join(" · ") : "ยังไม่ได้กรอกข้อมูล"}
        </span>
      </td>
      <td data-label="ชื่อผู้ใช้" className="font-mono text-[13px]">
        {a?.user ?? "—"}
      </td>
      <td data-label="เมนูที่ใช้ได้">
        {a ? (
          accountRoles(a).length ? (
            <span className="block">
              {accountRoles(a).map((r) => (
                <em key={r} className="block leading-[1.6] whitespace-nowrap not-italic">
                  {roleLabel(r)}
                </em>
              ))}
            </span>
          ) : (
            <span className="muted">ยังไม่ได้กำหนด</span>
          )
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td data-label="สถานะบัญชี">
        {st ? (
          <span className={`tag ${st.cls}`}>
            <i />
            {st.label}
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td data-label="สร้างเมื่อ" className="num muted">
        {a ? thaiDate(a.createdAt) : "—"}
      </td>
      <td data-label="จัดการ">
        {a ? (
          <span className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn glass-thin btn-mini" onClick={onRoles}>
              เมนูที่ใช้ได้
            </button>
            <button type="button" className="btn glass-thin btn-mini" onClick={onReset}>
              รีเซ็ตรหัสผ่าน
            </button>
            <button type="button" className="btn glass-thin btn-mini" onClick={onToggle}>
              {a.status === "active" ? "ระงับบัญชี" : "คืนสิทธิ์"}
            </button>
          </span>
        ) : null}
      </td>
    </tr>
  );
}

/** ตั้งรหัสใหม่ให้บัญชีเดิม — บัญชีสร้างพร้อมพนักงานแล้ว จึงไม่มีการสร้างใหม่ที่นี่ */
function AccountDialog({
  emp,
  taken,
  onClose,
}: {
  emp: Employee;
  taken: string[];
  onClose: () => void;
}) {
  const [user, setUser] = useState(emp.account?.user ?? "");
  const [pass, setPass] = useState(tempPass);
  /* เมนูที่ใช้ได้แก้ที่ปุ่ม "เมนูที่ใช้ได้" — ตั้งรหัสใหม่ไม่แตะของเดิม */
  const roles = accountRoles(emp.account);
  const [warn, setWarn] = useState("");

  function save() {
    const name = user.trim();
    if (name.length < 4) return setWarn("ชื่อผู้ใช้ต้องยาวอย่างน้อย 4 ตัวอักษร");
    if (taken.includes(name)) return setWarn("ชื่อผู้ใช้นี้มีคนใช้แล้ว");
    /* TODO: ต่อ backend แล้วต้องรีเซ็ตรหัสที่ระบบยืนยันตัวตนจริง แล้วบังคับตั้งรหัสใหม่ครั้งแรก */
    resetAccount(emp.id, name, roles);
    onClose();
  }

  return (
    <Sheet
      title="รีเซ็ตรหัสผ่าน"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="button" className="btn solid btn-solid" onClick={save}>
            ตั้งรหัสใหม่
          </button>
        </>
      }
    >
      <Field label="พนักงาน">
        <p className="text-[14px] font-semibold">
          {emp.name}
          <span className="ml-2 text-[12.5px] font-normal text-muted-foreground">
            {posOf(emp).map((v) => hrPos(v).label).join(" · ")} · {HR_EMPTYPE[emp.type].label}
          </span>
        </p>
        {/* บอกไปเลยว่าบัญชีนี้จะได้เมนูของตำแหน่งไหน จะได้ไม่ต้องเดาตอนสร้าง */}
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          ได้เมนู {roles.map(roleLabel).join(" + ") || "—"}
        </p>
      </Field>

      <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
        <Field label="ชื่อผู้ใช้" required>
          <Input
            value={user}
            onChange={(e) => {
              setUser(e.target.value);
              setWarn("");
            }}
            aria-label="ชื่อผู้ใช้"
            placeholder="ระบบเสนอให้จากชื่อ"
            className="num"
          />
        </Field>
        <Field label="รหัสผ่านชั่วคราว">
          <span className="flex items-center gap-2">
            <span className="num flex h-9 flex-1 items-center rounded-[10px] border border-border bg-muted/60 px-3 text-[14px] font-bold tracking-wide">
              {pass}
            </span>
            <button
              type="button"
              className="btn glass-thin btn-mini"
              onClick={() => setPass(tempPass())}
            >
              สุ่มใหม่
            </button>
          </span>
        </Field>
      </div>


      {warn && (
        <p className="mt-3 rounded-[11px] border border-[rgba(192,18,31,.2)] bg-[var(--destructive-soft)] px-3.5 py-2.5 text-[12.5px] text-destructive">
          {warn}
        </p>
      )}
    </Sheet>
  );
}

export type { EmpAccount };

/*
 * บทบาทของบัญชีผู้ใช้ — จอนี้ให้เลือก "บทบาท" อย่างเดียว (เจ้าของสั่ง 1 ต.ค. 2569)
 * บทบาทคือเมนูที่บัญชีนี้เปิดได้ ส่วนตำแหน่งงานแก้ที่หน้าข้อมูลพนักงาน
 * บัญชีใหม่ระบบตั้งบทบาทให้ตามตำแหน่งอยู่แล้ว จอนี้ไว้แก้เป็นรายคน
 */
function RolesDialog({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  /* เมนูที่มาจากตำแหน่ง ติ๊กไว้และล็อก เอาออกไม่ได้ (ต้นแบบ hr-accounts 6 ต.ค. 2569)
     เปลี่ยนตำแหน่งเมื่อไหร่ เมนูชุดนี้เปลี่ยนตามเอง ที่เพิ่มเองคือสิทธิ์เพิ่มเติม */
  const own = rolesOfEmployee(emp);
  const [picked, setPicked] = useState<Role[]>(
    accountRoles(emp.account).length ? accountRoles(emp.account) : own,
  );
  const [warn, setWarn] = useState("");

  function toggle(r: Role) {
    if (own.includes(r)) return;
    setWarn("");
    setPicked((list) => (list.includes(r) ? list.filter((x) => x !== r) : [...list, r]));
  }

  return (
    <Sheet
      title="เมนูที่ใช้ได้"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="btn solid btn-solid"
            onClick={() => {
              if (!picked.length) return setWarn("เลือกอย่างน้อยหนึ่งบทบาท");
              setAccountRoles(emp.id, picked);
              onClose();
            }}
          >
            บันทึก
          </button>
        </>
      }
    >
      <Field label="พนักงาน">
        <p className="text-[14px] font-semibold">
          {emp.name}
          <span className="ml-2 text-[12.5px] font-normal text-muted-foreground">{emp.account?.user}</span>
        </p>
      </Field>

      {/* CEO ไม่อยู่ในรายการ — ไม่ใช่บัญชีพนักงานในทะเบียน */}
      <div className="mt-4 grid gap-2">
        {ROLES.filter((r) => r.key !== "ceo").map((r) => {
          const lock = own.includes(r.key);
          return (
            <label
              key={r.key}
              className={`flex items-center gap-2.5 rounded-[12px] border px-3.5 py-2.5 ${
                lock ? "cursor-default" : "cursor-pointer"
              } ${picked.includes(r.key) ? "border-primary bg-primary/5" : "border-border bg-card"}`}
            >
              <input
                type="checkbox"
                checked={picked.includes(r.key)}
                disabled={lock}
                onChange={() => toggle(r.key)}
                className="size-4 accent-[var(--primary)]"
              />
              <span className="min-w-0 text-[13.5px] font-semibold">{r.label}</span>
              {lock && (
                <em className="ml-auto text-[11.5px] font-semibold text-muted-foreground not-italic">
                  มาจากตำแหน่ง
                </em>
              )}
            </label>
          );
        })}
      </div>
      {warn && <p className="mt-3 text-[12.5px] font-semibold text-destructive">{warn}</p>}
    </Sheet>
  );
}
