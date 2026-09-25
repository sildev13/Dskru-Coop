import { db, isDemo, readState } from "@/lib/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const emit = () => {
        if (!closed) controller.enqueue(encoder.encode("data: refresh\n\n"));
      };
      const unsubscribes: (() => void)[] = [];
      if (!isDemo()) {
        unsubscribes.push(
          db()
            .collection("items")
            .onSnapshot(emit, () => {}),
        );
        unsubscribes.push(
          db()
            .doc("settings/store")
            .onSnapshot(emit, () => {}),
        );
        unsubscribes.push(db().collection("transactions").where("status", "==", "pending").onSnapshot(emit, () => {}));
      }
      let previous = "";
      const interval = setInterval(async () => {
        try {
          if (isDemo()) {
            const state = await readState();
            const next = JSON.stringify([state.items, state.settings, state.transactions.filter((p) => p.status === "pending")]);
            if (next !== previous) {
              previous = next;
              emit();
            }
          } else if (!closed)
            controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {}
      }, 5000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        unsubscribes.forEach((f) => f());
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
      emit();
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
