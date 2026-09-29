"use client";

import Link from "next/link";
import { type SubItem } from "@/lib/nav";

/** ชิปสลับหน้าย่อยของหัวข้อเดียวกัน — เห็นทุกหน้าพร้อมกันโดยไม่ต้องกดเปิด */
export function SubNav({
  items,
  pathname,
}: {
  items: SubItem[];
  pathname: string;
}) {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="หน้าย่อย">
      {/* สองหัวข้อชี้หน้าเดียวกันได้ (คนละหมวดในหน้าเดียว) คีย์จึงต้องมีลำดับกำกับ ไม่ใช่ที่อยู่หน้าอย่างเดียว */}
      {items.map((item, i) => {
        const active = item.href === pathname;
        return (
          <Link
            key={`${item.href}-${i}`}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-primary font-semibold text-white"
                : "bg-secondary text-muted-foreground hover:bg-accent hover:text-primary"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
