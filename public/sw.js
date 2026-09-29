/*
 * Service worker ของ ERP MAZ
 *
 * ทำอย่างเดียวคือ "กันหน้าจอขาว" ตอนเน็ตหลุด — ขอจากเครือข่ายก่อนเสมอ
 * ถ้าขอไม่ได้ค่อยหยิบของในแคชมาแสดง
 *
 * ตั้งใจไม่แคชไฟล์ของ Next (/_next/static/...) เอง เพราะชื่อไฟล์เปลี่ยนทุกครั้งที่ build
 * ถ้าดักแคชไว้เองจะได้ของเก่าปนของใหม่ ปล่อยให้เบราว์เซอร์จัดการตาม HTTP cache ดีกว่า
 */

const VERSION = "maz-erp-v1";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  /* สนใจเฉพาะการเปิดหน้า — รูป ฟอนต์ สคริปต์ ปล่อยผ่านตามปกติ
     ไม่งั้นคำขอ POST หรือคำขอข้ามโดเมนจะพังทั้งหมดตอนออฟไลน์ */
  if (request.mode !== "navigate" || request.method !== "GET") return;

  event.respondWith(
    fetch(request).catch(async () => {
      const cache = await caches.open(VERSION);
      return (
        (await cache.match(request)) ||
        (await cache.match(OFFLINE_URL)) ||
        Response.error()
      );
    }),
  );
});

/* หน้า /install กดปุ่ม "ทดสอบแจ้งเตือน" แล้วส่งข้อความมาที่นี่
   ต้องแสดงผ่าน service worker เพราะบน iOS ที่ติดตั้งลงโฮมแล้ว
   new Notification() ตรง ๆ ใช้ไม่ได้ */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "notify") return;
  event.waitUntil(
    self.registration.showNotification(data.title || "ERP MAZ", {
      body: data.body || "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: data.tag || "maz-erp",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    }),
  );
});
