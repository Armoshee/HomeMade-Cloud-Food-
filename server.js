"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const SHIPPING_FEE = Number(process.env.SHIPPING_FEE_INR || 150);
const INTERNATIONAL_RATE_PER_KG = Number(process.env.INTERNATIONAL_RATE_PER_KG_INR || 700);

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
        ? (Number.isFinite(SHIPPING_FEE) && SHIPPING_FEE >= 0 ? SHIPPING_FEE : 150)
        : Math.max(1, Math.ceil(totalGrams / 1000)) * (Number.isFinite(INTERNATIONAL_RATE_PER_KG) && INTERNATIONAL_RATE_PER_KG > 0 ? INTERNATIONAL_RATE_PER_KG : 700);
    const total = subtotal + shipping;
    return { customerName, customerPhone, address, city, state, country, pincode, notes, shippingMethod, shipping, subtotal, billingSame, billingAddress, billingCity, billingState, billingCountry, billingPincode, items, total };
}

function formatOrderReference(id) {
    return "CFP-" + String(id).replace(/^order_/, "").slice(-8).toUpperCase();
}

function money(amount) {
    return "INR " + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(amount);
}

async function notifyBusiness(order) {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const senderId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const recipient = (process.env.WHATSAPP_TO || "").replace(/\D/g, "");
    const apiVersion = process.env.WHATSAPP_API_VERSION || "";
    const templateName = process.env.WHATSAPP_TEMPLATE_NAME || "new_order_alert";
    const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US";

    if (!token || !senderId || !recipient || !/^v\d+\.\d+$/.test(apiVersion)) {
        throw new Error("Online order notifications are not configured yet.");
    }

    const itemSummary = order.items.map((item) =>
        item.name + " x" + item.qty + " (" + money(item.price * item.qty) + ")"
    ).join("; ");
    const fullAddress = [order.address, order.city, order.state, order.country, order.pincode].filter(Boolean).join(", ");
    const orderId = order.displayOrderId || formatOrderReference(order.id);
    const parameters = [
        orderId,
        order.customerName,
        order.customerPhone,
        fullAddress,
        itemSummary,
        money(order.total),
        [order.notes || "", "Courier: " + order.shippingMethod, order.billingSame ? "Billing: same as delivery" : "Billing: " + [order.billingAddress, order.billingCity, order.billingState, order.billingCountry, order.billingPincode].filter(Boolean).join(", ")].filter(Boolean).join(" | ")
    ].map((text) => ({ type: "text", text: String(text).slice(0, 1024) }));

    const response = await fetch(
        "https://graph.facebook.com/" + apiVersion + "/" + senderId + "/messages",
        {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: recipient,
                type: "template",
                template: {
                    name: templateName,
                    language: { code: language },
                    components: [{ type: "body", parameters }]
                }
            }),
            signal: AbortSignal.timeout(15000)
        }
    );

    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error("WhatsApp notification failed:", response.status, detail.slice(0, 500));
        throw new Error("Your order could not be confirmed right now. Please try again or call the shop.");
    }
    return orderId;
}

const pendingPhonePeOrders = new Map();

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
async function handleCreatePaymentOrder(req, res) {
    try {
        const config = phonePeConfig();
        const order = validateOrder(await readJson(req));
        const token = await phonePeToken(config);
        const merchantOrderId = 'HCF' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(4).toString('hex').toUpperCase();
        const origin = (req.headers['x-forwarded-proto'] || 'https') + '://' + req.headers.host;
        const response = await fetch(config.baseUrl + '/checkout/v2/pay', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'O-Bearer ' + token },
            body: JSON.stringify({ merchantOrderId, amount: order.total * 100, expireAfter: 1200, metaInfo: { udf1: 'HomeMade Cloud Food' }, paymentFlow: { type: 'PG_CHECKOUT', message: 'HomeMade Cloud Food order', merchantUrls: { redirectUrl: origin + '/cart.html?phonepe_order=' + encodeURIComponent(merchantOrderId) }, paymentModeConfig: { version: 'V2', enabledPaymentModes: [{ type: 'UPI', flows: ['INTENT', 'QR'] }, { type: 'CARD' }, { type: 'NET_BANKING' }] } } }),
            signal: AbortSignal.timeout(15000)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.redirectUrl) { console.error('PhonePe pay request failed:', response.status); throw new Error('PhonePe could not start checkout. Check merchant account configuration.'); }
        pendingPhonePeOrders.set(merchantOrderId, { ...order, createdAt: Date.now() });
        sendJson(res, 201, { ok: true, merchantOrderId, redirectUrl: result.redirectUrl });
    } catch (error) {
        const clientError = /Enter |invalid|empty|too long|too large|accept the terms|Choose a valid/i.test(error.message);
        sendJson(res, clientError ? 400 : 503, { ok: false, error: error.message || 'Could not start online payment.' });
    }
}
async function handlePhonePeStatus(req, res) {
    try {
        const id = cleanText(new URL(req.url, 'http://localhost').searchParams.get('merchantOrderId'), 64);
        const order = pendingPhonePeOrders.get(id);
        if (!order) throw new Error('Checkout session expired on this server. Please contact the shop before paying again.');
        const config = phonePeConfig();
        const token = await phonePeToken(config);
        const response = await fetch(config.baseUrl + '/checkout/v2/order/' + encodeURIComponent(id) + '/status', { headers: { 'Authorization': 'O-Bearer ' + token }, signal: AbortSignal.timeout(15000) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error('Could not check PhonePe payment status yet. Please retry.');
        if (result.state === 'COMPLETED') {
            if (Number(result.amount) !== order.total * 100) throw new Error('Paid amount does not match this order. Contact the shop with your payment reference.');
            order.id = id; order.displayOrderId = formatOrderReference(id);
            let businessNotified = false;
            try { await notifyBusiness(order); businessNotified = true; } catch (error) { console.error('PhonePe payment completed; WhatsApp notification failed:', error.message); }
            pendingPhonePeOrders.delete(id);
            return sendJson(res, 200, { ok: true, state: 'COMPLETED', orderId: order.displayOrderId, businessNotified });
        }
        if (result.state === 'FAILED' || result.state === 'CANCELLED') pendingPhonePeOrders.delete(id);
        sendJson(res, 200, { ok: true, state: result.state || 'PENDING' });
    } catch (error) { sendJson(res, 503, { ok: false, error: error.message || 'Could not verify PhonePe payment.' }); }
}
async function handleOrder(req, res) {
    try {
        const body = await readJson(req);
        const order = validateOrder(body);
        order.id = crypto.randomUUID();
        order.createdAt = new Date().toISOString();
        const orderId = await notifyBusiness(order);
        sendJson(res, 201, { ok: true, orderId });
    } catch (error) {
        const clientError = /Enter |invalid|empty|too large/i.test(error.message);
        sendJson(res, clientError ? 400 : 503, {
            ok: false,
            error: error.message || "Could not place the order."
        });
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
    if ([".env", "server.js", "package.json", ".gitignore", "orders.jsonl"].includes(basename)) {
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
    if ((req.method === "GET" || req.method === "HEAD") && req.url === "/api/store-config") return sendJson(res, 200, { shippingFeeInr: SHIPPING_FEE, internationalRatePerKgInr: INTERNATIONAL_RATE_PER_KG });
if (req.method === "POST" && req.url === "/api/payments/orders") return handleCreatePaymentOrder(req, res);
    if (req.method === "GET" && req.url.startsWith("/api/payments/status?")) return handlePhonePeStatus(req, res);
    if (req.method === "POST" && req.url === "/api/orders") return handleOrder(req, res);
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
    res.writeHead(405, { "Allow": "GET, HEAD, POST" });
    res.end("Method not allowed");
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("HomeMade Cloud Food listening on port " + PORT);
});





