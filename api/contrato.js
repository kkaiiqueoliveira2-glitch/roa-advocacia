// /api/contrato.js — Registra contrato fechado (evento Purchase) via Meta Conversions API
// Token fica em variável de ambiente (META_CAPI_TOKEN) — nunca no front-end.

export const config = {
  runtime: "edge",
};

async function hash(value) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  const data = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizePhone(phone) {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return "55" + digits;
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const PIXEL_ID = process.env.META_PIXEL_ID;
  const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;

  if (!PIXEL_ID || !ACCESS_TOKEN) {
    return new Response(
      JSON.stringify({ error: "Meta credentials not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { name, phone, advogada, area, value, eventSourceUrl, testEventCode } = body;

  if (!phone) {
    return new Response(JSON.stringify({ error: "phone required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userData = {
    ph: await hash(normalizePhone(phone)),
    fn: await hash(name),
    country: await hash("br"),
  };
  Object.keys(userData).forEach((k) => {
    if (userData[k] === null || userData[k] === undefined) delete userData[k];
  });

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        action_source: "other",
        ...(eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
        user_data: userData,
        custom_data: {
          currency: "BRL",
          value: value ? parseFloat(value) : 1,
          content_name: area || "",
          content_category: advogada || "",
        },
      },
    ],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };

  let metaResponse;
  try {
    metaResponse = await fetch(
      `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to reach Meta API", details: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const metaData = await metaResponse.json();

  if (!metaResponse.ok) {
    return new Response(
      JSON.stringify({ error: "Meta API returned error", details: metaData }),
      { status: metaResponse.status, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ success: true, events_received: metaData.events_received }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
