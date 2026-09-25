# DSKRU School Cooperative · สหกรณ์โรงเรียน

A Thai-first school cooperative shop for all DSKRU students, with a kiosk and protected staff dashboard. Built with Next.js App Router, React, TypeScript, Firebase Admin / Firestore, Omise PromptPay, and custom CSS.

## Run locally

Requires Node.js 20.9+ (developed and tested with Node 24).

```powershell
npm ci
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm run dev
```

Open **http://127.0.0.1:3000**. The current working copy uses Firestore in `.env.local`; do not overwrite that file. A fresh copy of the template defaults to isolated demo storage. `.env.local` is ignored by Git.

Open **/admin** and create the first administrator with your own username and password (at least 12 characters). There are no default credentials. The first-account form is available only while no account exists; local demo setup is limited to the local host. On the kiosk, press **↑ five times** within 1.5 seconds between presses to reveal the staff link. Every staff API request checks its session and role independently.

Existing demo catalogs, transactions, and balances are preserved. The old shared PIN and its cookies are retired; `ADMIN_PIN` and `SESSION_SECRET` are no longer used.

The explicit `DATA_BACKEND=demo` mode saves to `.data/demo.json`. It is for a single local server process. Data survives reloads and server restarts; writes are serialized and replace the JSON file atomically. Do not use this mode on Vercel, ephemeral storage, multiple processes, or a public production deployment. Back up the file if demo records matter. Demo mode has no automatic Firestore fallback.

## Student workflow

- Touch **+**, search by name, or scan a product barcode with a USB/Bluetooth scanner operating as a keyboard and terminating with Enter. Scanning is keyboard input, not camera scanning; JsBarcode generates labels in the staff panel.
- **↑ / ↓** selects a product or the checkout button. With a nonempty cart and an open shop, **↑ from the first product** or **↓ from the last product** selects checkout; **Enter** opens it. From checkout, ↑ returns to the last product and ↓ returns to the first. The selected card or checkout button has a dark orange outline and a visible label. Disabled checkout is skipped.
- **← / →** changes the selected product quantity, **Enter** adds it, and a second Enter still opens checkout. Inputs and dialogs retain their usual keyboard behavior. Tab also navigates controls.
- หน้าชำระเงินมีแป้นตัวเลขสำหรับรหัสนักเรียน (ยังไม่บังคับ) พร้อมปุ่มลบ/ล้าง ช่องรับรหัสพร้อมพิมพ์จากคีย์บอร์ดหรือ Numpad ทันที ใช้ตัวเลขได้ไม่เกิน 30 หลัก กด Enter จากช่องรหัสเพื่อไปปุ่มยืนยันเมื่อระบบพร้อมชำระ รหัสเก็บเป็นข้อความ เช่น `00123` จึงไม่เสียเลขศูนย์นำหน้า และล็อกไว้ระหว่างส่ง/กู้คืนรายการเดิม
- ใช้ลูกศรกับแป้นบนจอได้: **↓ จากช่องรหัส** เข้าแป้น, **↑ ↓ ← →** เลือกปุ่มที่มีกรอบสีส้ม, **Enter** ใส่เลขโดยยังเลือกปุ่มเดิม, **↑ จากแถวบน** กลับช่องรหัส และ **↓ จากแถวล่าง** ไปปุ่มยืนยันเมื่อพร้อมชำระ ปุ่มลบ/ล้างที่ใช้ไม่ได้จะถูกข้าม ช่องรหัสยังใช้ ← → เลื่อนเคอร์เซอร์และพิมพ์เลขจาก Numpad ได้ตามปกติ
- เมื่อยืนยันสร้างรายการ ระบบบันทึกรหัสที่กรอกใน **Firestore → `transactions` → เอกสารเลขรายการ → `studentId`** พร้อมข้อมูลสินค้าและยอดเงิน ดูรหัสได้จากใบเสร็จ รายการขายในหลังบ้าน และไฟล์ Excel ช่องว่างหมายถึงไม่ระบุรหัส รหัสที่กรอกยังไม่ได้ตรวจเทียบทะเบียนนักเรียน ร่างที่ยังไม่ยืนยันอยู่เฉพาะ session ของแท็บและล้างเมื่อเริ่มรายการใหม่/ล้างตะกร้า
- New purchases accept **PromptPay bank transfer only**, through Omise. Minimum **THB20**, maximum THB150,000 per order. Historical cash receipts are retained.
- Checkout reserves stock and creates one provider charge with a QR that expires in five minutes. A signed webhook triggers an authenticated charge lookup; only verified payment completes the order, deducts stock, credits gross sales and shows the receipt. Staff cannot manually mark a payment successful.
- Kiosk status polling provides an automatic fallback while the page is open. Configure the reconciliation scheduler below to recover missed webhooks even when the browser is closed.
- The kiosk resets after five idle minutes except during a pending payment. A completed receipt returns to the shop after 20 seconds. Pending receipts survive refresh in the same browser tab.
- Reserved inventory is excluded from the available catalog. Stock edits cannot reduce inventory below reservations or deactivate reserved products. Reservations are released only after the provider confirms failure/expiry. An issued PromptPay QR cannot be cancelled through this app while still payable.

## Staff tools

Dashboard with today's revenue, completed sales, pending payments, low-stock alerts, hourly sales, and top products. Inventory supports add, edit, restock, barcode display, and archival. Products with pending orders cannot be archived. Historical sales retain product names and prices.

Transaction history includes all states, item detail, optional student ID, search, and pagination. Analytics includes a seven-day trend and per-product totals. The budget ledger records extra income, expenses, and an initial balance as an income entry. Ledger entries are immutable through the UI; corrections are compensating entries with an explanation. Store settings control open/closed state and daily revenue target.

### Accounts and permissions

| Role                 | Access                                                            |
| -------------------- | ----------------------------------------------------------------- |
| ผู้ดูแลระบบ (admin)  | All sections, accounts, store settings, PromptPay and budget      |
| พนักงานขาย (cashier) | Dashboard, sales, provider status checks and analytics           |
| ผู้ดูแลสต็อก (stock) | Inventory, prices, restocking and barcode labels                  |

All three roles can change their own password in **บัญชีของฉัน**. Administrators create accounts, reset passwords, change roles and disable accounts in **บัญชีเจ้าหน้าที่**. Usernames are case-insensitive, 3–40 English letters/numbers with `. _ -`. Passwords are 12–128 characters and stored as salted scrypt hashes (N=131072, r=8, p=1); passwords and hashes are never returned by the API. The active administrator cannot disable or demote their own account. The final active administrator is protected.

Sessions use random opaque HttpOnly, SameSite=Strict cookies (Secure for production Firestore mode). Only the SHA-256 token digest is stored on the server. Idle expiry is 15 minutes; activity renews it up to an absolute eight-hour limit. Automatic polling does not renew sessions. Logout deletes the server session; password, role, status or account-detail changes revoke that account's sessions on every device. Protected writes recheck the account and permission inside the same transaction as the write.

Login attempts are limited to five per username per 15 minutes plus a shared 100-attempt cap; successful logins clear that username's failure bucket. Password confirmation for sensitive actions has its own per-account limit. Limits are persisted and avoid trusting client IP headers. Public installations should also use ingress request limits. Administrators reset forgotten staff passwords; there is no email/password recovery service.

## ตั้งค่าผ่านเว็บ

เข้าสู่ **/admin → ตั้งค่าระบบ** ด้วยบทบาทผู้ดูแลระบบ:

- เปิด–ปิดร้าน เป้ายอดขาย PromptPay และบัญชีเจ้าหน้าที่ใช้เมนูในเว็บได้ตามเดิม
- **หน้าร้านและการใช้งาน**: ชื่อร้าน/โรงเรียน ข้อความหน้าร้าน/ท้ายเว็บ รหัสนักเรียนแบบไม่เก็บ/ไม่บังคับ/บังคับ จำนวนหลัก เวลาล้างตะกร้า เวลาแสดงใบเสร็จ จำนวนต่อสินค้า และยอดขั้นต่ำ/สูงสุด บันทึกใน `settings/store` และหน้าร้านรับค่าใหม่ผ่าน SSE ยอดและรหัสนักเรียนตรวจซ้ำที่เซิร์ฟเวอร์
- **การเชื่อมต่อเซิร์ฟเวอร์**: ฐานข้อมูล demo/Firestore, Firebase Project ID/Client Email/Private Key (นำเข้า service account JSON ได้), ตำแหน่งไฟล์ demo, รหัสตั้งค่าผู้ดูแลคนแรก, โหมดและคีย์ Omise, webhook และคีย์งานตรวจสถานะ ช่องคีย์ว่างหมายถึงเก็บค่าเดิม ใช้ช่อง “ล้างคีย์นี้” เพื่อล้างโดยตั้งใจ API ส่งกลับเฉพาะสถานะว่ามีคีย์แล้ว ไม่ส่งคีย์เดิมให้เบราว์เซอร์
- การเปลี่ยนการเชื่อมต่อต้องยืนยันรหัสผ่านผู้ดูแล ปิดร้าน และรอรายการชำระค้างให้จบก่อน บันทึกแล้ว **รีสตาร์ตเซิร์ฟเวอร์** (หยุด `npm run dev` แล้วรันใหม่ หรือ restart แอปบนโฮสต์) จากนั้นจึงเปิดร้านได้ ระหว่างรอใช้ปุ่มยกเลิกค่าที่รอเพื่อกลับไปใช้ค่าปัจจุบันได้

ค่าการเชื่อมต่อเก็บในไฟล์ส่วนตัว `.data/server-config.json` หรือ `SYSTEM_CONFIG_PATH` และมีลำดับเหนือ `.env.local` หลังเริ่มโปรเซสใหม่ ไฟล์นี้มี credentials: เก็บนอก `public` และสำรองเหมือนไฟล์ `.env.local` ห้ามเพิ่มเข้า Git ระบบไม่เขียนทับ `.env.local` การตรวจขณะบันทึกเป็นการตรวจรูปแบบ ไม่ใช่การยืนยันว่าสิทธิ์ Firebase/Omise ใช้งานได้จริง

การตั้งค่าผ่านไฟล์นี้รองรับ **เซิร์ฟเวอร์เดียวที่มีดิสก์ถาวรเขียนได้** ไม่รองรับการแชร์การเขียนข้ามหลายโปรเซสหรือดิสก์ชั่วคราว/serverless สำหรับโฮสต์ดังกล่าวให้กำหนด Environment ในระบบของโฮสต์และ redeploy แทน ต้องตั้งตำแหน่งดิสก์ถาวรและสิทธิ์ไฟล์ในโฮสต์ครั้งแรก การสมัครผู้ให้บริการ เปิดบัญชีรับเงิน DNS/HTTPS งาน cron และ IAM ของ Firebase ยังจัดการที่ผู้ให้บริการ

การเลือกฐานข้อมูลใหม่ **ไม่ย้ายข้อมูลหรือบัญชีเดิม** ให้เตรียมบัญชีในปลายทาง หรือกำหนด `ADMIN_SETUP_TOKEN` สำหรับสร้างผู้ดูแลคนแรกใน Firestore ว่าง หากตั้งค่าจนเชื่อมต่อไม่ได้ ให้ผู้ติดตั้งแก้/เปลี่ยนชื่อไฟล์ `SYSTEM_CONFIG_PATH` เพื่อกลับไปใช้ Environment เดิมแล้วรีสตาร์ต ข้อมูลฐานข้อมูลเดิมไม่ถูกลบ

## Configure Firestore

1. Create a Firebase project and a **Firestore Native mode** database in the region you intend to operate in.
2. Provide a service account with the least IAM access necessary to read and write the shop database. Keep its private key server-side. Set these values in `.env.local` or your deployment environment:

```dotenv
DATA_BACKEND=firestore
ADMIN_SETUP_TOKEN=your-random-one-time-secret-at-least-24-characters
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

3. Deploy `firestore.rules` using Firebase CLI after selecting your project, or copy those rules into the Firebase console. All direct client access is denied: this app exposes public items through `/api/items` and uses protected server APIs for all writes. The Admin SDK uses **IAM** and bypasses client rules, so server authorization and service-account permissions both matter. See [Firebase security documentation](https://firebase.google.com/docs/firestore/security/rules-conditions).
4. Open `/admin`, supply the setup token and choose the first administrator username/password. Then remove `ADMIN_SETUP_TOKEN` from the deployment environment. Configure staff accounts and PromptPay through the dashboard. Start with an empty catalog and add actual stock; to use sample data, run `npm run seed:firestore` **before first-account setup** while the database is empty. It refuses to overwrite an existing catalog or settings document. The sample barcodes are placeholders: replace them with the codes on your real products. The included photographs represent categories, not exact Thai SKUs.
5. Configure scheduled backups / retention in Firebase or Google Cloud and test restoration. Firestore backups are **not automatically enabled by this app**, and no zero-data-loss guarantee is made.

Collections: `items`, `transactions`, `budget`, `users`, `sessions`, `settings` (`store` document), and `security` (rate-limit buckets). Purchases store price snapshots, timestamps, status, optional student ID, opaque receipt token and request ID. New transfers also retain an Omise charge ID, server-generated matching reference, payment mode, QR URL, expiry and reconciliation state. API responses omit the internal reference and credentials; staff responses omit receipt tokens. Successful transfers record `confirmedBy: "omise"`. Revenue and stock changes use a single Firestore transaction; see [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions).

Catalog and store settings use server-side Firestore listeners streamed to the kiosk with SSE. The dashboard refreshes every five seconds; pending kiosk receipts refresh every 2.5 seconds. SSE reconnects automatically. On hosting with bounded request durations, use an appropriate function timeout; reconnecting clients re-fetch current state.

The repository currently loads the shop's collections for small-cooperative reporting and mutations, then writes only changed documents transactionally. Before expanding to large catalogs or long transaction histories, replace these collection reads with targeted document operations, cursor pagination, and aggregate reporting. This is a functional small-shop implementation, not a load-tested large retail system.

## Move existing demo data to Firestore

Put the service-account credentials in `.env.local` (`.env.example` is only a template). Stop the local demo server before importing so new sales cannot be recorded during the copy. The destination app collections must be empty.

```powershell
# Preview only; replace YOUR_PROJECT_ID with the exact destination project ID.
npm run migrate:firestore -- --project=YOUR_PROJECT_ID
# Back up the local JSON, import atomically, then compare all saved documents.
npm run migrate:firestore -- --project=YOUR_PROJECT_ID --apply
```

After the verified import, set `DATA_BACKEND=firestore` in `.env.local` and restart the server. Existing products, sales, balances, accounts/password hashes and PromptPay settings are retained. Active sessions and login-attempt buckets are not copied, so staff sign in again. Backups are stored beside the demo file under `backups/`. The importer refuses to overwrite existing app data, requires an active administrator and supports up to 450 document writes in one transaction. Do not run the sample seed after importing.

## ตั้งค่า Omise PromptPay อัตโนมัติ

1. สมัครบัญชีร้านค้าที่ [Omise Dashboard](https://dashboard.omise.co/) และดำเนินการยืนยันร้านค้า/บัญชีรับเงินด้วยตัวเอง ขอเปิดบริการ PromptPay ตาม [คู่มือ Omise](https://docs.omise.co/promptpay) บริการมีค่าธรรมเนียมตามข้อตกลงบัญชีของคุณ และรับยอดขั้นต่ำ 20 บาทต่อรายการ
2. ใน Dashboard เลือกโหมด Live แล้วนำ Secret key จาก **API → Keys** และ webhook signing secret จาก **Webhooks** ใส่ใน `.env.local` หรือ Environment ของโฮสต์ ห้ามใส่ในไฟล์ตัวอย่างหรือส่งเข้าฝั่งเบราว์เซอร์

```dotenv
PAYMENT_MODE=live
OMISE_SECRET_KEY=skey_live_REPLACE_WITH_YOUR_KEY
OMISE_WEBHOOK_SECRET=REPLACE_WITH_BASE64_WEBHOOK_SECRET
PAYMENT_WEBHOOK_URL=https://YOUR_DOMAIN/api/payments/omise/webhook
CRON_SECRET=REPLACE_WITH_RANDOM_SECRET_AT_LEAST_24_CHARACTERS
```

3. Deploy เว็บบนโดเมน HTTPS ที่เข้าถึงจากอินเทอร์เน็ตได้ แล้วตั้ง URL เดียวกับ `PAYMENT_WEBHOOK_URL` ในหน้า Webhooks ของ Omise โหมด Live ด้วย `127.0.0.1` รับ callback จาก Omise ไม่ได้ เว็บส่ง URL นี้ตอนสร้างแต่ละ charge ด้วย
4. ตั้ง scheduler ของโฮสต์ให้เรียก **GET `/api/payments/reconcile` ทุก 1 นาที** พร้อม header `Authorization: Bearer <CRON_SECRET>` การใส่ secret อย่างเดียวไม่ได้ติดตั้ง scheduler งานนี้ตรวจครั้งละ 10 รายการเก่าสุดที่ถึงเวลาตรวจ และตอบ 503 หากมีรายการตรวจไม่สำเร็จ เพื่อให้โฮสต์ตรวจติดตามได้
5. Restart เซิร์ฟเวอร์ แล้วเปิด **/admin → ตั้งค่าร้าน → PromptPay อัตโนมัติ · Omise** ดูสถานะการตั้งค่า ระบุชื่อร้าน เปิดรับชำระ และยืนยันรหัสผ่านผู้ดูแล บัญชีรับเงินจริงจัดการที่ Omise; เบอร์พร้อมเพย์เดิมไม่ใช้สร้าง QR ใหม่ การแสดงว่าตั้งค่าครบไม่ได้ยืนยันว่าบัญชีผู้ให้บริการผ่านอนุมัติแล้ว
6. ตรวจครบวงจรใน Test mode ก่อน จากนั้นตรวจรายการเงินจริงที่ได้รับอนุญาตกับยอดใน Omise ก่อนเปิดหน้าร้านจริง

**ทดสอบโดยไม่แตะยอดขายจริง:** ใช้ instance แยก ตั้ง `DATA_BACKEND=demo`, `DEMO_DATA_PATH` เป็นไฟล์ใหม่, `PAYMENT_MODE=test` และคีย์ `skey_test_...` กับ webhook secret ของ Test mode ระบบจะปฏิเสธ Test mode เมื่อใช้ Firestore เพื่อกันยอดจำลองเข้าฐานข้อมูลร้าน เปิดรายละเอียด charge ใน Omise Test Dashboard แล้วใช้ Actions → Successful / Failed ตามคู่มือ การดูผลบน localhost ใช้ polling ได้ แต่การทดสอบ webhook ต้องใช้ HTTPS ที่เข้าถึงได้จากภายนอก ห้ามเปลี่ยนคีย์/โหมดของระบบที่มีรายการค้างไปเป็นบัญชีอื่น

The server verifies the raw-body HMAC-SHA256 signature (Base64-decoded webhook secret, timestamp and constant-time comparison) and independently fetches the charge with the secret key. It matches charge ID, order metadata, amount, THB currency, PromptPay source and live/test mode. Duplicate events cannot deduct stock or credit the ledger twice. See [Omise webhooks](https://docs.omise.co/api-webhooks/thailand).

External provider calls never run inside a retried database transaction. Checkout claims one create attempt durably before contacting Omise. If the create response is lost, recovery looks up the existing charge by server-generated metadata instead of creating another charge. API errors keep the order pending; a local expiry clock never proves that an existing charge is unpaid. Polling is throttled per order. Old pending manual-payment orders do not become paid automatically: unpaid ones can be cancelled; any money already received must be reconciled separately by the shop. Completed historical receipts remain unchanged.

The cooperative ledger records **gross sales**, not Omise's net bank settlement; record fees/settlement adjustments separately. Automatic refunds are not implemented. Omise's PromptPay guide currently states that these charges cannot be voided or refunded through Omise. An unexpected fulfillment failure after payment is recorded and shown to the shop without asking the customer to pay twice.

## ส่งออกข้อมูล Excel

เข้าสู่ `/admin` แล้วกด **ส่งออก Excel** ข้างหัวข้อหน้า เลือกทั้งหมดหรือประเภทข้อมูล และเลือกช่วงวันที่ (ทุกช่วงเวลา / วันนี้ / เดือนนี้ / กำหนดเอง) จากนั้นกด **ดาวน์โหลด Excel** ไฟล์ `.xlsx` จะดาวน์โหลดผ่านเบราว์เซอร์ ไม่ต้องตั้งค่า API เพิ่ม

- ผู้ดูแลระบบ: สินค้า รายการขายพร้อมรายละเอียดแต่ละสินค้า และบัญชีสหกรณ์
- พนักงานขาย: รายการขายและรายละเอียดสินค้า
- ผู้ดูแลสต็อก: สินค้าและสต็อก

ไฟล์มีชีตสรุป หัวตารางภาษาไทย ตัวกรอง และแถวหัวตารางค้างไว้ เงินเป็นตัวเลขบาท วันที่เป็นเวลาไทย (ปี ค.ศ.) บาร์โค้ดและรหัสนักเรียนเป็นข้อความเพื่อรักษาเลขศูนย์นำหน้า สินค้าที่ปิดขายและรายการเงินสดเดิมยังรวมอยู่ในประวัติ

ช่วงวันที่รวมวันสิ้นสุดด้วย ยอดขายใช้วันชำระสำเร็จ หรือวันสร้างรายการหากข้อมูลเก่าไม่มีวันชำระ ส่วนรายการรอชำระ/ยกเลิกและบัญชีอื่นใช้วันสร้างรายการ ยอดขายสรุปนับเฉพาะรายการชำระแล้ว บัญชีรวมยอดขายชำระแล้วและรายรับ–รายจ่ายอื่น สต็อกกับยอดคงเหลือเป็นยอดปัจจุบัน ไม่ใช่ยอดย้อนหลังตามช่วงวันที่ การส่งออกไม่ใช้คำค้น/ตัวกรอง/เลขหน้าของตารางในหน้าจอ

`GET /api/admin/export?kind=all&from=2026-09-01&to=2026-09-30` accepts `all`, `inventory`, `sales`, or `budget`; dates are optional. The server checks the active session and role, reads data without changing payment/order state, and generates the workbook in memory with ExcelJS. Responses are private and uncached. Exports include only report fields, never credentials, password hashes, sessions, receipt access tokens or gateway secrets. A request exceeding 50,000 data rows is rejected with a prompt to narrow its type/date range; exports are not silently truncated. Excel reports are for reviewing data, not full database backups.

## API

| Endpoint                           | Access                         | Purpose                                                    |
| ---------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| `GET /api/items`                   | Public                         | Active catalog and public shop configuration               |
| `GET /api/events`                  | Public                         | Catalog/settings change notifications                      |
| `POST /api/purchase`               | Public, validated              | Create/retry pending order with a UUID request ID          |
| `GET /api/purchase/:id`            | Opaque `x-order-token`         | Receipt / status                                           |
| `DELETE /api/purchase/:id`         | Opaque `x-order-token`         | Cancel legacy unpaid orders; active gateway QR cannot cancel |
| `POST /api/payments/omise/webhook` | Signed provider webhook       | Independently verify charge and fulfill atomically         |
| `GET /api/payments/reconcile`     | Bearer `CRON_SECRET`           | Scheduled recovery of pending payments                     |
| `POST /api/admin/setup`            | First setup only               | Create first admin; setup token required in Firestore mode |
| `POST /api/admin/login`            | Rate-limited username/password | Create server session                                      |
| `POST /api/admin/password`         | Staff + current password       | Change own password and revoke sessions                    |
| `GET /api/admin/users`             | Admin                          | List accounts without password hashes                      |
| `POST /api/admin/users/save`       | Admin                          | Create/update/disable accounts, reset password             |
| `GET/POST /api/settings/promptpay` | Admin; password for writes     | Read readiness/update shop name and enable switch          |
| `GET/POST /api/admin/session`      | Session                        | Inspect / renew session                                    |
| `POST /api/admin/logout`           | Browser session                | Revoke server session and clear cookie                     |
| `GET /api/admin/overview`          | Staff                          | Role-filtered dashboard data                               |
| `GET /api/admin/export`            | Staff, role-filtered           | Download Excel workbook, optional kind/from/to filters      |
| `GET /api/transactions`            | Admin / cashier                | Transaction history                                        |
| `POST /api/transactions/check`     | Admin / cashier                | Check provider status; cannot override payment             |
| `POST /api/transactions/confirm`   | Retired (410)                  | Manual confirmation is disabled                            |
| `POST /api/transactions/cancel`    | Admin / cashier                | Cancel a pending order                                     |
| `POST /api/stock/update`           | Admin / stock                  | Add or update an item                                      |
| `POST /api/stock/delete`           | Admin / stock                  | Archive an item                                            |
| `POST /api/settings`               | Admin                          | Open/close shop and daily target                           |
| `POST /api/budget`                 | Admin                          | Append ledger entry and adjust balance                     |

Money calculations use whole satang. The server validates stock, quantity, prices, duplicated item lines and barcodes; client totals are ignored. Confirmation retries cannot debit stock or credit balance twice. Cross-origin browser mutations are rejected. Product image URLs accept HTTPS or bundled `/products/` paths.

## Verify and deploy

```powershell
npm test
npm run typecheck
npm run build
npm start
```

`npm test` uses isolated temporary data and mocked Omise responses; it never sends a payment request or alters shop Firestore data. Coverage includes authorization, roles, revocation, validation, integer currency, reservations, idempotent fulfillment, receipt privacy, durable writes, webhook signatures/replay rejection, provider amount/mode/reference mismatches, duplicate callbacks, expiry, outages, lost-create recovery and scheduled reconciliation. Real Omise credentials, public HTTPS deployment and an end-to-end provider test are still required before accepting real payments. The existing Firestore connection/import has been verified separately.

**Vercel:** import this Next.js project, configure the production Firestore environment above, and deploy. Use the Node.js runtime, not Edge. Vercel provides HTTPS. Do not deploy demo storage; use a unique setup token and create your own administrator account. Check function duration and Firestore region/latency, and verify one real test purchase with staff before opening the kiosk.

**Self-hosting:** run `npm run build` then `npm start` under your process supervisor, behind an HTTPS reverse proxy on the same origin. The default server binds only to `127.0.0.1`. Forward host and protocol accurately so the cross-origin guard can compare the browser Origin with the canonical request origin. If exposing the Next server itself to a LAN, invoke `next start --hostname 0.0.0.0` and configure network access intentionally. Use Firestore for production storage. See [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

The local app is connected to the configured Firestore project after migration. No public website deployment was created. The local preview remains available while its process runs.

Image attribution and license details are in [`public/products/ATTRIBUTION.md`](public/products/ATTRIBUTION.md). Catalog samples are replaceable through inventory settings. Fonts are Google Fonts (`DM Sans`, `Noto Sans Thai`) with local fallback fonts; external font availability does not block shopping.
"# Dskru-Coop" 
