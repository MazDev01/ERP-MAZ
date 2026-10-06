"use client";

/*
 * ข้อมูลพนักงาน — ต้นแบบ dose-erp-maz ชุด "ข้อมูลพนักงาน" (1 ต.ค. 2569)
 *
 * แยกกลุ่มตามประเภทการจ้าง (ประจำ · ทดลองงาน · ฝึกงาน) หัวกลุ่มกดยุบ/กางได้ บอกจำนวนคนในกลุ่ม
 * การ์ดละคนเรียงเป็นตาราง การ์ดเป็นแนวตั้ง: อักษรแรกของชื่อในวงกลม จุดสถานะ ชื่อ ตำแหน่ง
 * ป้ายเฉพาะคนที่ต้องจับตา (ทดลองงานใกล้ครบกำหนด · พ้นสภาพ) แล้วปิดท้ายด้วยกล่องเทา
 * ที่บอก แผนก · วันเริ่มงาน · อีเมล · เบอร์โทร
 * กดที่ไหนก็ได้ในการ์ดเพื่อเปิดประวัติเต็ม
 *
 * มือถือ: หัวเรื่องบอกจำนวนคน ปุ่มตัวกรอง (มีจุดแดงเมื่อกรองแผนก/ตำแหน่งอยู่) ช่องค้นหาทรงแคปซูล
 * ชิปสถานะเลื่อนแนวนอน การ์ดเหลือคอลัมน์เดียว และปุ่มกลมเพิ่มพนักงานลอยมุมขวาล่าง
 * แผนก/ตำแหน่งย้ายไปอยู่ในแผ่นเลื่อนขึ้นจากด้านล่าง เพราะหน้าจอแคบวางเรียงกันไม่ได้
 *
 * เพิ่มพนักงานใหม่จากปุ่มบนแถบหัวเรื่อง คนเข้าใหม่เริ่มที่ "ทดลองงาน" เสมอ ระบบไม่ให้เลือกเป็นอย่างอื่น
 * ผ่านทดลองงานทำจากในกล่องประวัติ และต้องระบุเงินเดือนใหม่เสมอ
 * เพราะช่วงทดลองงานจ่ายค่าจ้างรายวัน ตัวเลขเดิมเป็นฐานของอัตรารายวัน คนละความหมายกับเงินเดือน
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { baht, thaiDate, toIsoDate, todayIso, commaInput } from "@/lib/format";
import {
  hrDepts,
  hrDocs,
  HR_EMPTYPE,
  HR_OT_DIVISOR,
  hrPositions,
  HR_STATUS,
  hrDept,
  hrPos,
  holdsPos,
  posOf,
  rolesOfPosition,
  probDaysLeft,
  probLine,
  type DeptKey,
  type DocKey,
  type EmpStatus,
  type EmpType,
  type Employee,
  type PosKey,
} from "@/lib/hr-data";
import { roleLabel } from "@/lib/role";
import {
  addEmployee,
  changePosition,
  lockedUntil,
  passProbation,
  setEmpLeft,
  updateEmpProfile,
  useHr,
  type HrState,
} from "@/lib/hr-store";
import { optionsOf } from "@/lib/options";
import { useFindParam } from "@/lib/deep-link";
import { USERS } from "@/lib/mock-data";
import { useRole } from "@/lib/role";
import { ChevronDownIcon, MailIcon, PhoneIcon, PlusIcon, SearchIcon } from "./icons";
import { Sheet } from "./lead-dialogs";
import { EmployeeDetail } from "./hr-employee-detail";
import { ThaiDatePicker } from "./thai-date-picker";
import { Field, Input, Select, Textarea } from "./ui";
import { ADD_VALUE, useAddOption } from "./add-option";

export function HrEmployeesPage() {
  const hr = useHr();
  /* หน้าอื่นในฝ่ายบุคคลลิงก์มาหาคนเดียวด้วย ?find=<ชื่อ> ใช้ช่องค้นหาเดิมเป็นตัวกรอง */
  const find = useFindParam();
  const [query, setQuery] = useState(find);
  const [dept, setDept] = useState<DeptKey | "">("");
  const [pos, setPos] = useState<PosKey | "">("");
  const [status, setStatus] = useState<EmpStatus | "">("");
  /** กลุ่มที่ผู้ใช้ยุบไว้ จำไว้ข้ามการกรอง ไม่ต้องกางใหม่ทุกครั้ง */
  const [closed, setClosed] = useState<Partial<Record<EmpType, boolean>>>({});
  const [viewing, setViewing] = useState<string | null>(null);
  const [passing, setPassing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /** แผ่นตัวกรองสถานะ/แผนก/ตำแหน่งของมือถือเปิดอยู่หรือไม่ */
  const [sheet, setSheet] = useState(false);
  /** คนที่เพิ่งเพิ่ม — รอแถวขึ้นก่อนแล้วค่อยเลื่อนไปหา */
  const justAdded = useRef<string | null>(null);
  const today = todayIso();

  useEffect(() => {
    if (!justAdded.current) return;
    const row = document.querySelector(`[data-emp-id="${justAdded.current}"]`);
    if (!row) return;
    justAdded.current = null;
    row.scrollIntoView({ block: "center" });
  }, [hr.emp, query]);

  /* ตัวเลือกตำแหน่งแคบลงตามแผนกที่เลือก ไม่ใช่โชว์ตำแหน่งที่เลือกแล้วไม่มีใครโผล่ */
  const posOptions = hrPositions().filter((p) => !dept || p.dept === dept);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return hr.emp.filter((e) => {
      /* กรองด้วยทุกตำแหน่งที่ถืออยู่ ไม่ใช่เฉพาะตำแหน่งหลัก */
      if (dept && !posOf(e).some((v) => hrPos(v).dept === dept)) return false;
      if (pos && !holdsPos(e, pos as PosKey)) return false;
      if (status && e.status !== status) return false;
      if (q && !`${e.name} ${e.nick}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [hr.emp, query, dept, pos, status]);

  /* กลุ่มที่ไม่มีใครเข้าเงื่อนไข ไม่ต้องขึ้นหัวกลุ่มเปล่า */
  const groups = useMemo(
    () =>
      (Object.keys(HR_EMPTYPE) as EmpType[])
        .map((t) => ({ type: t, rows: rows.filter((e) => e.type === t) }))
        .filter((g) => g.rows.length > 0),
    [rows],
  );

  const current = viewing ? hr.emp.find((e) => e.id === viewing) : undefined;
  const passEmp = passing ? hr.emp.find((e) => e.id === passing) : undefined;
  const editEmp = editing ? hr.emp.find((e) => e.id === editing) : undefined;

  return (
    <div className="space-y-4">
      <div className="bar max-md:hidden!">
        <div>
        </div>
        <div className="tools w-full flex-wrap items-end sm:w-auto">
          <Field label="ค้นหา" className="max-sm:w-full">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ชื่อ หรือชื่อเล่น"
              aria-label="ค้นหาพนักงาน"
              className="w-full sm:w-[196px]"
            />
          </Field>
          <Field label="แผนก" className="max-sm:min-w-0 max-sm:flex-1">
            <Select
              value={dept}
              onChange={(e) => {
                const next = e.target.value as DeptKey | "";
                setDept(next);
                /* ตำแหน่งที่เลือกไว้อาจไม่อยู่ในแผนกใหม่ ปล่อยไว้จะกรองได้ศูนย์แถวโดยไม่รู้ตัว */
                if (next && pos && hrPos(pos as PosKey).dept !== next) setPos("");
              }}
              aria-label="กรองตามแผนก"
              className="w-full sm:w-[136px]"
            >
              <option value="">ทุกแผนก</option>
              {hrDepts().map((d) => (
                <option key={d.v} value={d.v}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ตำแหน่ง" className="max-sm:min-w-0 max-sm:flex-1">
            <Select
              value={pos}
              onChange={(e) => setPos(e.target.value as PosKey | "")}
              aria-label="กรองตามตำแหน่ง"
              className="w-full sm:w-[136px]"
            >
              <option value="">ทุกตำแหน่ง</option>
              {posOptions.map((p) => (
                <option key={p.v} value={p.v}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="สถานะ" className="max-sm:min-w-0 max-sm:flex-1">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as EmpStatus | "")}
              aria-label="กรองตามสถานะ"
              className="w-full sm:w-[136px]"
            >
              <option value="">ทุกสถานะ</option>
              <option value="active">ปฏิบัติงานอยู่</option>
              <option value="left">พ้นสภาพ</option>
            </Select>
          </Field>
          <button
            type="button"
            className="btn solid btn-solid"
            style={{ height: 38 }}
            onClick={() => setAdding(true)}
          >
            + เพิ่มพนักงาน
          </button>
        </div>
      </div>

      {/* ── มือถือ: หัวเรื่อง + ค้นหา + ชิปสถานะ ── */}
      <div className="md:hidden">
        <div className="flex items-center gap-2.5">
          <h1 className="flex-1 text-[20px] font-bold">
            พนักงาน
            <small className="num ml-1.5 text-[12.5px] font-medium text-muted-foreground">{rows.length} คน</small>
          </h1>
          <button
            type="button"
            className="relative grid size-[42px] flex-none place-items-center rounded-full border border-border bg-card text-foreground shadow-[0_4px_10px_-6px_rgb(90_20_35/0.3)]"
            onClick={() => setSheet(true)}
            aria-label="ตัวกรองแผนกและตำแหน่ง"
            aria-haspopup="dialog"
          >
            <FilterIcon className="size-[19px]" strokeWidth={2.2} />
            {/* จุดแดงบอกว่ายังกรองอยู่ ไม่งั้นเปิดมาเห็นคนน้อยแล้วไม่รู้ว่าทำไม */}
            {(dept || pos) && (
              <i className="absolute top-1.5 right-[7px] size-2 rounded-full border-2 border-white bg-primary" />
            )}
          </button>
        </div>

        <label className="mt-2 flex h-[46px] items-center gap-2 rounded-full border border-border bg-card px-3.5">
          <SearchIcon className="size-[18px] flex-none text-muted-foreground" strokeWidth={2.2} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาชื่อ หรือชื่อเล่น"
            aria-label="ค้นหาพนักงาน"
            className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] outline-none"
          />
        </label>

        <div
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pt-3 pb-1 [scrollbar-width:none]"
          role="tablist"
          aria-label="สถานะ"
        >
          {STATUS_CHIPS.map((c) => (
            <button
              key={c.v}
              type="button"
              role="tab"
              aria-selected={status === c.v}
              className={`h-[38px] flex-none rounded-full px-4 text-[13.5px] font-semibold ${
                status === c.v ? "bg-primary text-white" : "bg-[#EDE8EA] text-[#6E6164]"
              }`}
              onClick={() => setStatus(c.v)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* แยกกลุ่มตามประเภทการจ้าง หัวกลุ่มกดยุบ/กางได้ การ์ดข้างในเรียงเป็นตาราง */}
      {rows.length === 0 ? (
        <p className="px-5 py-9 text-center text-[13.5px] text-muted-foreground">
          {query ? "ไม่พบชื่อที่ค้นหา" : "ไม่มีพนักงานตามเงื่อนไขที่เลือก"}
        </p>
      ) : (
        <div className="flex flex-col gap-3.5">
          {groups.map((g) => (
            <details
              key={g.type}
              open={!closed[g.type]}
              onToggle={(ev) => {
                const open = ev.currentTarget.open;
                setClosed((c) => ({ ...c, [g.type]: !open }));
              }}
            >
              <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-[14px] border border-[#ECEEF2] bg-card px-4 py-3 select-none hover:border-[#E4C7CC]">
                <i
                  aria-hidden="true"
                  className="size-2.5 flex-none rounded-full"
                  style={{ background: TYPE_DOT[g.type] }}
                />
                <b className="text-[15px] font-bold">{HR_EMPTYPE[g.type].label}</b>
                <span className="num rounded-[20px] bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                  {g.rows.length} คน
                </span>
                <ChevronDownIcon
                  className={`ml-auto size-[18px] text-muted-foreground transition-transform ${
                    closed[g.type] ? "" : "rotate-180"
                  }`}
                  strokeWidth={2.2}
                />
              </summary>
              <div className="mt-3.5 grid items-stretch gap-3 md:grid-cols-[repeat(auto-fill,minmax(300px,1fr))] md:gap-[18px]">
                {g.rows.map((e) => (
                  <EmpCard key={e.id} emp={e} query={query} today={today} onOpen={() => setViewing(e.id)} />
                ))}
              </div>
            </details>
          ))}
        </div>
      )}

      {/* มือถือ: ปุ่มกลมเพิ่มพนักงาน ลอยเหนือแถบเมนูล่าง ชุดเดียวกับหน้าอื่น */}
      <button
        type="button"
        className="btn solid btn-solid fab-mobile md:hidden!"
        onClick={() => setAdding(true)}
      >
        <PlusIcon className="size-[15px]" strokeWidth={2.2} />
        <span className="lbl">เพิ่มพนักงาน</span>
      </button>

      {sheet && (
        <FilterSheet
          dept={dept}
          pos={pos}
          posOptions={posOptions}
          onDept={(v) => {
            setDept(v);
            if (v && pos && hrPos(pos as PosKey).dept !== v) setPos("");
          }}
          onPos={setPos}
          onClear={() => {
            /* ต้นแบบ: ล้างแล้วปิดแผ่นเลย ไม่ต้องกดดูผลลัพธ์ซ้ำ */
            setDept("");
            setPos("");
            setSheet(false);
          }}
          onClose={() => setSheet(false)}
        />
      )}

      {adding && (
        <AddDialog
          hr={hr}
          today={today}
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            /* ตามต้นแบบ: ล้างช่องค้นหาแล้วเลื่อนไปที่การ์ดของคนที่เพิ่งเพิ่ม */
            justAdded.current = id;
            setQuery("");
          }}
        />
      )}

      {current && (
        <EmployeeDetail
          emp={current}
          today={today}
          onPass={() => setPassing(current.id)}
          onEdit={() => setEditing(current.id)}
          onClose={() => setViewing(null)}
        />
      )}

      {passEmp && (
        <PassDialog emp={passEmp} today={today} onClose={() => setPassing(null)} />
      )}

      {editEmp && (
        <EditDialog emp={editEmp} today={today} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ─── ตัวกรองและการ์ดพนักงาน ───────────────────────────────────────

/** ชิปสถานะบนมือถือ — ชุดเดียวกับดรอปดาวน์สถานะของจอคอม */
const STATUS_CHIPS: { v: EmpStatus | ""; label: string }[] = [
  { v: "", label: "ทั้งหมด" },
  { v: "active", label: "ปฏิบัติงานอยู่" },
  { v: "left", label: "พ้นสภาพ" },
];

/** จุดสีหน้าหัวกลุ่ม — ประจำเขียว ทดลองงานส้ม ฝึกงานน้ำเงิน */
const TYPE_DOT: Record<EmpType, string> = {
  full: "var(--success)",
  probat: "var(--warning)",
  intern: "#2F6FDB",
};

/* แผ่นตัวกรองของมือถือ — แผนกกับตำแหน่ง (ค้นหากับสถานะอยู่บนหน้าแล้ว) */
function FilterSheet({
  dept,
  pos,
  posOptions,
  onDept,
  onPos,
  onClear,
  onClose,
}: {
  dept: DeptKey | "";
  pos: PosKey | "";
  posOptions: { v: PosKey; label: string }[];
  onDept: (v: DeptKey | "") => void;
  onPos: (v: PosKey | "") => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      title="ตัวกรอง"
      onClose={onClose}
      footer={
        <div className="flex w-full gap-2.5">
          <button
            type="button"
            className="btn glass-thin h-12 flex-1 justify-center rounded-[14px] text-[14px] font-bold"
            onClick={onClear}
          >
            ล้างตัวกรอง
          </button>
          <button
            type="button"
            className="btn solid btn-solid h-12 flex-[1.4] justify-center rounded-[14px] text-[14px] font-bold"
            onClick={onClose}
          >
            ดูผลลัพธ์
          </button>
        </div>
      }
    >
      <Field label="แผนก">
        <Select value={dept} onChange={(e) => onDept(e.target.value as DeptKey | "")} className="w-full">
          <option value="">ทุกแผนก</option>
          {hrDepts().map((d) => (
            <option key={d.v} value={d.v}>
              {d.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="ตำแหน่ง" className="mt-3">
        <Select value={pos} onChange={(e) => onPos(e.target.value as PosKey | "")} className="w-full">
          <option value="">ทุกตำแหน่ง</option>
          {posOptions.map((p) => (
            <option key={p.v} value={p.v}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
    </Sheet>
  );
}

/** ไอคอนตัวกรอง — ต้นแบบใช้ขีดสามเส้นลดหลั่น ไม่ใช่กรวย */
function FilterIcon(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  );
}

/** เน้นส่วนที่ตรงกับคำค้น — แบ่งเป็นสามท่อนแล้วให้ React วาด ไม่ยัด HTML ดิบ */
function Mark({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="rounded-[3px] bg-[#FFF6C9] px-px">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  );
}

function EmpCard({
  emp,
  query,
  today,
  onOpen,
}: {
  emp: Employee;
  query: string;
  today: string;
  onOpen: () => void;
}) {
  const p = hrPos(emp.pos);
  const here = emp.status === "active";
  const onProbation = emp.type === "probat" && here;
  const left = onProbation ? probDaysLeft(emp.startedAt, today) : null;
  /* ไม่มีที่อัปโหลดรูปพนักงาน ใช้อักษรแรกของชื่อแทน (ข้ามสระหน้า เ แ โ ใ ไ) ไม่เอารูปคนอื่นมาแทน */
  const ini = (emp.name || "?").replace(/^[เแโใไ]/, "").charAt(0);

  /* ป้ายเฉพาะคนที่ต้องจับตา — ทดลองงานใกล้ครบกำหนด กับคนที่พ้นสภาพแล้ว */
  const tag = !here
    ? { label: `พ้นสภาพ ${thaiDate(emp.leftAt ?? "")}`, skin: "bg-muted text-muted-foreground" }
    : left === null
      ? null
      : left < 0
        ? {
            label: `เลยกำหนดทดลองงาน ${Math.abs(left)} วัน`,
            skin: "bg-[var(--destructive-soft)] text-destructive",
          }
        : {
            label: `ทดลองงาน · ครบกำหนด${left === 0 ? "วันนี้" : `อีก ${left} วัน`}`,
            skin: "bg-[var(--warning-soft)] text-[var(--warning)]",
          };

  return (
    /* กดที่ไหนก็ได้ในการ์ดเพื่อเปิดประวัติ — รองรับคีย์บอร์ดด้วย Enter/Space */
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onOpen();
        }
      }}
      aria-label={`ดูประวัติของ ${emp.name}`}
      data-emp-id={emp.id}
      className={`group/ec flex cursor-pointer flex-col gap-3.5 rounded-[20px] border border-[#ECEEF2] bg-card px-[18px] pt-[18px] pb-4 shadow-[0_1px_2px_rgb(28_20_45/0.03)] transition hover:border-[#E4C7CC] hover:shadow-[0_10px_26px_-12px_rgb(28_20_45/0.18)] ${
        here ? "" : "opacity-60"
      }`}
    >
      {/* รูปวงกลมกลางการ์ด จุดมุมล่างบอกสถานะ */}
      <div className="relative flex justify-center pt-1">
        <span className="relative size-[68px] flex-none">
          <span
            aria-hidden="true"
            className="grid size-[68px] place-items-center rounded-full bg-[var(--destructive-soft)] text-2xl font-bold text-primary"
          >
            {ini}
          </span>
          <i
            title={HR_STATUS[emp.status].label}
            aria-label={HR_STATUS[emp.status].label}
            role="img"
            className={`absolute right-[3px] bottom-[3px] size-3.5 rounded-full border-[2.5px] border-white ${
              here ? "bg-[var(--success)]" : "bg-[#B5BAC4]"
            }`}
          />
        </span>
        {/* จุดสามจุดบอกว่าการ์ดนี้กดเข้าไปดูได้ โผล่ตอนชี้เมาส์ */}
        <span
          aria-hidden="true"
          className="absolute -top-1.5 -right-1.5 grid h-7 w-8 place-items-center rounded-lg text-foreground opacity-0 group-hover/ec:bg-muted group-hover/ec:opacity-100"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.9" />
            <circle cx="12" cy="12" r="1.9" />
            <circle cx="19" cy="12" r="1.9" />
          </svg>
        </span>
      </div>

      {/* ชื่อและตำแหน่ง */}
      <div className="-mt-1 text-center">
        <b className="block text-[15px] leading-snug font-bold">
          <Mark text={emp.name} query={query} />
        </b>
        <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
          {p.label}
          {/* ควบตำแหน่งอื่นด้วย — ตำแหน่งหลักยังเป็นตัวคิดเงินเดือนและสายอนุมัติ */}
          {(emp.posMore ?? []).length > 0 && ` · ควบ ${(emp.posMore ?? []).map((v) => hrPos(v).label).join(" · ")}`}
        </span>
        {tag && (
          <span className={`mt-[7px] inline-block rounded-[20px] px-2.5 py-0.5 text-[11px] font-semibold ${tag.skin}`}>
            {tag.label}
          </span>
        )}
      </div>

      {/* กล่องเทาปิดท้าย — แผนก วันเริ่มงาน และช่องทางติดต่อ */}
      <div className="mt-auto flex flex-col gap-3 rounded-[14px] bg-[#F6F7F9] px-3.5 py-3.5">
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
          <dt className="text-[11.5px] leading-[18px] text-muted-foreground">แผนก</dt>
          <dt className="text-right text-[11.5px] leading-[18px] text-muted-foreground">วันเริ่มงาน</dt>
          <dd className="truncate text-[13px] leading-[22px] font-semibold">{hrDept(p.dept).label}</dd>
          <dd className="num truncate text-right text-[13px] leading-[22px] font-semibold">
            {thaiDate(emp.startedAt)}
          </dd>
        </dl>
        <div className="flex flex-col gap-[7px] text-[12.5px]">
          <span className="flex min-w-0 items-center gap-2.5">
            <MailIcon className="size-[15px] flex-none text-muted-foreground" strokeWidth={1.8} />
            <em className={`truncate not-italic ${emp.email ? "" : "text-muted-foreground"}`}>
              {emp.email || "ไม่มีอีเมล"}
            </em>
          </span>
          <span className="flex min-w-0 items-center gap-2.5">
            <PhoneIcon className="size-[15px] flex-none text-muted-foreground" strokeWidth={1.8} />
            <em className={`num truncate not-italic ${emp.phone ? "" : "text-muted-foreground"}`}>
              {emp.phone || "ไม่มีเบอร์โทร"}
            </em>
          </span>
        </div>
      </div>
    </div>
  );
}


// ─── แก้ไขข้อมูลพนักงาน ──────────────────────────────────────────

/*
 * แยกเป็นสองแบบตามผลกระทบต่อเงินเดือน
 *   ข้อมูลส่วนตัว ติดต่อ ผู้บังคับบัญชา เอกสาร — แก้ทับได้เลย
 *   ตำแหน่ง/เงินเดือน และพ้นสภาพ — ต้องมีวันที่มีผล และต้องหลังรอบเงินเดือนที่ปิดแล้ว
 *     ตำแหน่ง/เงินเดือนต่อเป็นแถวประวัติใหม่ ไม่แก้แถวเดิม
 */
function EditDialog({ emp, today, onClose }: { emp: Employee; today: string; onClose: () => void }) {
  const role = useRole();
  const hr = useHr();
  const cur = emp.history[emp.history.length - 1];
  const lock = lockedUntil(hr);

  const [f, setF] = useState({
    /* กรอกแยกช่องเหมือนหน้าเพิ่มพนักงาน — คนเก่าที่เก็บเป็นชื่อเต็ม ตัดที่ช่องว่างแรกให้ */
    first: emp.first ?? emp.name.trim().split(/\s+/)[0] ?? "",
    last: emp.last ?? emp.name.trim().split(/\s+/).slice(1).join(" "),
    /* ชื่ออังกฤษใช้ตั้งชื่อผู้ใช้ตอนสร้างบัญชี — คนเก่ายังไม่มี กรอกเพิ่มที่นี่ได้ */
    firstEn: emp.firstEn ?? "",
    lastEn: emp.lastEn ?? "",
    nick: emp.nick,
    sex: emp.sex,
    birth: emp.birth,
    edu: emp.edu,
    exp: emp.exp.join("\n"),
    phone: emp.phone,
    email: emp.email,
    address: emp.address,
    sosName: emp.sos.name,
    sosRel: emp.sos.rel,
    sosPhone: emp.sos.phone,
    boss: emp.boss,
  });
  const [docs, setDocs] = useState<DocKey[]>(emp.docs);
  /* เพิ่มชนิดเอกสารใหม่จากตรงนี้ได้ — เพิ่มแล้วติ๊กให้เลยว่าได้รับแล้ว */
  const addDoc = useAddOption({ catalog: "docs" }, (v) => setDocs((x) => (x.includes(v) ? x : [...x, v])));
  const [pos, setPos] = useState<PosKey>(cur.pos);
  /* ตำแหน่งควบ — เจ้าของสั่ง 28 ก.ย. 2569 ให้หนึ่งคนถือได้หลายตำแหน่ง */
  const [posMore, setPosMore] = useState<PosKey[]>(emp.posMore ?? []);
  const addPos = useAddOption({ catalog: "positions", dept: hrPos(cur.pos).dept }, setPos);
  const addSex = useAddOption({ list: "sex" }, (v) => setF((x) => ({ ...x, sex: v })));
  const [salary, setSalary] = useState(commaInput(String(cur.salary)));
  const [posAt, setPosAt] = useState("");
  const [posNote, setPosNote] = useState("");
  const [left, setLeft] = useState(emp.status === "left");
  const [leftAt, setLeftAt] = useState(emp.leftAt ?? "");
  const [leftWhy, setLeftWhy] = useState(emp.leftWhy ?? "");
  const [picker, setPicker] = useState<"" | "birth" | "pos" | "left">("");
  const [tried, setTried] = useState(false);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((v) => ({ ...v, [k]: e.target.value }));

  const rawSalary = salary.replace(/,/g, "").trim();
  const salaryOk = /^\d+(\.\d+)?$/.test(rawSalary) && Number(rawSalary) > 0;
  const posChanged = pos !== cur.pos || (salaryOk && Number(rawSalary) !== cur.salary);
  const leftChanged =
    left !== (emp.status === "left") ||
    (left && (leftAt !== (emp.leftAt ?? "") || leftWhy.trim() !== (emp.leftWhy ?? "")));
  /* วันที่มีผลต้องหลังรอบเงินเดือนที่ปิดแล้ว ไม่งั้นตัวเลขของรอบที่ปิดไปจะเปลี่ยนเอง */
  const minAt = lock && lock >= emp.startedAt ? isoAfter(lock) : emp.startedAt;

  const errors: string[] = [];
  if (!f.first.trim()) errors.push("ระบุชื่อ (ไทย)");
  if (!f.last.trim()) errors.push("ระบุนามสกุล (ไทย)");
  if (!f.phone.trim()) errors.push("ระบุเบอร์โทรศัพท์");
  if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) errors.push("อีเมลไม่ถูกรูปแบบ");
  if (!salaryOk) errors.push("เงินเดือนต้องเป็นตัวเลขมากกว่าศูนย์");
  if (posChanged && !posAt) errors.push("ปรับตำแหน่งหรือเงินเดือนต้องระบุวันที่มีผล");
  if (posChanged && posAt && posAt < minAt) errors.push("วันที่มีผลต้องหลังรอบเงินเดือนที่ปิดแล้ว");
  if (posChanged && !posNote.trim()) errors.push("ระบุเหตุผลของการปรับตำแหน่งหรือเงินเดือน");
  if (leftChanged && left && (!leftAt || !leftWhy.trim())) errors.push("พ้นสภาพต้องระบุวันที่และเหตุผล");
  if (leftChanged && left && leftAt && leftAt < minAt) errors.push("วันพ้นสภาพต้องหลังรอบเงินเดือนที่ปิดแล้ว");

  function save() {
    setTried(true);
    if (errors.length) return;
    updateEmpProfile(emp.id, {
      name: `${f.first.trim()} ${f.last.trim()}`.trim(),
      first: f.first.trim(),
      last: f.last.trim(),
      firstEn: f.firstEn.trim(),
      lastEn: f.lastEn.trim(),
      nick: f.nick.trim(),
      sex: f.sex,
      birth: f.birth,
      edu: f.edu.trim(),
      exp: f.exp.split("\n").map((x) => x.trim()).filter(Boolean),
      phone: f.phone.trim(),
      email: f.email.trim(),
      address: f.address.trim(),
      sos: { name: f.sosName.trim(), rel: f.sosRel.trim(), phone: f.sosPhone.trim() },
      boss: f.boss,
      docs: hrDocs().map((d) => d.v).filter((v) => docs.includes(v)),
      /* ตำแหน่งหลักที่เพิ่งเลือกไว้ต้องไม่ซ้ำอยู่ในรายการควบ */
      posMore: posMore.filter((v) => v !== pos),
    }, USERS[role].name);
    if (posChanged) changePosition(emp.id, posAt, pos, Number(rawSalary), posNote.trim());
    if (leftChanged) setEmpLeft(emp.id, left ? leftAt : "", left ? leftWhy.trim() : "");
    onClose();
  }

  const bosses = hr.emp.filter((e) => e.id !== emp.id && e.status === "active");

  return (
    <Sheet
      title={`แก้ไขข้อมูล · ${emp.name}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="button" className="btn solid btn-solid" onClick={save}>
            บันทึก
          </button>
        </>
      }
    >
      <div onClick={() => setPicker("")}>
        <Sect title="ประวัติส่วนตัว">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="ชื่อ (ไทย)" required>
              <Input value={f.first} onChange={set("first")} aria-label="ชื่อภาษาไทย" />
            </Field>
            <Field label="นามสกุล (ไทย)" required>
              <Input value={f.last} onChange={set("last")} aria-label="นามสกุลภาษาไทย" />
            </Field>
            <Field label="ชื่อ-สกุล ภาษาอังกฤษ">
              <span className="flex gap-2">
                <Input value={f.firstEn} onChange={set("firstEn")} placeholder="เช่น Somchai" aria-label="ชื่อภาษาอังกฤษ" />
                <Input value={f.lastEn} onChange={set("lastEn")} placeholder="เช่น Jaidee" aria-label="นามสกุลภาษาอังกฤษ" />
              </span>
            </Field>
            <Field label="ชื่อเล่น">
              <Input value={f.nick} onChange={set("nick")} />
            </Field>
            <Field label="เพศ">
              {/* อ่านจากข้อมูลหลัก — เพิ่มเพศใหม่แล้วต้องขึ้นให้เลือกที่นี่ทันที */}
              <Select
                value={f.sex}
                onChange={(e) => addSex.pick(e.target.value) || setF((x) => ({ ...x, sex: e.target.value }))}
              >
                <option value="">ยังไม่ระบุ</option>
                {optionsOf("sex").map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
                {addSex.option}
              </Select>
            </Field>
            {addSex.dialog}
            <Field label="วันเกิด">
              <ThaiDatePicker
                value={f.birth}
                max={today}
                open={picker === "birth"}
                label="วันเกิด"
                onToggle={() => setPicker((v) => (v === "birth" ? "" : "birth"))}
                onPick={(iso) => {
                  setF((v) => ({ ...v, birth: iso }));
                  setPicker("");
                }}
              />
            </Field>
            <Field label="วุฒิการศึกษา" className="sm:col-span-2">
              <Input value={f.edu} onChange={set("edu")} />
            </Field>
            <Field label="ประสบการณ์ทำงาน" hint="บรรทัดละหนึ่งรายการ" className="sm:col-span-2">
              <Textarea rows={3} value={f.exp} onChange={set("exp")} />
            </Field>
          </div>
        </Sect>

        <Sect title="ข้อมูลติดต่อ">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="เบอร์โทรศัพท์" required>
              <Input inputMode="tel" value={f.phone} onChange={set("phone")} />
            </Field>
            <Field label="อีเมล">
              <Input type="email" value={f.email} onChange={set("email")} />
            </Field>
            <Field label="ที่อยู่" className="sm:col-span-2">
              <Textarea rows={2} value={f.address} onChange={set("address")} />
            </Field>
            <Field label="ผู้ติดต่อฉุกเฉิน">
              <Input value={f.sosName} onChange={set("sosName")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ความสัมพันธ์">
                <Input value={f.sosRel} onChange={set("sosRel")} />
              </Field>
              <Field label="เบอร์ผู้ติดต่อ">
                <Input inputMode="tel" value={f.sosPhone} onChange={set("sosPhone")} />
              </Field>
            </div>
          </div>
        </Sect>

        <Sect title="การจ้างงาน">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="ผู้บังคับบัญชา">
              <Select value={f.boss} onChange={set("boss")}>
                <option value="">ไม่มี</option>
                {bosses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} · {hrPos(b.pos).label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <h4 className="mt-4 mb-2 text-[12.5px] font-semibold">ปรับตำแหน่ง / เงินเดือน</h4>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="ตำแหน่ง">
              <Select value={pos} onChange={(e) => addPos.pick(e.target.value) || setPos(e.target.value as PosKey)}>
                {hrDepts().map((d) => (
                  <optgroup key={d.v} label={d.label}>
                    {hrPositions().filter((x) => x.dept === d.v).map((x) => (
                      <option key={x.v} value={x.v}>
                        {x.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {addPos.option}
              </Select>
            </Field>

            <Field label="ตำแหน่งควบ" hint="ทำหลายตำแหน่งได้ · เงินเดือนและสายอนุมัติยังคิดจากตำแหน่งหลักด้านซ้าย">
              <div className="flex flex-wrap gap-1.5">
                {hrPositions()
                  .filter((x) => x.v !== pos)
                  .map((x) => {
                    const on = posMore.includes(x.v);
                    return (
                      <button
                        key={x.v}
                        type="button"
                        aria-pressed={on}
                        className={`btn btn-mini ${on ? "solid btn-solid" : "glass-thin"}`}
                        onClick={() =>
                          setPosMore((list) => (on ? list.filter((v) => v !== x.v) : [...list, x.v]))
                        }
                      >
                        {x.label}
                      </button>
                    );
                  })}
              </div>
            </Field>
            {addPos.dialog}
            <Field label="เงินเดือน (บาท)">
              <Input inputMode="decimal" value={salary} onChange={(e) => setSalary(commaInput(e.target.value))} />
            </Field>
            {posChanged && (
              <>
                <Field label="วันที่มีผล" required>
                  <ThaiDatePicker
                    value={posAt}
                    min={minAt}
                    open={picker === "pos"}
                    label="วันที่มีผล"
                    onToggle={() => setPicker((v) => (v === "pos" ? "" : "pos"))}
                    onPick={(iso) => {
                      setPosAt(iso);
                      setPicker("");
                    }}
                  />
                </Field>
                <Field label="เหตุผล" required>
                  <Input
                    value={posNote}
                    onChange={(e) => setPosNote(e.target.value)}
                    placeholder="เช่น ปรับประจำปี · เลื่อนตำแหน่ง"
                  />
                </Field>
              </>
            )}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            {posChanged
              ? "บันทึกเป็นประวัติแถวใหม่ ตัวเลขก่อนวันที่มีผลไม่เปลี่ยน"
              : "แก้ตำแหน่งหรือเงินเดือนแล้วจะให้ระบุวันที่มีผลและเหตุผล"}
            {lock && ` · รอบเงินเดือนปิดถึง ${thaiDate(lock)} วันที่มีผลต้องหลังวันนั้น`}
          </p>

          <label className="mt-4 flex cursor-pointer items-center gap-2 text-[13px] font-semibold">
            <input
              type="checkbox"
              checked={left}
              onChange={(e) => setLeft(e.target.checked)}
              className="size-4 accent-[var(--primary)]"
            />
            พ้นสภาพพนักงาน
          </label>
          {left && (
            <div className="mt-2.5 grid gap-3.5 sm:grid-cols-2">
              <Field label="วันที่พ้นสภาพ" required>
                <ThaiDatePicker
                  value={leftAt}
                  min={minAt}
                  open={picker === "left"}
                  label="วันที่พ้นสภาพ"
                  onToggle={() => setPicker((v) => (v === "left" ? "" : "left"))}
                  onPick={(iso) => {
                    setLeftAt(iso);
                    setPicker("");
                  }}
                />
              </Field>
              <Field label="เหตุผล" required>
                <Input
                  value={leftWhy}
                  onChange={(e) => setLeftWhy(e.target.value)}
                  placeholder="เช่น ลาออก · หมดสัญญา"
                />
              </Field>
            </div>
          )}
        </Sect>

        <Sect title="เอกสารประกอบ">
          <ul className="grid gap-1.5 text-[13px] sm:grid-cols-2">
            {hrDocs().map((d) => (
              <li key={d.v}>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={docs.includes(d.v)}
                    onChange={(e) =>
                      setDocs((v) => (e.target.checked ? [...v, d.v] : v.filter((x) => x !== d.v)))
                    }
                    className="size-4 accent-[var(--primary)]"
                  />
                  {d.label}
                  {d.req && <span className="text-destructive">*</span>}
                </label>
              </li>
            ))}
          </ul>
          {addDoc.canAdd && (
            <button type="button" className="lnk mt-2 text-[12.5px]" onClick={() => addDoc.pick(ADD_VALUE)}>
              ＋ เพิ่มชนิดเอกสาร
            </button>
          )}
          {addDoc.dialog}
        </Sect>
      </div>

      {tried && errors.length > 0 && (
        <ul className="mt-4 list-disc rounded-[11px] border border-[rgba(192,18,31,.2)] bg-[var(--destructive-soft)] py-2.5 pr-3.5 pl-8 text-[12.5px] text-destructive">
          {errors.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/** วันถัดไปของวันที่แบบ yyyy-mm-dd */
function isoAfter(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return toIsoDate(new Date(y, m - 1, d + 1));
}

// ─── บันทึกผ่านทดลองงาน ──────────────────────────────────────────

function PassDialog({ emp, today, onClose }: { emp: Employee; today: string; onClose: () => void }) {
  const [at, setAt] = useState(today);
  const [pickAt, setPickAt] = useState(false);
  const [salary, setSalary] = useState("");
  const [warn, setWarn] = useState(false);
  const last = emp.history[emp.history.length - 1];

  const raw = salary.replace(/,/g, "").trim();
  const ok = /^\d+(\.\d+)?$/.test(raw) && Number(raw) > 0;

  function confirm() {
    if (!at || !ok) {
      setWarn(true);
      return;
    }
    passProbation(emp.id, at, Number(raw));
    onClose();
  }

  return (
    <Sheet
      title="บันทึกผ่านทดลองงาน"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="button" className="btn solid btn-solid" onClick={confirm}>
            ยืนยัน
          </button>
        </>
      }
    >
      <p className="text-[12.5px] text-muted-foreground">{emp.name}</p>
      <div className="mt-3">
        <Kv>
          <Row k="ประเภทตอนนี้" v="ทดลองงาน จ่ายรายวัน" />
          <Row k="อัตราที่บันทึกไว้" v={`${baht(last.salary)} บาท`} num />
          <Row k="ครบกำหนดทดลองงาน" v={probLine(emp.startedAt, today)} num />
        </Kv>
      </div>
      <hr className="my-4 border-border" />
      <div className="space-y-3.5" onClick={() => setPickAt(false)}>
        <Field label="วันที่มีผล">
          {/* มีผลก่อนวันเริ่มงานไม่ได้ — ยังไม่ได้เป็นพนักงานเลย */}
          <ThaiDatePicker
            value={at}
            min={emp.startedAt}
            open={pickAt}
            label="วันที่มีผล"
            onToggle={() => setPickAt((v) => !v)}
            onPick={(iso) => {
              setAt(iso);
              setPickAt(false);
              setWarn(false);
            }}
          />
        </Field>
        <Field label="เงินเดือน (บาท ต่อเดือน)">
          <Input
            inputMode="decimal"
            value={salary}
            onChange={(e) => {
              setSalary(commaInput(e.target.value));
              setWarn(false);
            }}
            placeholder="เช่น 21000"
          />
        </Field>
      </div>
      {warn && (
        <p className="mt-2.5 rounded-[11px] border border-[rgba(192,18,31,.2)] bg-[var(--destructive-soft)] px-3.5 py-2.5 text-[12.5px] text-destructive">
          ระบุวันที่มีผล และเงินเดือนเป็นตัวเลขมากกว่าศูนย์
        </p>
      )}
      <p className="mt-3 rounded-[11px] border border-border bg-muted/50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
        {ok ? (
          <>
            หลังมีผล จะคิดเงินเดือนรายเดือน <b className="text-foreground">{baht(Number(raw))}</b> บาท
            (ค่าจ้างรายชั่วโมงสำหรับโอที{" "}
            {baht(Number(raw) / HR_OT_DIVISOR.days / HR_OT_DIVISOR.hours)} บาท)
          </>
        ) : (
          "ก่อนหน้านี้จ่ายค่าจ้างรายวัน หลังมีผลจะเปลี่ยนเป็นเงินเดือนรายเดือน"
        )}
      </p>
    </Sheet>
  );
}

// ─── ส่วนประกอบของกล่องประวัติ ─────────────────────────────────────

function Sect({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 border-t border-border pt-4 first:mt-0 first:border-t-0 first:pt-0">
      <h3 className="mb-2.5 text-[12.5px] font-bold text-primary">{title}</h3>
      {children}
    </section>
  );
}

function Kv({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid gap-2 text-[13.5px] sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-x-4">
      {children}
    </dl>
  );
}

function Row({
  k,
  v,
  num,
  muted,
  bad,
}: {
  k: string;
  v: string;
  num?: boolean;
  muted?: boolean;
  bad?: boolean;
}) {
  return (
    <>
      <dt className="text-[12.5px] font-semibold text-muted-foreground">{k}</dt>
      <dd
        className={`leading-relaxed ${num ? "num font-semibold" : ""} ${
          bad ? "text-destructive" : muted ? "text-muted-foreground" : ""
        }`}
      >
        {v}
      </dd>
    </>
  );
}

// ─── เพิ่มพนักงานใหม่ ─────────────────────────────────────────────

/*
 * ฟอร์มเดียวจบตามต้นแบบ hr-employees.html — ตัวบุคคล การจ้างงาน ติดต่อ ฉุกเฉิน เอกสาร
 * เอกสารไม่ครบก็บันทึกได้ แต่ต้องเห็นว่าขาดอะไร (S-5) จึงติ๊กเท่าที่ได้รับจริง
 */
function AddDialog({
  hr,
  today,
  onClose,
  onAdded,
}: {
  hr: HrState;
  today: string;
  onClose: () => void;
  onAdded?: (id: string) => void;
}) {
  const [f, setF] = useState({
    /* กรอกแยกช่อง และมีภาษาอังกฤษไว้ตั้งชื่อผู้ใช้ตอนสร้างบัญชี (เจ้าของสั่ง 29 ก.ย. 2569) */
    first: "",
    last: "",
    firstEn: "",
    lastEn: "",
    nick: "",
    /* ดรอปดาวน์ที่ยังไม่เลือกขึ้นว่า "ยังไม่ระบุ" ทุกอัน ไม่เดาค่าให้เอง (เจ้าของสั่ง 29 ก.ย. 2569)
       ของเดิมตั้งต้นเป็นตัวเลือกแรก ทำให้ฝ่ายบุคคลเผลอบันทึกตำแหน่งผิดคนโดยไม่รู้ตัว */
    sex: "",
    birth: "",
    pos: "" as PosKey | "",
    type: "" as EmpType | "",
    startedAt: today,
    boss: "",
    salary: "",
    phone: "",
    email: "",
    address: "",
    sosName: "",
    sosRel: "",
    sosPhone: "",
  });
  const [docs, setDocs] = useState<DocKey[]>([]);
  /* เพิ่มชนิดเอกสารใหม่จากตรงนี้ได้ — เพิ่มแล้วติ๊กให้เลยว่าได้รับแล้ว */
  const addDoc = useAddOption({ catalog: "docs" }, (v) => setDocs((x) => (x.includes(v) ? x : [...x, v])));
  const [picker, setPicker] = useState<"" | "birth" | "start">("");
  const [warn, setWarn] = useState("");

  const set =
    (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setF((v) => ({ ...v, [k]: e.target.value }));

  const addPos = useAddOption({ catalog: "positions" }, (v) => setF((x) => ({ ...x, pos: v })));
  const addSex = useAddOption({ list: "sex" }, (v) => setF((x) => ({ ...x, sex: v })));
  const salary = Number(f.salary.replace(/[^\d.]/g, ""));
  const bosses = hr.emp.filter((e) => e.status === "active");
  /*
   * รอบที่ปิดแล้วไม่รับคนเพิ่มไม่ว่ากรณีใด (ผู้ใช้กำหนด 23 ก.ย. 2569)
   * วันเริ่มงานต้องอยู่หลังวันสุดท้ายของรอบเงินเดือนที่ปิดล่าสุด
   * คนเข้าใหม่ย้อนหลังจริงให้จ่ายเป็นรายการปรับปรุงในรอบถัดไป ไม่ใช่ดันคนเข้ารอบที่ปิดไปแล้ว
   */
  const lock = lockedUntil(hr);
  const minStart = lock ? isoAfter(lock) : "";

  function save() {
    const first = f.first.trim();
    const last = f.last.trim();
    const name = `${first} ${last}`.trim();
    /* ตรวจทีละข้อแล้วบอกข้อแรกที่ติด ไม่รวมเป็นก้อนเดียวจนไม่รู้ว่าต้องแก้ช่องไหน */
    if (!first) return setWarn("กรอกชื่อ (ไทย)");
    if (!last) return setWarn("กรอกนามสกุล (ไทย)");
    /* ชื่ออังกฤษใช้ตั้งชื่อผู้ใช้ตอนสร้างบัญชี จึงต้องมีตั้งแต่ตอนเพิ่มคน (เจ้าของสั่ง 30 ก.ย. 2569) */
    if (!f.firstEn.trim()) return setWarn("กรอกชื่อภาษาอังกฤษ (First name)");
    if (!f.lastEn.trim()) return setWarn("กรอกนามสกุลภาษาอังกฤษ (Last name)");
    if (!f.pos) return setWarn("เลือกตำแหน่ง");
    if (!f.type) return setWarn("เลือกประเภทการจ้าง");
    if (!f.startedAt) return setWarn("เลือกวันเริ่มงาน");
    if (minStart && f.startedAt < minStart)
      return setWarn(
        `รอบเงินเดือนถึง ${thaiDate(lock!)} ปิดไปแล้ว วันเริ่มงานต้องตั้งแต่ ${thaiDate(minStart)} เป็นต้นไป · ถ้าเข้าใหม่ย้อนหลังจริง ให้จ่ายเป็นรายการปรับปรุงในรอบถัดไป`,
      );
    /* ฝึกงานไม่มีค่าจ้าง จึงไม่บังคับกรอกเงินเดือน */
    if (f.type !== "intern" && !(salary > 0)) return setWarn("กรอกเงินเดือน");
    if (!f.phone.trim()) return setWarn("กรอกเบอร์โทร");
    /* ชื่อซ้ำตรวจเป็นข้อสุดท้าย — ช่องที่ยังว่างต้องบอกก่อน (ลำดับตามต้นแบบ) */
    if (hr.emp.some((e) => e.name === name)) return setWarn("มีพนักงานชื่อนี้ในระบบแล้ว ตรวจสอบก่อนบันทึก");

    const id = addEmployee({
      name,
      first,
      last,
      firstEn: f.firstEn.trim(),
      lastEn: f.lastEn.trim(),
      nick: f.nick.trim(),
      sex: f.sex || "ไม่ระบุ",
      birth: f.birth,
      pos: f.pos as PosKey,
      type: f.type as EmpType,
      startedAt: f.startedAt,
      boss: f.boss,
      edu: "",
      exp: [],
      phone: f.phone.trim(),
      email: f.email.trim(),
      address: f.address.trim(),
      sos: { name: f.sosName.trim(), rel: f.sosRel.trim(), phone: f.sosPhone.trim() },
      docs: hrDocs().map((d) => d.v).filter((v) => docs.includes(v)),
      /* ฝึกงานไม่มีค่าจ้าง — บันทึกเป็น 0 ไม่ใช่ปล่อยค่าที่ค้างในช่อง */
      salary: f.type === "intern" ? 0 : salary,
    });
    onClose();
    if (id) onAdded?.(id);
  }

  return (
    <Sheet
      title="เพิ่มพนักงาน"
      mid
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="button" className="btn solid btn-solid" onClick={save}>
            บันทึก
          </button>
        </>
      }
    >
      <div onClick={() => setPicker("")}>
        <Sect title="ข้อมูลตัวบุคคล">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="ชื่อ (ไทย)" required>
              <Input value={f.first} onChange={set("first")} placeholder="เช่น สมชาย" aria-label="ชื่อภาษาไทย" />
            </Field>
            <Field label="นามสกุล (ไทย)" required>
              <Input value={f.last} onChange={set("last")} placeholder="เช่น ใจดี" aria-label="นามสกุลภาษาไทย" />
            </Field>
            {/* ชื่ออังกฤษใช้ตั้งชื่อผู้ใช้ตอนสร้างบัญชี ตัวอย่างอยู่ในช่องเหมือนช่องภาษาไทย (เจ้าของสั่ง 1 ต.ค. 2569) */}
            <Field label="First name (EN)" required>
              <Input value={f.firstEn} onChange={set("firstEn")} placeholder="เช่น Somchai" aria-label="ชื่อภาษาอังกฤษ" />
            </Field>
            <Field label="Last name (EN)" required>
              <Input value={f.lastEn} onChange={set("lastEn")} placeholder="เช่น Jaidee" aria-label="นามสกุลภาษาอังกฤษ" />
            </Field>
            <Field label="ชื่อเล่น">
              <Input value={f.nick} onChange={set("nick")} placeholder="เช่น ชาย" aria-label="ชื่อเล่น" />
            </Field>
            <Field label="เพศ">
              <Select
                value={f.sex}
                aria-label="เพศ"
                onChange={(e) => addSex.pick(e.target.value) || setF((x) => ({ ...x, sex: e.target.value }))}
              >
                <option value="">ยังไม่ระบุ</option>
                {optionsOf("sex").map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
                {addSex.option}
              </Select>
            </Field>
            {addSex.dialog}
            <Field label="วันเกิด">
              <ThaiDatePicker
                value={f.birth}
                max={today}
                open={picker === "birth"}
                label="วันเกิด"
                onToggle={() => setPicker((v) => (v === "birth" ? "" : "birth"))}
                onPick={(iso) => {
                  setF((v) => ({ ...v, birth: iso }));
                  setPicker("");
                }}
              />
            </Field>
          </div>
        </Sect>

        <Sect title="การจ้างงาน">
          <div className="grid gap-3.5 sm:grid-cols-2">
            {/* ตำแหน่งบอกไปด้วยว่าเข้าระบบเป็นบทบาทอะไร — ทุกบทบาทคือพนักงาน ต่างกันที่งานตามตำแหน่ง
                (เจ้าของสั่ง 29 ก.ย. 2569) ตอนสร้างบัญชีให้คนนี้ ระบบจะตั้งบทบาทตามนี้ให้เลย */}
            <Field
              label="ตำแหน่ง"
              required
              /* ยังไม่เลือกก็ไม่ต้องมีข้อความอะไร เลือกแล้วค่อยบอกว่าได้เมนูของตำแหน่งไหน */
              hint={
                f.pos && rolesOfPosition(f.pos).length
                  ? `เข้าระบบเป็น ${rolesOfPosition(f.pos).map(roleLabel).join(" + ")}`
                  : undefined
              }
            >
              <Select value={f.pos} onChange={(e) => addPos.pick(e.target.value) || set("pos")(e)} aria-label="ตำแหน่ง">
                <option value="">ยังไม่ระบุ</option>
                {hrPositions().map((p) => (
                  <option key={p.v} value={p.v}>
                    {p.label} · {hrDept(p.dept).label}
                  </option>
                ))}
                {addPos.option}
              </Select>
            </Field>
            {addPos.dialog}
            <Field label="ประเภทการจ้าง" required>
              <Select value={f.type} onChange={set("type")} aria-label="ประเภทการจ้าง">
                <option value="">ยังไม่ระบุ</option>
                {(Object.keys(HR_EMPTYPE) as EmpType[]).map((k) => (
                  <option key={k} value={k}>
                    {HR_EMPTYPE[k].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="วันเริ่มงาน"
              required
              hint={minStart ? `รอบที่ปิดแล้วไม่รับคนเพิ่ม เลือกได้ตั้งแต่ ${thaiDate(minStart)}` : undefined}
            >
              <ThaiDatePicker
                value={f.startedAt}
                min={minStart || undefined}
                open={picker === "start"}
                label="วันเริ่มงาน"
                onToggle={() => setPicker((v) => (v === "start" ? "" : "start"))}
                onPick={(iso) => {
                  setF((v) => ({ ...v, startedAt: iso }));
                  setPicker("");
                }}
              />
            </Field>
            <Field label="หัวหน้างาน">
              <Select value={f.boss} onChange={set("boss")} aria-label="หัวหน้างาน">
                <option value="">ยังไม่กำหนด</option>
                {bosses.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · {hrPos(e.pos).label}
                  </option>
                ))}
              </Select>
            </Field>
            {/* ฝึกงานไม่มีค่าจ้าง จึงไม่ต้องกรอกเงินเดือน (เจ้าของสั่ง 30 ก.ย. 2569) */}
            <Field
              label="เงินเดือน"
              required={f.type !== "intern"}
              hint={
                f.type === "intern"
                  ? "นักศึกษาฝึกงานไม่มีค่าจ้างและไม่มีสลิป จึงไม่ต้องกรอก"
                  : f.type === "probat"
                    ? "ช่วงทดลองงานจ่ายรายวัน คิดจากค่านี้หารจำนวนวันทำงานต่อเดือน"
                    : undefined
              }
            >
              <Input
                value={f.type === "intern" ? "" : f.salary}
                onChange={(e) => setF((v) => ({ ...v, salary: commaInput(e.target.value) }))}
                inputMode="decimal"
                placeholder={f.type === "intern" ? "ไม่มีค่าจ้าง" : "บาท"}
                className="num"
                aria-label="เงินเดือน"
                disabled={f.type === "intern"}
              />
            </Field>
          </div>
        </Sect>

        <Sect title="การติดต่อ">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="เบอร์โทร" required>
              <Input value={f.phone} onChange={set("phone")} placeholder="08X-XXX-XXXX" aria-label="เบอร์โทร" />
            </Field>
            <Field label="อีเมล">
              <Input value={f.email} onChange={set("email")} placeholder="name@example.com" aria-label="อีเมล" />
            </Field>
            <Field label="ที่อยู่" className="sm:col-span-2">
              <Input
                value={f.address}
                onChange={set("address")}
                placeholder="บ้านเลขที่ ตำบล อำเภอ จังหวัด"
                aria-label="ที่อยู่"
              />
            </Field>
          </div>
        </Sect>

        <Sect title="ผู้ติดต่อฉุกเฉิน">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="ชื่อ">
              <Input value={f.sosName} onChange={set("sosName")} aria-label="ชื่อผู้ติดต่อฉุกเฉิน" />
            </Field>
            <Field label="ความสัมพันธ์">
              <Input value={f.sosRel} onChange={set("sosRel")} placeholder="เช่น มารดา" aria-label="ความสัมพันธ์" />
            </Field>
            <Field label="เบอร์โทร">
              <Input value={f.sosPhone} onChange={set("sosPhone")} aria-label="เบอร์โทรผู้ติดต่อฉุกเฉิน" />
            </Field>
          </div>
        </Sect>

        <Sect title="เอกสารที่ได้รับแล้ว">
          <ul className="grid gap-1.5 text-[13px] sm:grid-cols-2">
            {hrDocs().map((d) => (
              <li key={d.v}>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={docs.includes(d.v)}
                    onChange={(e) =>
                      setDocs((v) => (e.target.checked ? [...v, d.v] : v.filter((x) => x !== d.v)))
                    }
                    className="size-4 accent-[var(--primary)]"
                  />
                  {d.label}
                  {d.req && <span className="text-destructive">*</span>}
                </label>
              </li>
            ))}
          </ul>
          {addDoc.canAdd && (
            <button type="button" className="lnk mt-2 text-[12.5px]" onClick={() => addDoc.pick(ADD_VALUE)}>
              ＋ เพิ่มชนิดเอกสาร
            </button>
          )}
          {addDoc.dialog}
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            เอกสารไม่ครบก็บันทึกได้ หน้าประวัติจะขึ้นว่ายังขาดอะไรบ้าง
          </p>
        </Sect>

        {warn && (
          <p className="mt-4 rounded-[11px] border border-[rgba(192,18,31,.2)] bg-[var(--destructive-soft)] px-3.5 py-2.5 text-[12.5px] text-destructive">
            {warn}
          </p>
        )}
      </div>
    </Sheet>
  );
}
