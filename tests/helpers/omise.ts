import type { TestContext } from "node:test";
import type { OmiseCharge } from "../../src/lib/omise";
export function mockOmise(t: TestContext) {
  process.env.PAYMENT_MODE = "test";
  process.env.OMISE_SECRET_KEY = "skey_test_only_mocked_never_sent";
  process.env.OMISE_WEBHOOK_SECRET = Buffer.from("isolated-webhook-test-secret-2026").toString("base64");
  delete process.env.PAYMENT_WEBHOOK_URL;
  const charges = new Map<string, OmiseCharge>();
  const mock = { charges, creates: 0, gets: 0, offline: false, loseCreateResponse: false, rejectCreate: false };
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit = {}) => {
    if (!String(url).startsWith("https://api.omise.co/charges")) throw new Error("Unexpected network request");
    if (mock.offline) throw new Error("Network unavailable");
    if (options.method === "POST") {
      mock.creates++;
      if (mock.rejectCreate) return Response.json({ error: "invalid_request" }, { status: 400 });
      const body = new URLSearchParams(String(options.body));
      const id = `chrg_test_mock${mock.creates}`;
      const charge: OmiseCharge = {
        object: "charge", id, amount: Number(body.get("amount")), currency: "THB",
        livemode: false, status: "pending", paid: false,
        expires_at: body.get("expires_at"),
        metadata: { order_id: body.get("metadata[order_id]"), payment_reference: body.get("metadata[payment_reference]") },
        source: { type: "promptpay", scannable_code: { image: { download_uri: `https://api.omise.co/charges/${id}/documents/docu_mock/downloads/example` } } },
      };
      charges.set(id, charge);
      if (mock.loseCreateResponse) throw new Error("Lost create response");
      return Response.json(charge);
    }
    mock.gets++;
    const parsed = new URL(url);
    if (parsed.pathname === "/charges") return Response.json({ data: [...charges.values()], total: charges.size });
    const charge = charges.get(parsed.pathname.split("/")[2]);
    return Response.json(charge || {}, { status: charge ? 200 : 404 });
  });
  return mock;
}
