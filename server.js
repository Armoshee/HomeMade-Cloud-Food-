"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const ORDERS_FILE = path.join(ROOT, "orders.json");

function loadLocalEnv() {
    const envPath = path.join(ROOT, ".env");
    if (!fs.existsSync(envPath)) return;
    for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const splitAt = line.indexOf("=");
        if (splitAt < 1) continue;
        const key = line.slice(0, splitAt).trim();
        let value = line.slice(splitAt + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = value;
    }
}
loadLocalEnv();

const PORT = Number(process.env.PORT || 3000);
const CHENNAI_DELIVERY_FEE = Number(process.env.CHENNAI_DELIVERY_FEE_INR || 60);
const DOMESTIC_DELIVERY_FEE = Number(process.env.DOMESTIC_DELIVERY_FEE_INR || 120);

const PRODUCTS = Object.freeze({
    "chicken-pickle": { name: "Chicken Pickle", price: 300, grams: 250 },
    "beef-pickle": { name: "Beef Pickle", price: 380, grams: 250 },
    "mutton-pickles": { name: "Mutton Pickle", price: 700, grams: 250 },
    "prawn-pickle": { name: "Prawn Pickle", price: 400, grams: 250 },
    "fish-pickles": { name: "Fish Pickle", price: 500, grams: 250 },
    "beef-sambal": { name: "Beef Sambal", price: 400, grams: 150 },
    "chicken-sambal": { name: "Chicken Sambal", price: 250, grams: 150 },
    "fish-dry-sambal": { name: "Fish Dry Sambal", price: 320, grams: 150 },
    "prawn-sambal": { name: "Prawn Sambal", price: 350, grams: 150 },
    "squid-sambal": { name: "Squid Sambal", price: 350, grams: 150 },
    "nethli-dry-fish-sambal": { name: "Nethli Dry Fish Sambal", price: 350, grams: 150 },
    "kongu-nadu-pirandai-thokku": { name: "Kongu Nadu Pirandai Thokku", price: 220, grams: 200 },
    "madurai-chinna-vengayam-thokku": { name: "Madurai Chinna Vengayam Thokku", price: 210, grams: 200 },
    "mylapore-vatha-kolambu": { name: "Mylapore Vatha Kolambu", price: 190, grams: 200 },
    "rameshwaram-poondu-thokku": { name: "Rameshwaram Poondu Thokku", price: 210, grams: 200 }
});

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
};

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
    });
    res.end(JSON.stringify(payload));
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
            if (body.length > 64 * 1024) {
                reject(new Error("Order form is too large."));
                req.destroy();
            }
        });
        req.on("end", () => {
            try {
                resolve(JSON.parse(body || "{}"));
            } catch {
                reject(new Error("Invalid order data."));
            }
        });
        req.on("error", reject);
    });
}

function readRawBody(req, limit = 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", chunk => {
            size += chunk.length;
            if (size > limit) return reject(new Error("Webhook body is too large."));
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

function cleanText(value, maxLength) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validateOrder(body) {
    const customerName = cleanText(body.customerName, 100);
    const customerPhone = cleanText(body.customerPhone, 20);
    const address = cleanText(body.address, 400);
    const city = cleanText(body.city, 100);
    const state = cleanText(body.state, 100);
    const country = cleanText(body.country, 100) || "India";
    const pincode = cleanText(body.pincode, 12);
    const notes = cleanText(body.notes, 300);
    const shippingMethod = cleanText(body.shippingMethod, 80) || "Standard courier";
    const billingSame = body.billingSame !== false;
    const billingAddress = billingSame ? "" : cleanText(body.billingAddress, 400);
    const billingCity = billingSame ? "" : cleanText(body.billingCity, 100);
    const billingState = billingSame ? "" : cleanText(body.billingState, 100);
    const billingCountry = billingSame ? "" : cleanText(body.billingCountry, 100);
    const billingPincode = billingSame ? "" : cleanText(body.billingPincode, 12);

    if (customerName.length < 2) throw new Error("Enter your full name.");
    if (!/^[0-9+() -]{7,20}$/.test(customerPhone)) throw new Error("Enter a valid phone number.");
    if (address.length < 8) throw new Error("Enter the complete delivery address.");
    if (city.length < 2) throw new Error("Enter your area or city.");
    if (!country) throw new Error("Choose a delivery country.");
    if (state.length < 2) throw new Error("Enter or select a state or province.");
    if (country === "India" ? !/^[0-9]{6}$/.test(pincode) : !/^[A-Za-z0-9 -]{3,12}$/.test(pincode)) throw new Error("Enter a valid postal code.");
    if (!["Standard courier", "Alternate courier"].includes(shippingMethod)) throw new Error("Choose a valid courier service.");
    if (!billingSame && (billingAddress.length < 8 || billingCity.length < 2 || billingState.length < 2 || !billingCountry || (billingCountry === "India" ? !/^[0-9]{6}$/.test(billingPincode) : !/^[A-Za-z0-9 -]{3,12}$/.test(billingPincode)))) throw new Error("Enter a complete billing address and valid postal code.");
    if (body.acceptTerms !== true) throw new Error("Please accept the terms and policies before payment.");
    if (body.acceptWhatsAppApproval !== true) throw new Error("Please consent to receive the WhatsApp approval update.");
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) {
        throw new Error("Your cart is empty or invalid.");
    }

    const items = [];
    for (const requested of body.items) {
        const product = PRODUCTS[requested && requested.id];
        const qty = Number(requested && requested.qty);
        const grams = requested && requested.grams == null ? product && product.grams : Number(requested && requested.grams);
        const allowedGrams = product ? new Set([product.grams, 250, 500, 950, 1000]) : new Set();
        if (!product || !Number.isInteger(qty) || qty < 1 || qty > 99 || !Number.isInteger(grams) || !allowedGrams.has(grams)) {
            throw new Error("A product, pack size, or quantity in the cart is invalid.");
        }
        const price = Math.round(product.price * grams / product.grams);
        items.push({ id: requested.id, name: product.name + " (" + grams + " g)", price, qty, grams });
    }

    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const totalGrams = items.reduce((sum, item) => sum + item.grams * item.qty, 0);
    const shipping = country === "India"
        ? (/^600\d{3}$/.test(pincode)
            ? (Number.isFinite(CHENNAI_DELIVERY_FEE) && CHENNAI_DELIVERY_FEE >= 0 ? CHENNAI_DELIVERY_FEE : 60)
            : (Number.isFinite(DOMESTIC_DELIVERY_FEE) && DOMESTIC_DELIVERY_FEE >= 0 ? DOMESTIC_DELIVERY_FEE : 120))
        : 0;
    const total = subtotal + shipping;
    return { customerName, customerPhone, address, city, state, country, pincode, notes, shippingMethod, shipping, subtotal, billingSame, billingAddress, billingCity, billingState, billingCountry, billingPincode, items, total };
}

function formatOrderReference(id) {
    return "CFP-" + String(id).replace(/^order_/, "").slice(-8).toUpperCase();
}

function money(amount) {
    return "INR " + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(amount);
}

async function sendBusinessTemplate(templateName, language, components) {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const senderId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const recipient = (process.env.WHATSAPP_TO || "").replace(/\D/g, "");
    const apiVersion = process.env.WHATSAPP_API_VERSION || "";
    if (!token || !senderId || !recipient || !/^v\d+\.\d+$/.test(apiVersion)) {
        throw new Error("Online WhatsApp notifications are not configured yet.");
    }
    const response = await fetch("https://graph.facebook.com/" + apiVersion + "/" + senderId + "/messages", {
        method: "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
            messaging_product: "whatsapp", recipient_type: "individual", to: recipient, type: "template",
            template: { name: templateName, language: { code: language }, components }
        }),
        signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error("WhatsApp template send failed:", templateName, response.status, detail.slice(0, 500));
        throw new Error("WhatsApp could not send the shop notification. Check the approved template and sender configuration.");
    }
}

async function notifyBusiness(order) {
    const quickReplyTemplate = process.env.WHATSAPP_APPROVAL_QUICK_REPLY_TEMPLATE_NAME || "";
    const templateName = quickReplyTemplate || process.env.WHATSAPP_TEMPLATE_NAME || "new_order_approval";
    const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US";
    const publicSiteUrl = String(process.env.PUBLIC_SITE_URL || "");
    if ((!quickReplyTemplate && !/^https:\/\//i.test(publicSiteUrl)) || !order.approvalToken) {
        throw new Error("Configure the public approval URL or the WhatsApp quick-reply approval template.");
    }

    const itemSummary = order.items.map((item) =>
        item.name + " x" + item.qty + " (" + money(item.price * item.qty) + ")"
    ).join("; ");
    const fullAddress = [order.address, order.city, order.state, order.country, order.pincode].filter(Boolean).join(", ");
    const orderId = order.displayOrderId || formatOrderReference(order.id);
    const alertType = order.status === "PAID_PENDING_APPROVAL"
        ? "PhonePe payment received and verified. Order " + orderId
        : order.paymentMethod === "UPI QR"
            ? "Customer reports UPI payment; verify bank credit before approval. Order " + orderId
            : "New order submitted; verify payment before approval. Order " + orderId;
    const parameters = [
        alertType,
        order.customerName,
        order.customerPhone,
        fullAddress,
        itemSummary,
        money(order.total),
        ["Subtotal: " + money(order.subtotal), "Delivery: " + money(order.shipping), "Courier: " + order.shippingMethod, order.notes || "", order.billingSame ? "Billing: same as delivery" : "Billing: " + [order.billingAddress, order.billingCity, order.billingState, order.billingCountry, order.billingPincode].filter(Boolean).join(", ")].filter(Boolean).join(" | ")
    ].map((text) => ({ type: "text", text: String(text).slice(0, 1024) }));

    const components = [{ type: "body", parameters }];
    if (quickReplyTemplate) {
        components.push({ type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "approve:" + order.approvalToken }] });
    } else {
        components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: order.approvalToken }] });
    }
    await sendBusinessTemplate(templateName, language, components);
    return orderId;
}

async function notifyBusinessWebsiteVisit(page) {
    const templateName = process.env.WHATSAPP_VISIT_TEMPLATE_NAME || "website_visit_alert";
    const language = process.env.WHATSAPP_VISIT_TEMPLATE_LANGUAGE || "en_US";
    const time = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date());
    await sendBusinessTemplate(templateName, language, [{
        type: "body",
        parameters: [page, time].map(text => ({ type: "text", text: String(text).slice(0, 120) }))
    }]);
}

async function notifyCustomerApproved(order) {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const senderId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const apiVersion = process.env.WHATSAPP_API_VERSION || "";
    const templateName = process.env.WHATSAPP_APPROVED_TEMPLATE_NAME || "order_approved";
    const language = process.env.WHATSAPP_APPROVED_TEMPLATE_LANGUAGE || "en_US";
    let recipient = String(order.customerPhone || "").replace(/\D/g, "");
    if (recipient.length === 10) recipient = "91" + recipient;
    if (recipient.startsWith("0") && recipient.length === 11) recipient = "91" + recipient.slice(1);
    if (!token || !senderId || !recipient || !/^v\d+\.\d+$/.test(apiVersion)) {
        throw new Error("Customer WhatsApp approval is not configured yet.");
    }
    const orderId = order.displayOrderId || formatOrderReference(order.id);
    const international = String(order.country || "India").toLowerCase() !== "india";
    const minDaysSetting = Number(process.env[international ? "INTERNATIONAL_DELIVERY_MIN_DAYS" : "DOMESTIC_DELIVERY_MIN_DAYS"] || (international ? 10 : 5));
    const maxDaysSetting = Number(process.env[international ? "INTERNATIONAL_DELIVERY_MAX_DAYS" : "DOMESTIC_DELIVERY_MAX_DAYS"] || (international ? 14 : 7));
    const minDays = Number.isInteger(minDaysSetting) && minDaysSetting >= 0 ? minDaysSetting : (international ? 10 : 5);
    const maxDays = Number.isInteger(maxDaysSetting) && maxDaysSetting >= minDays ? maxDaysSetting : Math.max(minDays, international ? 14 : 7);
    const today = new Date();
    const deliveryDate = (days) => {
        const date = new Date(today);
        date.setUTCDate(date.getUTCDate() + days);
        return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(date);
    };
    const deliveryFrom = deliveryDate(minDays);
    const deliveryTo = deliveryDate(maxDays);
    const response = await fetch("https://graph.facebook.com/" + apiVersion + "/" + senderId + "/messages", {
        method: "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
            messaging_product: "whatsapp", recipient_type: "individual", to: recipient, type: "template",
            template: { name: templateName, language: { code: language }, components: [{ type: "body", parameters: [orderId, money(order.total), deliveryFrom, deliveryTo].map(text => ({ type: "text", text })) }] }
        }),
        signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error("Customer WhatsApp approval failed:", response.status, detail.slice(0, 500));
        throw new Error("WhatsApp could not send the approval message. Check the approved template and customer number.");
    }
    return orderId;
}

async function readOrders() {
    try {
        const value = JSON.parse(await fs.promises.readFile(ORDERS_FILE, "utf8"));
        return Array.isArray(value) ? value : [];
    } catch (error) {
        if (error.code === "ENOENT") return [];
        throw new Error("Order storage could not be read.");
    }
}

async function writeOrders(orders) {
    const temporary = ORDERS_FILE + ".tmp";
    await fs.promises.writeFile(temporary, JSON.stringify(orders, null, 2), { mode: 0o600 });
    await fs.promises.rename(temporary, ORDERS_FILE);
}

const siteVisitIds = new Map();
const siteVisitIpTimes = new Map();
const SITE_VISIT_PAGES = new Set(["/", "/index.html", "/products.html", "/product.html", "/cart.html", "/about.html", "/contact.html"]);

async function handleSiteVisit(req, res) {
    try {
        const body = await readJson(req);
        const visitId = cleanText(body.visitId, 64);
        const page = cleanText(body.page, 80);
        if (!/^[A-Za-z0-9-]{20,64}$/.test(visitId) || !SITE_VISIT_PAGES.has(page)) {
            return sendJson(res, 400, { ok: false, error: "Invalid website visit." });
        }
        const now = Date.now();
        for (const [key, sentAt] of siteVisitIds) if (now - sentAt > 24 * 60 * 60 * 1000) siteVisitIds.delete(key);
        if (siteVisitIds.has(visitId)) return sendJson(res, 200, { ok: true, duplicate: true });
        const ipKey = String(req.socket.remoteAddress || "unknown");
        if (now - (siteVisitIpTimes.get(ipKey) || 0) < 5000) return sendJson(res, 200, { ok: true, throttled: true });
        siteVisitIds.set(visitId, now);
        siteVisitIpTimes.set(ipKey, now);
        if (siteVisitIds.size > 10000) siteVisitIds.delete(siteVisitIds.keys().next().value);
        if (siteVisitIpTimes.size > 10000) siteVisitIpTimes.delete(siteVisitIpTimes.keys().next().value);
        sendJson(res, 202, { ok: true });
        notifyBusinessWebsiteVisit(page).catch(error => console.error("Website visit WhatsApp notification failed:", error.message));
    } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message || "Could not record website visit." });
    }
}

function isAdmin(req) {
    const expected = process.env.ADMIN_APPROVAL_TOKEN || "";
    const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const expectedBytes = Buffer.from(expected);
    const suppliedBytes = Buffer.from(supplied);
    if (expectedBytes.length < 24 || suppliedBytes.length !== expectedBytes.length) return false;
    return crypto.timingSafeEqual(suppliedBytes, expectedBytes);
}

function requireAdmin(req, res) {
    if (isAdmin(req)) return true;
    sendJson(res, 401, { ok: false, error: "Enter the shop approval access token." });
    return false;
}

async function handleManualOrder(req, res) {
    try {
        const body = await readJson(req);
        const order = validateOrder(body);
        order.id = crypto.randomUUID();
        order.displayOrderId = formatOrderReference(order.id);
        order.approvalToken = crypto.randomBytes(32).toString("base64url");
        order.createdAt = new Date().toISOString();
        order.paymentMethod = "UPI QR";
        order.paymentReference = cleanText(body.paymentReference, 40);
        order.status = "PENDING_APPROVAL";
        order.businessNotified = false;
        order.whatsAppApprovalConsentAt = new Date().toISOString();
        const orders = await readOrders();
        orders.unshift(order);
        await writeOrders(orders);
        let businessNotified = false;
        try { await notifyBusinessOnce(order.id); businessNotified = true; }
        catch (error) { console.error("Manual UPI order saved; shop WhatsApp notification failed:", error.message); }
        sendJson(res, 201, { ok: true, orderId: order.displayOrderId, businessNotified });
    } catch (error) {
        const clientError = /Enter |invalid|empty|too large|accept the terms|Choose a valid/i.test(error.message);
        sendJson(res, clientError ? 400 : 503, { ok: false, error: error.message || "Could not save the order." });
    }
}

async function handleAdminOrders(req, res) {
    if (!requireAdmin(req, res)) return;
    try {
        const orders = await readOrders();
        sendJson(res, 200, { ok: true, orders: orders.map(({ approvalToken, ...order }) => order) });
    } catch (error) { sendJson(res, 500, { ok: false, error: error.message }); }
}

async function findApprovalOrder(token) {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
    const orders = await readOrders();
    const order = orders.find(item => item.approvalToken === token);
    return order ? { orders, order } : null;
}

async function handleWhatsAppApproval(req, res, token) {
    try {
        const found = await findApprovalOrder(token);
        if (!found) return sendJson(res, 404, { ok: false, error: "This approval link is invalid or expired." });
        const { orders, order } = found;
        if (req.method === "GET") {
            return sendJson(res, 200, {
                ok: true,
                order: {
                    orderId: order.displayOrderId,
                    customerName: order.customerName,
                    items: order.items.map(item => ({ name: item.name, qty: item.qty })),
                    total: order.total,
                    paymentMethod: order.paymentMethod,
                    paymentReference: order.paymentReference || "",
                    status: order.status
                }
            });
        }
        if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });
        if (order.status === "APPROVED") return sendJson(res, 200, { ok: true, orderId: order.displayOrderId, alreadyApproved: true });
        if (order.status !== "PENDING_APPROVAL" && order.status !== "PAID_PENDING_APPROVAL") {
            return sendJson(res, 409, { ok: false, error: "This order is not awaiting approval." });
        }
        if (!order.whatsAppApprovalConsentAt) return sendJson(res, 409, { ok: false, error: "The customer did not consent to a WhatsApp approval message." });
        await notifyCustomerApproved(order);
        order.status = "APPROVED";
        order.approvedAt = new Date().toISOString();
        await writeOrders(orders);
        return sendJson(res, 200, { ok: true, orderId: order.displayOrderId });
    } catch (error) {
        sendJson(res, 503, { ok: false, error: error.message || "Could not approve the order." });
    }
}

function safeEqualText(left, right) {
    const a = Buffer.from(String(left || ""));
    const b = Buffer.from(String(right || ""));
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function normalizePhone(value) {
    let phone = String(value || "").replace(/\D/g, "");
    if (phone.length === 10) phone = "91" + phone;
    if (phone.startsWith("0") && phone.length === 11) phone = "91" + phone.slice(1);
    return phone;
}

function metaWebhookSignatureIsValid(req, rawBody) {
    const appSecret = process.env.META_APP_SECRET || "";
    const supplied = String(req.headers["x-hub-signature-256"] || "");
    if (!appSecret || !/^sha256=[a-f0-9]{64}$/i.test(supplied)) return false;
    const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
    return safeEqualText(supplied.toLowerCase(), expected.toLowerCase());
}

async function approveOrderFromWhatsAppReply(payload, sender) {
    const shopNumber = normalizePhone(process.env.WHATSAPP_TO || "");
    if (!shopNumber || normalizePhone(sender) !== shopNumber) return false;
    const match = String(payload || "").match(/^approve:([A-Za-z0-9_-]{40,60})$/);
    if (!match) return false;
    const found = await findApprovalOrder(match[1]);
    if (!found) return false;
    const { orders, order } = found;
    if (order.status === "APPROVED") return true;
    if (order.status !== "PENDING_APPROVAL" && order.status !== "PAID_PENDING_APPROVAL") return false;
    if (!order.whatsAppApprovalConsentAt) return false;
    await notifyCustomerApproved(order);
    order.status = "APPROVED";
    order.approvedAt = new Date().toISOString();
    order.approvedVia = "WhatsApp quick reply";
    await writeOrders(orders);
    return true;
}

async function handleWhatsAppWebhook(req, res) {
    const requestUrl = new URL(req.url, "https://localhost");
    if (req.method === "GET") {
        const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "";
        const mode = requestUrl.searchParams.get("hub.mode");
        const token = requestUrl.searchParams.get("hub.verify_token");
        const challenge = requestUrl.searchParams.get("hub.challenge");
        if (mode !== "subscribe" || !verifyToken || !safeEqualText(token, verifyToken) || !challenge) {
            res.writeHead(403, { "Cache-Control": "no-store" });
            return res.end("Forbidden");
        }
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(challenge);
    }
    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });

    let rawBody;
    let body;
    try {
        rawBody = await readRawBody(req);
        if (!metaWebhookSignatureIsValid(req, rawBody)) return sendJson(res, 401, { ok: false, error: "Invalid Meta webhook signature." });
        body = JSON.parse(rawBody.toString("utf8") || "{}");
    } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message || "Invalid WhatsApp webhook body." });
    }

    try {
        for (const entry of Array.isArray(body.entry) ? body.entry : []) {
            for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
                if (change.field !== "messages") continue;
                const messages = change.value && Array.isArray(change.value.messages) ? change.value.messages : [];
                for (const message of messages) {
                    const reply = message.button?.payload || message.interactive?.button_reply?.id || "";
                    if (reply) await approveOrderFromWhatsAppReply(reply, message.from);
                }
            }
        }
        return sendJson(res, 200, { ok: true });
    } catch (error) {
        console.error("WhatsApp approval reply could not be processed:", error.message);
        return sendJson(res, 500, { ok: false, error: "WhatsApp approval reply could not be processed." });
    }
}

function serveApprovalPage(res) {
    const filePath = path.join(ROOT, "approval.html");
    fs.readFile(filePath, (error, contents) => {
        if (error) {
            res.writeHead(404);
            return res.end("Approval page not found.");
        }
        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff"
        });
        res.end(contents);
    });
}

async function handleAdminApprove(req, res, orderId) {
    if (!requireAdmin(req, res)) return;
    try {
        const orders = await readOrders();
        const order = orders.find(item => item.id === orderId || item.displayOrderId === orderId);
        if (!order) return sendJson(res, 404, { ok: false, error: "Order not found." });
        if (order.status === "APPROVED") return sendJson(res, 200, { ok: true, orderId: order.displayOrderId, alreadyApproved: true });
        if (order.status !== "PENDING_APPROVAL" && order.status !== "PAID_PENDING_APPROVAL") return sendJson(res, 409, { ok: false, error: "This order is not awaiting approval." });
        if (!order.whatsAppApprovalConsentAt) return sendJson(res, 409, { ok: false, error: "The customer did not consent to a WhatsApp approval message." });
        await notifyCustomerApproved(order);
        order.status = "APPROVED";
        order.approvedAt = new Date().toISOString();
        await writeOrders(orders);
        sendJson(res, 200, { ok: true, orderId: order.displayOrderId });
    } catch (error) { sendJson(res, 503, { ok: false, error: error.message || "Could not approve the order." }); }
}

function phonePeConfig() {
    const clientId = process.env.PHONEPE_CLIENT_ID || '';
    const clientSecret = process.env.PHONEPE_CLIENT_SECRET || '';
    const clientVersion = process.env.PHONEPE_CLIENT_VERSION || '';
    if (!clientId || !clientSecret || !clientVersion) throw new Error('PhonePe PG is not configured yet. Contact us on WhatsApp to order.');
    const sandbox = (process.env.PHONEPE_ENV || 'SANDBOX').toUpperCase() !== 'PRODUCTION';
    return { clientId, clientSecret, clientVersion, baseUrl: sandbox ? 'https://api-preprod.phonepe.com/apis/pg-sandbox' : 'https://api.phonepe.com/apis/pg' };
}
async function phonePeToken(config) {
    const form = new URLSearchParams({ client_id: config.clientId, client_version: config.clientVersion, client_secret: config.clientSecret, grant_type: 'client_credentials' });
    const response = await fetch(config.baseUrl + '/v1/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(15000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token) throw new Error('PhonePe authorization failed. Check private merchant credentials and environment.');
    return result.access_token;
}

function isPhonePeWebhookAuthorized(req) {
    const username = process.env.PHONEPE_WEBHOOK_USERNAME || "";
    const password = process.env.PHONEPE_WEBHOOK_PASSWORD || "";
    const authorization = String(req.headers.authorization || "").trim().toLowerCase();
    if (!username || !password || !/^[a-f0-9]{64}$/.test(authorization)) return false;
    const expected = crypto.createHash("sha256").update(username + ":" + password).digest("hex");
    const expectedBytes = Buffer.from(expected, "hex");
    const suppliedBytes = Buffer.from(authorization, "hex");
    return suppliedBytes.length === expectedBytes.length && crypto.timingSafeEqual(suppliedBytes, expectedBytes);
}

async function confirmPhonePeOrder(merchantOrderId, amount, phonePeOrderId, paymentDetails) {
    const orders = await readOrders();
    const order = orders.find(item => item.id === merchantOrderId || item.merchantOrderId === merchantOrderId);
    if (!order) throw new Error("PhonePe payment does not match a saved order.");
    if (Number(amount) !== order.total * 100) {
        order.status = "PAYMENT_AMOUNT_MISMATCH";
        order.paymentStatus = "AMOUNT_MISMATCH";
        order.paymentMismatchAt = new Date().toISOString();
        await writeOrders(orders);
        throw new Error("PhonePe paid amount does not match the saved order total.");
    }
    order.paymentMethod = "PhonePe";
    order.paymentStatus = "COMPLETED";
    order.phonePeOrderId = cleanText(phonePeOrderId, 100);
    const transaction = Array.isArray(paymentDetails) ? paymentDetails.find(item => item && item.state === "COMPLETED") : null;
    if (transaction && transaction.transactionId) order.paymentTransactionId = cleanText(transaction.transactionId, 120);
    if (order.status !== "APPROVED") order.status = "PAID_PENDING_APPROVAL";
    order.paidAt = order.paidAt || new Date().toISOString();
    const index = orders.findIndex(item => item.id === order.id);
    orders[index] = order;
    await writeOrders(orders);
    return order;
}

const businessNotificationFlights = new Map();
async function notifyBusinessOnce(orderId) {
    if (businessNotificationFlights.has(orderId)) return businessNotificationFlights.get(orderId);
    const flight = (async () => {
        let orders = await readOrders();
        let order = orders.find(item => item.id === orderId || item.merchantOrderId === orderId);
        if (!order) throw new Error("Order not found for WhatsApp notification.");
        if (order.businessNotified) return true;
        await notifyBusiness(order);
        orders = await readOrders();
        const index = orders.findIndex(item => item.id === order.id);
        if (index < 0) throw new Error("Order disappeared before notification could be recorded.");
        orders[index].businessNotified = true;
        await writeOrders(orders);
        return true;
    })();
    businessNotificationFlights.set(orderId, flight);
    try { return await flight; }
    finally { businessNotificationFlights.delete(orderId); }
}

async function handleCreatePaymentOrder(req, res) {
    try {
        const config = phonePeConfig();
        const order = validateOrder(await readJson(req));
        order.approvalToken = crypto.randomBytes(32).toString("base64url");
        order.whatsAppApprovalConsentAt = new Date().toISOString();
        const token = await phonePeToken(config);
        const merchantOrderId = 'HCF' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(4).toString('hex').toUpperCase();
        order.id = merchantOrderId;
        order.merchantOrderId = merchantOrderId;
        order.displayOrderId = formatOrderReference(merchantOrderId);
        order.createdAt = new Date().toISOString();
        order.paymentMethod = "PhonePe";
        order.paymentStatus = "PENDING";
        order.status = "PAYMENT_PENDING";
        order.businessNotified = false;
        const orders = await readOrders();
        orders.unshift(order);
        await writeOrders(orders);
        const origin = (req.headers['x-forwarded-proto'] || 'https') + '://' + req.headers.host;
        const response = await fetch(config.baseUrl + '/checkout/v2/pay', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'O-Bearer ' + token },
            body: JSON.stringify({ merchantOrderId, amount: order.total * 100, expireAfter: 1200, metaInfo: { udf1: 'HomeMade Cloud Food' }, paymentFlow: { type: 'PG_CHECKOUT', message: 'HomeMade Cloud Food order', merchantUrls: { redirectUrl: origin + '/cart.html?phonepe_order=' + encodeURIComponent(merchantOrderId) }, paymentModeConfig: { version: 'V2', enabledPaymentModes: [{ type: 'UPI', flows: ['INTENT', 'QR'] }, { type: 'CARD' }, { type: 'NET_BANKING' }] } } }),
            signal: AbortSignal.timeout(15000)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.redirectUrl) { console.error('PhonePe pay request failed:', response.status); throw new Error('PhonePe could not start checkout. Check merchant account configuration.'); }
        sendJson(res, 201, { ok: true, merchantOrderId, redirectUrl: result.redirectUrl });
    } catch (error) {
        const clientError = /Enter |invalid|empty|too long|too large|accept the terms|Choose a valid/i.test(error.message);
        sendJson(res, clientError ? 400 : 503, { ok: false, error: error.message || 'Could not start online payment.' });
    }
}
async function handlePhonePeStatus(req, res) {
    try {
        const id = cleanText(new URL(req.url, 'http://localhost').searchParams.get('merchantOrderId'), 64);
        const order = (await readOrders()).find(item => item.id === id || item.merchantOrderId === id);
        if (!order) throw new Error('This checkout does not match a saved order. Please contact the shop.');
        const config = phonePeConfig();
        const token = await phonePeToken(config);
        const response = await fetch(config.baseUrl + '/checkout/v2/order/' + encodeURIComponent(id) + '/status', { headers: { 'Authorization': 'O-Bearer ' + token }, signal: AbortSignal.timeout(15000) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error('Could not check PhonePe payment status yet. Please retry.');
        if (result.state === 'COMPLETED') {
            let stored = await confirmPhonePeOrder(id, result.amount, result.orderId, result.paymentDetails);
            try { await notifyBusinessOnce(id); }
            catch (error) { console.error('PhonePe payment completed; shop WhatsApp notification failed:', error.message); }
            stored = (await readOrders()).find(item => item.id === id);
            return sendJson(res, 200, { ok: true, state: 'COMPLETED', orderId: stored.displayOrderId, businessNotified: Boolean(stored.businessNotified), approved: stored.status === 'APPROVED' });
        }
        if (result.state === 'FAILED' || result.state === 'CANCELLED') {
            const orders = await readOrders();
            const index = orders.findIndex(item => item.id === id);
            if (index >= 0 && orders[index].status === 'PAYMENT_PENDING') {
                orders[index].status = 'PAYMENT_FAILED';
                orders[index].paymentStatus = result.state;
                await writeOrders(orders);
            }
        }
        sendJson(res, 200, { ok: true, state: result.state || 'PENDING' });
    } catch (error) { sendJson(res, 503, { ok: false, error: error.message || 'Could not verify PhonePe payment.' }); }
}

async function handlePhonePeWebhook(req, res) {
    if (!isPhonePeWebhookAuthorized(req)) return sendJson(res, 401, { ok: false, error: "Invalid PhonePe webhook authorization." });
    let body;
    try { body = await readJson(req); }
    catch (error) { return sendJson(res, 400, { ok: false, error: error.message || "Invalid PhonePe webhook body." }); }
    const event = cleanText(body.event, 80);
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
    const merchantOrderId = cleanText(payload.merchantOrderId, 64);
    if (!merchantOrderId) return sendJson(res, 400, { ok: false, error: "PhonePe webhook has no merchant order ID." });
    try {
        if (event === "checkout.order.completed" && payload.state === "COMPLETED") {
            const order = await confirmPhonePeOrder(merchantOrderId, payload.amount, payload.orderId, payload.paymentDetails);
            sendJson(res, 200, { ok: true });
            notifyBusinessOnce(order.id).catch(error => console.error("PhonePe webhook payment saved; WhatsApp notification failed:", error.message));
            return;
        }
        if (event === "checkout.order.failed" && payload.state === "FAILED") {
            const orders = await readOrders();
            const index = orders.findIndex(item => item.id === merchantOrderId || item.merchantOrderId === merchantOrderId);
            if (index >= 0 && orders[index].status === "PAYMENT_PENDING") {
                orders[index].status = "PAYMENT_FAILED";
                orders[index].paymentStatus = "FAILED";
                await writeOrders(orders);
            }
        }
        sendJson(res, 200, { ok: true, ignored: event !== "checkout.order.completed" && event !== "checkout.order.failed" });
    } catch (error) {
        console.error("PhonePe webhook could not be processed:", error.message);
        sendJson(res, 500, { ok: false, error: "PhonePe webhook processing failed." });
    }
}
function serveStatic(req, res) {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
        return sendJson(res, 400, { error: "Invalid URL." });
    }

    if (pathname === "/") pathname = "/index.html";
    const relativePath = pathname.replace(/^[/\\]+/, "");
    const filePath = path.resolve(ROOT, relativePath);
    const relativeCheck = path.relative(ROOT, filePath);

    if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
        res.writeHead(403);
        return res.end("Forbidden");
    }

    const basename = path.basename(filePath).toLowerCase();
    if ([".env", "server.js", "package.json", ".gitignore", "orders.jsonl", "orders.json", "orders.json.tmp"].includes(basename)) {
        res.writeHead(404);
        return res.end("Not found");
    }

    fs.stat(filePath, (error, stat) => {
        if (error || !stat.isFile()) {
            res.writeHead(404);
            return res.end("Not found");
        }

        const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
        res.writeHead(200, {
            "Content-Type": contentType,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=3600"
        });
        if (req.method === "HEAD") return res.end();
        fs.createReadStream(filePath).pipe(res);
    });
}

const server = http.createServer((req, res) => {
    if ((req.method === "GET" || req.method === "HEAD") && req.url === "/healthz") {
        return sendJson(res, 200, { ok: true });
    }
    if ((req.method === "GET" || req.method === "HEAD") && req.url === "/api/store-config") return sendJson(res, 200, { chennaiDeliveryFeeInr: CHENNAI_DELIVERY_FEE, domesticDeliveryFeeInr: DOMESTIC_DELIVERY_FEE });
    if (req.url.startsWith("/api/whatsapp/webhook") && (req.method === "GET" || req.method === "POST")) return handleWhatsAppWebhook(req, res);
    if (req.method === "POST" && req.url === "/api/payments/orders") return handleCreatePaymentOrder(req, res);
    if (req.method === "GET" && req.url.startsWith("/api/payments/status?")) return handlePhonePeStatus(req, res);
    if (req.method === "POST" && req.url === "/api/phonepe/webhook") return handlePhonePeWebhook(req, res);
    if (req.method === "POST" && req.url === "/api/site-visit") return handleSiteVisit(req, res);
    if (req.method === "POST" && req.url === "/api/manual-orders") return handleManualOrder(req, res);
    if (req.method === "GET" && req.url === "/api/admin/orders") return handleAdminOrders(req, res);
    const approvalApiMatch = req.url.match(/^\/api\/order-approval\/([A-Za-z0-9_-]+)$/);
    if (approvalApiMatch && (req.method === "GET" || req.method === "POST")) return handleWhatsAppApproval(req, res, approvalApiMatch[1]);
    if (req.method === "GET" && /^\/approve\/[A-Za-z0-9_-]{40,60}$/.test(req.url)) return serveApprovalPage(res);
    const approveMatch = req.method === "POST" && req.url.match(/^\/api\/admin\/orders\/([^/]+)\/approve$/);
    if (approveMatch) return handleAdminApprove(req, res, decodeURIComponent(approveMatch[1]));
    if (req.method === "POST" && req.url === "/api/orders") return sendJson(res, 410, { ok: false, error: "Use PhonePe checkout or submit a payment proof for manual shop approval." });
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
    res.writeHead(405, { "Allow": "GET, HEAD, POST" });
    res.end("Method not allowed");
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("HomeMade Cloud Food listening on port " + PORT);
});





