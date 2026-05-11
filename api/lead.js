import crypto from "crypto";

export const config = {
  runtime: "edge",
};

function hash(value) {
  if (!value) return undefined;
  return crypto
    .createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
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

  const {
    firstName, lastName, phone, city, externalId,
    fbp, fbc, eventSourceUrl, eventName,
    clientIp, clientUserAgent, testEventCode,
  } = body;

  const ip =
    clientIp ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip");

  const ua = clientUserAgent || req.headers.get("user-agent");

  const eventPayload = {
    event_name: eventName || "Lead",
    event_time: Math.floor(Date.now() / 1000),
    event_source_url: eventSourceUrl,
    action_source: "website",
    user_data: {
      em: hash(body.email || ""),
      ph: hash(normalizePhone(phone)),
      fn: hash(firstName),
      ln: hash(lastName),
      ct: hash(city),
      country: hash("br"),
      external_id: hash(externalId),
      fbp: fbp || null,
      fbc: fbc || null,
      client_ip_address: ip || null,
      client_user_agent: ua || null,
    },
  };

  Object.keys(eventPayload.user_data).forEach((key) => {
    if (eventPayload.user_data[key] === null || eventPayload.user_data[key] === undefined) {
      delete eventPayload.user_data[key];
    }
  });

  const payload = {
    data: [eventPayload],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };

  const metaUrl = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  let metaResponse;
  try {
    metaResponse = await fetch(metaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
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
