# HomeMade Cloud Food Online Orders

This folder contains the website and a Node.js server. Customers can add products to a cart and use secure online checkout when a PhonePe PG account is configured. The server validates payments and keeps each order pending until the shop manually approves it. WhatsApp alerts require approved templates and Meta Business Platform credentials.

## What is ready

- Add to Cart, Buy Now, quantity controls, and order totals.
- Checkout form for customer name, phone, delivery address, city, PIN code, and notes.
- Server-side product and price validation.
- WhatsApp Business Platform alerts to the shop for PhonePe payments confirmed by PhonePe, UPI payment screenshots submitted at checkout, and website visits.
- Private shop approval page. Orders stay pending until payment is checked and the shop approves them; approval sends a WhatsApp template to the customer.
- Optional one-tap WhatsApp approval: a verified Quick Reply webhook matches the approval payload, approves the pending order, and sends the customer a confirmation template.

## Publish the website online

The file:///.../index.html address is local to your computer. To make the store public, upload this whole folder to a private GitHub repository and deploy it as a Node Web Service on Render.

1. Create or sign in to GitHub and make a private repository for this project.
2. Upload the whole Pickle Website folder, including images, server.js, package.json, .env.example, and .gitignore.
3. Create or sign in to Render with GitHub and choose New > Web Service. Connect the repository.
4. Use Runtime: Node; Build command: npm install; Start command: npm start; Instance type: Free for a preview.
5. Add the WhatsApp environment values described below. Keep the access token private.
6. Deploy. Render will provide a public onrender.com website URL for customers.

Render Free is suitable for testing. It spins down after 15 minutes idle and may take about a minute to wake on the next visit. For a live shop where customers should not wait for the server to wake, choose an always-on plan and check its current price before confirming it.

## WhatsApp notification setup

Create a WhatsApp Business Platform app in Meta's Developer Hub. Set up a sender number and create a template named `new_order_approval` with language `en_US` and this body:

{{1}}. Customer: {{2}}. Phone: {{3}}. Delivery address: {{4}}. Items: {{5}}. Total: {{6}}. {{7}}.

Add one website URL button labeled `Review and approve`, with URL `https://YOUR-SITE/approve/{{1}}`. This opens a private order review page; opening the link does not approve the order. The shop must check the payment and press **Approve order** on that page.

To approve directly from the shop's WhatsApp, create a second approved template named `new_order_approval_quick_reply` (language `en_US`) with the same seven body fields and one **Quick Reply** button labeled `Approve order`. Configure the app's Webhooks product to call `https://YOUR-SITE/api/whatsapp/webhook`, set a strong verify token matching `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, and subscribe the WhatsApp Business Account to the `messages` field. Set the Meta App Secret in `META_APP_SECRET` and the approved template name in `WHATSAPP_APPROVAL_QUICK_REPLY_TEMPLATE_NAME`. With that setting present, shop alerts use the Quick Reply button. Only a reply from the configured `WHATSAPP_TO` shop number is accepted. Tapping **Approve order** approves that pending order and sends the existing `order_approved` customer template. Keep the URL-button approval page as a fallback by leaving the quick-reply template setting blank.

For static UPI proof approval, create an approved template named `payment_proof_approval` (language `en_US`) with an **Image** header, body `{{1}}. Customer: {{2}}. Phone: {{3}}. Delivery address: {{4}}. Items: {{5}}. Total paid: {{6}}. {{7}}.`, and one **Quick Reply** button labeled `Approve`. The checkout sends the selected JPG/PNG screenshot to WhatsApp and uses it in this template. The order does not appear as approvable until this screenshot has been received successfully. When the shop taps **Approve**, the existing `order_approved` template confirms the order to the customer. This image-header template and the WhatsApp API credentials must be configured in Render.

Create a second template named `website_visit_alert` with language `en_US` and body `A visitor opened {{1}} at {{2}}.` This sends one alert when a browser tab first opens a store page. A local `file://` preview cannot send the alert.

Submit the template for approval. Add these as private environment variables in Render:

- WHATSAPP_API_VERSION: current Graph API version shown in Meta.
- WHATSAPP_PHONE_NUMBER_ID: API sender's Phone Number ID.
- WHATSAPP_ACCESS_TOKEN: secret token; never put it in index.html or send it in chat.
- META_APP_SECRET: Meta App Secret, used to verify signatures on inbound WhatsApp webhooks.
- WHATSAPP_WEBHOOK_VERIFY_TOKEN: private token used when Meta verifies `/api/whatsapp/webhook`.
- WHATSAPP_TO: notification recipient, India country code 91 plus the shop number.
- PUBLIC_SITE_URL: the deployed website's public HTTPS base URL.
- WHATSAPP_TEMPLATE_NAME: approved template name, `new_order_approval`.
- WHATSAPP_TEMPLATE_LANGUAGE: template language, en_US.
- WHATSAPP_APPROVAL_QUICK_REPLY_TEMPLATE_NAME: optional approved WhatsApp template with a Quick Reply button labeled `Approve order`; see one-tap setup above.
- WHATSAPP_PAYMENT_PROOF_TEMPLATE_NAME: approved image-header template for UPI payment screenshot alerts, `payment_proof_approval`.
- WHATSAPP_PAYMENT_PROOF_TEMPLATE_LANGUAGE: image-header template language, `en_US`.
- WHATSAPP_VISIT_TEMPLATE_NAME: approved template name, `website_visit_alert`.
- WHATSAPP_VISIT_TEMPLATE_LANGUAGE: template language, en_US.
- ADMIN_APPROVAL_TOKEN: a long random secret (at least 32 characters) used to sign in to `/admin.html`.
- WHATSAPP_APPROVED_TEMPLATE_NAME: approved Utility template name for customer approval, `order_approved`.
- WHATSAPP_APPROVED_TEMPLATE_LANGUAGE: the template language, `en_US`.

Create and get Meta approval for a third template named `order_approved`, language `en_US`, with this body:

`Your order {{1}} is confirmed. Payment {{2}} is verified. Expected delivery: {{3}} to {{4}}. Thank you for choosing HomeMade Cloud Food.`

The server fills the delivery dates when the shop approves the order. Defaults are 5–7 calendar days for India and 10–14 calendar days for other countries. Set `DOMESTIC_DELIVERY_MIN_DAYS`, `DOMESTIC_DELIVERY_MAX_DAYS`, `INTERNATIONAL_DELIVERY_MIN_DAYS`, and `INTERNATIONAL_DELIVERY_MAX_DAYS` in the server environment to match the shop's courier estimates.

Customers must opt in to WhatsApp order updates at checkout. After paying the displayed UPI QR, they select their payment screenshot on the checkout page and submit it. The server uploads the image to WhatsApp and sends the shop one image-header template containing the screenshot, order details, and **Approve** button. Before the screenshot is accepted, no approval button is sent and the order remains `AWAITING_PAYMENT_PROOF`. The shop must still verify the bank credit; a screenshot alone does not prove that money arrived. Tapping **Approve** sends the customer the `order_approved` WhatsApp confirmation. Orders are stored in `orders.json` on the server, so configure persistent disk storage with your hosting provider before production use. A static `file://` page cannot run approvals; use the Node server or deployed site URL.

For local preview, copy .env.example to .env and fill in the same values. The .env file is excluded by .gitignore.

## Local preview

Install Node.js 24, open a terminal in this folder, run npm start, and open http://localhost:3000. Online checkout works after PhonePe PG keys are configured. Shop WhatsApp notifications additionally require the Meta WhatsApp settings and an approved template. The local `file://` preview cannot process payments; use `http://localhost:3000` or the deployed Render Node Web Service.

## Product prices

The server keeps a copy of the price list so customers cannot change a price in the browser. Update prices in server.js and the corresponding product labels in index.html together. Rameshwaram Poondu Thokku is a 150g pack priced at ₹190; update the price in both files if it changes.




## PhonePe Standard Checkout

Checkout starts a PhonePe PG session on the server and saves the pending order before redirecting. Customers can choose UPI, QR, cards, or net banking in PhonePe's hosted checkout. A PhonePe webhook or server-side status check verifies the final payment state and amount. Payment confirmation sends the shop a WhatsApp alert, but the order still waits for the shop's manual approval.

1. In PhonePe Business, complete merchant onboarding and obtain the Standard Checkout Client ID, Client Secret, and Client Version. Never paste the Client Secret into HTML, GitHub, or chat.
2. Add these private environment variables in Render: PHONEPE_CLIENT_ID, PHONEPE_CLIENT_SECRET, PHONEPE_CLIENT_VERSION, PHONEPE_ENV=SANDBOX while testing, PHONEPE_WEBHOOK_USERNAME and PHONEPE_WEBHOOK_PASSWORD, CHENNAI_DELIVERY_FEE_INR=60, DOMESTIC_DELIVERY_FEE_INR=120.
3. In the PhonePe Business dashboard, register `https://YOUR-SITE/api/phonepe/webhook`, choose SHA authentication with the same webhook username/password, and subscribe to `checkout.order.completed` and `checkout.order.failed`.
4. Deploy the Node Web Service and verify a sandbox payment. Switch to production credentials and PHONEPE_ENV=PRODUCTION only after PhonePe enables your live account.
5. Configure persistent storage for orders before relying on payment records for live operations. PhonePe webhooks are idempotent and orders are saved before checkout, so a browser redirect or service restart is not required to receive a payment alert.

The local file:// preview cannot call the payment server. Run npm start and open http://localhost:3000/cart.html, or use the deployed Render service. Checkout needs the PhonePe merchant credentials above.

## Static UPI QR fallback

The checkout reveals the shop-provided QR image after the customer selects Pay now (payee RJ Moshe, UPI ID hazina.mew-3@okhdfcbank), a copy-UID action, and an amount-filled UPI app link. Delivery is ₹60 for India PIN codes beginning 600 and ₹120 for other Indian PIN codes. For other countries, checkout displays “Applicable” without adding or showing a delivery amount; confirm the international delivery charge separately. Static QR payments are manual: after the customer submits a screenshot, the shop gets the image and order details with the WhatsApp **Approve** button. The QR payment itself cannot notify the website of a bank credit, so the shop must check the bank before tapping **Approve**. Automatic payment alerts are available for PhonePe Standard Checkout after a verified server callback. The QR image is images/upi-payment-qr.jpeg.

## Sending UPI payment proof

After a customer pays the static QR, checkout saves an order in `orders.json`, then lets them select the successful screenshot. The server sends that image with the order details to the shop using the approved `payment_proof_approval` image-header template. Only after WhatsApp accepts the screenshot does the order move to `PENDING_APPROVAL` and the **Approve** button become available. The site cannot verify the bank payment itself. When the shop taps **Approve**, the `order_approved` template notifies the customer. This requires the running Node service, persistent storage, the Meta WhatsApp settings above, and the customer's WhatsApp consent at checkout.


## Manual bank transfer

The checkout also displays the shop-provided SBI account (Muhaseena A, account number 20282840630, IFSC SBIN0003274, Besant Nagar branch). Bank transfers are manual; verify the credit before confirming an order.
