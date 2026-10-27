"use strict";

const crypto = require("node:crypto");

function normalizePhone(value) {
    return String(value || "").replace(/\D/g, "");
}

function config() {
    const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
    const senderId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
    const apiVersion = process.env.WHATSAPP_API_VERSION || "";
    const appSecret = process.env.WHATSAPP_APP_SECRET || "";
    const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "";
    const businessPhone = normalizePhone(process.env.WHATSAPP_BUSINESS_PHONE || process.env.WHATSAPP_TO || "");
    const coexistenceEnabled = process.env.WHATSAPP_COEXISTENCE_ENABLED === "true";
    return { token, senderId, apiVersion, appSecret, verifyToken, businessPhone,
        ready: Boolean(token && senderId && /^v\d+\.\d+$/.test(apiVersion) && appSecret && verifyToken && businessPhone && coexistenceEnabled) };
}

function safeEqual(left, right) {
    const a = Buffer.from(String(left || ""));
    const b = Buffer.from(String(right || ""));
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readRawBody(req, maxBytes = 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
                reject(new Error("Webhook payload is too large."));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

function signatureIsValid(rawBody, signature, appSecret) {
    if (!signature || !appSecret || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
    const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
    return safeEqual(signature.toLowerCase(), expected.toLowerCase());
}

const handledMessageIds = new Set();

async function sendConfirmation(orderReference, customerPhone, settings) {
    const to = normalizePhone(customerPhone);
    if (!/^\d{8,15}$/.test(to)) throw new Error("Customer phone is invalid.");
    const response = await fetch("https://graph.facebook.com/" + settings.apiVersion + "/" + settings.senderId + "/messages", {
        method: "POST",
        headers: { "Authorization": "Bearer " + settings.token, "Content-Type": "application/json" },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "text",
            text: { body: "Order has been confirmed. Your order reference is " + orderReference + ". Thank you for ordering from HomeMade Cloud Food." }
        }),
        signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error("Meta did not accept the confirmation message.");
}

async function processApprovalEchoes(payload, settings) {
    for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
        for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
            if (change.field !== "smb_message_echoes") continue;
            const value = change.value || {};
            if (value.metadata && value.metadata.phone_number_id && value.metadata.phone_number_id !== settings.senderId) continue;
            const echoes = Array.isArray(value.message_echoes) ? value.message_echoes : [];
            for (const message of echoes) {
                const from = normalizePhone(message.from);
                const to = normalizePhone(message.to);
                const body = message.type === "text" ? String(message.text && message.text.body || "") : "";
                const match = /^\s*OK\s+(CFP-[A-Z0-9]{8})\s*$/i.exec(body);
                const id = String(message.id || "");
                if (!match || from !== settings.businessPhone || !/^\d{8,15}$/.test(to) || !id || handledMessageIds.has(id)) continue;
                const reference = match[1].toUpperCase();
                await sendConfirmation(reference, to, settings);
                handledMessageIds.add(id);
                if (handledMessageIds.size > 2000) handledMessageIds.delete(handledMessageIds.values().next().value);
                console.log("Customer confirmation sent for " + reference + ".");
            }
        }
    }
}

function verify(req, res) {
    const settings = config();
    const url = new URL(req.url, "https://localhost");
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (!settings.verifyToken || mode !== "subscribe" || !safeEqual(token, settings.verifyToken) || !challenge) {
        res.writeHead(403, { "Cache-Control": "no-store" });
        return res.end("Forbidden");
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(challenge);
}

async function receive(req, res) {
    const settings = config();
    if (!settings.appSecret) {
        res.writeHead(503, { "Cache-Control": "no-store" });
        return res.end("Webhook is not configured.");
    }
    let rawBody;
    try { rawBody = await readRawBody(req); }
    catch { res.writeHead(413); return res.end("Payload too large."); }
    if (!signatureIsValid(rawBody, req.headers["x-hub-signature-256"], settings.appSecret)) {
        res.writeHead(403, { "Cache-Control": "no-store" });
        return res.end("Invalid signature.");
    }
    let payload;
    try { payload = JSON.parse(rawBody.toString("utf8")); }
    catch { res.writeHead(400); return res.end("Invalid JSON."); }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("EVENT_RECEIVED");
    setImmediate(() => processApprovalEchoes(payload, settings).catch((error) => {
        console.error("WhatsApp approval webhook could not send confirmation:", error.message);
    }));
}

module.exports = { isReady: () => config().ready, verify, receive };

