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
import { thaiDate, todayIso } from "@/lib/format";
import {
  HR_ACC_STATUS,
  HR_EMPTYPE,
  accountRoles,
  hrPos,
  posOf,
  type EmpAccount,
  type Employee,
} from "@/lib/hr-data";
import { HR_ME, createAccount, deleteAccount, resetAccount, setAccountRoles, setAccountStatus, useHr } from "@/lib/hr-store";
import { rolesOfEmployee, suggestUserOf } from "@/lib/hr-data";
import { ROLES, roleLabel, type Role } from "@/lib/role";
import { ConfirmDialog } from "./confirm-dialog";
import { Sheet } from "./lead-dialogs";
import { Field, Input, Select } from "./ui";
import { SearchBox } from "./sales-ui";
import { PhoneCard, PhoneList } from "./acchr-phone";

type Filter = "all" | "active" | "suspended" | "none";

const FILTER_LABEL: Record<Filter, string> = {
  all: "ทั้งหมด",
  active: "ใช้งานอยู่",
  suspended: "ถูกระงับ",
  none: "ยังไม่มีบัญชี",
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
  /* บัญชีที่กำลังจะลบบนมือถือ — ยืนยันในกล่อง เพราะการ์ดไม่มีที่ให้กดสองครั้ง */
  const [deleting, setDeleting] = useState<string | null>(null);
  const hr = useHr();
  const today = todayIso();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  /* กล่องเดียวใช้ทั้งสร้างบัญชีและตั้งรหัสใหม่ — ต่างกันแค่ว่ามีบัญชีอยู่แล้วหรือยัง */
  const [editing, setEditing] = useState<{ id: string; reset: boolean } | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return hr.emp.filter((e) => {
      if (e.status !== "active") return false;
      const st: Filter = e.account ? e.account.status : "none";
      if (filter !== "all" && st !== filter) return false;
      if (q && !`${e.name} ${e.account?.user ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [hr.emp, query, filter]);

  const target = editing ? hr.emp.find((e) => e.id === editing.id) : undefined;

  return (
    <div className="space-y-4">
      <div className="bar">
        <div>
          <h1>จัดการบัญชีผู้ใช้</h1>
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
          <table className="data-table cards-sm min-w-[860px]">
            <thead>
              <tr>
                <th>พนักงาน</th>
                <th style={{ width: 170 }}>ชื่อผู้ใช้</th>
                <th style={{ width: 210 }}>ตำแหน่งในระบบ</th>
                <th style={{ width: 150 }}>สถานะบัญชี</th>
                <th style={{ width: 150 }}>สร้างเมื่อ</th>
                <th className="c" style={{ width: 240 }} aria-label="จัดการ" />
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
                    onNew={() => setEditing({ id: e.id, reset: false })}
                    onReset={() => setEditing({ id: e.id, reset: true })}
                    onRoles={() => setRoling(e.id)}
                    onToggle={() =>
                      setAccountStatus(e.id, e.account?.status === "active" ? "suspended" : "active")
                    }
                    onDelete={() => deleteAccount(e.id)}
                    mine={e.id === HR_ME}
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
                  st ? (
                    <span className={`tag ${st.cls}`}>
                      <i />
                      {st.label}
                    </span>
                  ) : (
                    <span className="tag t-miss">
                      <i />
                      ยังไม่มีบัญชี
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
                  a ? (
                    <>
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
                      {e.id !== HR_ME && (
                        <button
                          type="button"
                          className="btn glass-thin !text-destructive"
                          onClick={() => setDeleting(e.id)}
                        >
                          ลบบัญชี
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn solid btn-solid"
                      onClick={() => setEditing({ id: e.id, reset: false })}
                    >
                      สร้างบัญชี
                    </button>
                  )
                }
              />
            );
          })}
        </PhoneList>
      </section>

      {target && editing && (
        <AccountDialog
          key={`${target.id}-${editing.reset}`}
          emp={target}
          reset={editing.reset}
          taken={hr.emp
            .filter((x) => x.id !== target.id && x.account)
            .map((x) => x.account!.user)}
          today={today}
          onClose={() => setEditing(null)}
        />
      )}

      {/* ยืนยันลบบัญชี — ใช้จากการ์ดบนมือถือ (ตารางบนจอคอมกดปุ่มซ้ำสองครั้งแทน) */}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="ลบบัญชีผู้ใช้"
        description={`ลบบัญชีของ ${hr.emp.find((e) => e.id === deleting)?.name ?? ""}`}
        detail="คนนี้จะเข้าระบบไม่ได้จนกว่าจะสร้างบัญชีใหม่ · ข้อมูลพนักงาน เวลาทำงาน และเงินเดือนยังอยู่ครบ"
        confirmLabel="ลบบัญชี"
        tone="destructive"
        onConfirm={() => {
          if (deleting) deleteAccount(deleting);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />

      {roling && hr.emp.find((e) => e.id === roling)?.account && (
        <RolesDialog emp={hr.emp.find((e) => e.id === roling)!} onClose={() => setRoling(null)} />
      )}

    </div>
  );
}

function AccountRow({
  emp,
  onNew,
  onReset,
  onRoles,
  onToggle,
  onDelete,
  mine,
}: {
  emp: Employee;
  onNew: () => void;
  onReset: () => void;
  onRoles: () => void;
  onToggle: () => void;
  onDelete: () => void;
  /** บัญชีของคนที่กำลังใช้งานอยู่ — ลบตัวเองไม่ได้ */
  mine: boolean;
}) {
  const a = emp.account;
  /* ลบต้องกดสองครั้ง — ลบพลาดแล้วคนนั้นเข้าระบบไม่ได้จนกว่าจะสร้างบัญชีใหม่ */
  const [delAsk, setDelAsk] = useState(false);
  const st = a ? HR_ACC_STATUS[a.status] : null;
  return (
    <tr>
      <td data-label="พนักงาน">
        <b className="block text-[13.5px] font-semibold">{emp.name}</b>
        {/* ตอนสร้างบัญชีต้องเห็นว่าคนนี้ตำแหน่งอะไรและจ้างแบบไหน (เจ้าของถาม 30 ก.ย. 2569) */}
        {/* ยังไม่มีตำแหน่ง — ข้อความตาม mockup (posLabel) */}
        <span className="why">
          {emp.pos ? posOf(emp).map((v) => hrPos(v).label).join(" · ") : "ยังไม่ได้กรอกข้อมูล"}
          {` · ${HR_EMPTYPE[emp.type].label}`}
        </span>
      </td>
      <td data-label="ชื่อผู้ใช้" className="num">
        {a ? a.user : <span className="muted">ยังไม่มีบัญชี</span>}
      </td>
      <td data-label="ตำแหน่งในระบบ">
        {a ? (
          accountRoles(a).length ? (
            <span className="flex flex-wrap gap-1">
              {accountRoles(a).map((r) => (
                <em key={r} className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-semibold text-muted-foreground not-italic">
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
      <td data-label="จัดการ" className="c">
        {a ? (
          <span className="flex flex-wrap justify-center gap-1.5">
            <button type="button" className="btn glass-thin btn-mini" onClick={onRoles}>
              บทบาท
            </button>
            <button type="button" className="btn glass-thin btn-mini" onClick={onReset}>
              รีเซ็ตรหัสผ่าน
            </button>
            <button type="button" className="btn glass-thin btn-mini" onClick={onToggle}>
              {a.status === "active" ? "ระงับบัญชี" : "คืนสิทธิ์"}
            </button>
            {/* ลบบัญชี ไม่ใช่ลบคน — พนักงานยังอยู่ในทะเบียน · กดสองครั้งกันพลาด */}
            <button
              type="button"
              className={`btn btn-mini ${delAsk ? "solid btn-solid" : "glass-thin !text-destructive"}`}
              title={
                mine
                  ? "ลบบัญชีของตัวเองไม่ได้ ไม่งั้นจะเข้าระบบไม่ได้อีก"
                  : "ลบบัญชีผู้ใช้ของคนนี้ ข้อมูลพนักงานยังอยู่"
              }
              disabled={mine}
              onClick={() => (delAsk ? onDelete() : setDelAsk(true))}
            >
              {delAsk ? "กดอีกครั้งเพื่อลบ" : "ลบบัญชี"}
            </button>
          </span>
        ) : (
          <button type="button" className="btn solid btn-solid btn-mini" onClick={onNew}>
            สร้างบัญชี
          </button>
        )}
      </td>
    </tr>
  );
}

/** สร้างบัญชีใหม่ หรือตั้งรหัสใหม่ให้บัญชีเดิม */
function AccountDialog({
  emp,
  reset,
  taken,
  today,
  onClose,
}: {
  emp: Employee;
  reset: boolean;
  taken: string[];
  today: string;
  onClose: () => void;
}) {
  const [user, setUser] = useState(
    reset ? (emp.account?.user ?? "") : suggestUserOf(emp, taken),
  );
  const [pass, setPass] = useState(tempPass);
  /* ต้นแบบไม่มีตัวเลือกบทบาทในกล่องนี้ — บทบาทของบัญชีกำหนดที่หน้าจัดการบัญชีผู้ใช้ (ปุ่ม "บทบาท")
     รีเซ็ตรหัสคงบทบาทเดิมไว้
     บัญชีใหม่ตั้งบทบาทตาม "ตำแหน่ง" ให้เลย — ทุกบทบาทคือพนักงาน ต่างกันที่งานตามตำแหน่ง
     (เจ้าของสั่ง 29 ก.ย. 2569 · ดู docs/ตำแหน่งและหน้าที่.md) แก้ทีหลังได้ที่ปุ่มบทบาท */
  const roles = reset ? accountRoles(emp.account) : rolesOfEmployee(emp);
  const [warn, setWarn] = useState("");

  function save() {
    const name = user.trim();
    if (name.length < 4) return setWarn("ชื่อผู้ใช้ต้องยาวอย่างน้อย 4 ตัวอักษร");
    if (taken.includes(name)) return setWarn("ชื่อผู้ใช้นี้มีคนใช้แล้ว");
    /* TODO: ต่อ backend แล้วต้องสร้าง/รีเซ็ตบัญชีที่ระบบยืนยันตัวตนจริง แล้วบังคับตั้งรหัสใหม่ครั้งแรก */
    if (reset) resetAccount(emp.id, name, roles);
    else createAccount(emp.id, name, today, roles);
    onClose();
  }

  return (
    <Sheet
      title={reset ? "รีเซ็ตรหัสผ่าน" : "สร้างบัญชีผู้ใช้"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="button" className="btn solid btn-solid" onClick={save}>
            {reset ? "ตั้งรหัสใหม่" : "สร้างบัญชี"}
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
  const [picked, setPicked] = useState<Role[]>(
    accountRoles(emp.account).length ? accountRoles(emp.account) : rolesOfEmployee(emp),
  );
  const [warn, setWarn] = useState("");

  function toggle(r: Role) {
    setWarn("");
    setPicked((list) => (list.includes(r) ? list.filter((x) => x !== r) : [...list, r]));
  }

  return (
    <Sheet
      title="บทบาทของบัญชีนี้"
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
        {ROLES.filter((r) => r.key !== "ceo").map((r) => (
          <label
            key={r.key}
            className={`flex cursor-pointer items-center gap-2.5 rounded-[12px] border px-3.5 py-2.5 ${
              picked.includes(r.key) ? "border-primary bg-primary/5" : "border-border bg-card"
            }`}
          >
            <input
              type="checkbox"
              checked={picked.includes(r.key)}
              onChange={() => toggle(r.key)}
              className="size-4 accent-[var(--primary)]"
            />
            <span className="min-w-0 text-[13.5px] font-semibold">{r.label}</span>
          </label>
        ))}
      </div>
      {warn && <p className="mt-3 text-[12.5px] font-semibold text-destructive">{warn}</p>}
    </Sheet>
  );
}
