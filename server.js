"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

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
    "chicken-pickle": { name: "Chicken Pickle", price: 300 },
    "beef-pickle": { name: "Beef Pickle", price: 380 },
    "mutton-pickles": { name: "Mutton Pickle", price: 700 },
    "prawn-pickle": { name: "Prawn Pickle", price: 400 },
    "fish-pickles": { name: "Fish Pickle", price: 500 },
    "beef-sambal": { name: "Beef Sambal", price: 400 },
    "chicken-sambal": { name: "Chicken Sambal", price: 250 },
    "fish-dry-sambal": { name: "Fish Dry Sambal", price: 320 },
    "prawn-sambal": { name: "Prawn Sambal", price: 350 },
    "squid-sambal": { name: "Squid Sambal", price: 350 },
    "nethli-dry-fish-sambal": { name: "Nethli Dry Fish Sambal", price: 350 },
    "kongu-nadu-pirandai-thokku": { name: "Kongu Nadu Pirandai Thokku", price: 220 },
    "madurai-chinna-vengayam-thokku": { name: "Madurai Chinna Vengayam Thokku", price: 210 },
    "mylapore-vatha-kolambu": { name: "Mylapore Vatha Kolambu", price: 190 },
    "rameshwaram-poondu-thokku": { name: "Rameshwaram Poondu Thokku", price: 210 }
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
    const pincode = cleanText(body.pincode, 10);
    const notes = cleanText(body.notes, 300);

    if (customerName.length < 2) throw new Error("Enter your full name.");
    if (!/^[0-9+() -]{7,20}$/.test(customerPhone)) throw new Error("Enter a valid phone number.");
    if (address.length < 8) throw new Error("Enter the complete delivery address.");
    if (city.length < 2) throw new Error("Enter your area or city.");
    if (!/^[0-9]{5,10}$/.test(pincode)) throw new Error("Enter a valid PIN code.");
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) {
        throw new Error("Your cart is empty or invalid.");
    }

    const items = [];
    for (const requested of body.items) {
        const product = PRODUCTS[requested && requested.id];
        const qty = Number(requested && requested.qty);
        if (!product || !Number.isInteger(qty) || qty < 1 || qty > 99) {
            throw new Error("A product or quantity in the cart is invalid.");
        }
        items.push({ id: requested.id, name: product.name, price: product.price, qty });
    }

    const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    return { customerName, customerPhone, address, city, pincode, notes, items, total };
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
    const fullAddress = order.address + ", " + order.city + " - " + order.pincode;
    const orderId = "CFP-" + order.id.slice(0, 8).toUpperCase();
    const parameters = [
        orderId,
        order.customerName,
        order.customerPhone,
        fullAddress,
        itemSummary,
        money(order.total),
        order.notes || "None"
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
if (req.method === "POST" && req.url === "/api/orders") return handleOrder(req, res);
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
    res.writeHead(405, { "Allow": "GET, HEAD, POST" });
    res.end("Method not allowed");
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("HomeMade Cloud Food listening on port " + PORT);
});





