# HomeMade Cloud Food Online Orders

This folder contains the website and a Node.js server. Customers can add products to a cart and use secure online checkout when a PhonePe PG account is configured. The server validates payment before confirming an order and can notify the shop through WhatsApp when Meta Business API settings are configured.

## What is ready

- Add to Cart, Buy Now, quantity controls, and order totals.
- Checkout form for customer name, phone, delivery address, city, PIN code, and notes.
- Server-side product and price validation.
- Optional WhatsApp Business Platform template notification to the shop after successful payment.

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

Create a WhatsApp Business Platform app in Meta's Developer Hub. Set up a sender number and create a Utility template named new_order_alert with language en_US and this body:

New website order {{1}}. Customer: {{2}}. Phone: {{3}}. Address: {{4}}. Items: {{5}}. Total: {{6}}. Notes: {{7}}.

Submit the template for approval. Add these as private environment variables in Render:

- WHATSAPP_API_VERSION: current Graph API version shown in Meta.
- WHATSAPP_PHONE_NUMBER_ID: API sender's Phone Number ID.
- WHATSAPP_ACCESS_TOKEN: secret token; never put it in index.html or send it in chat.
- WHATSAPP_TO: notification recipient, India country code 91 plus the shop number.
- WHATSAPP_TEMPLATE_NAME: approved template name, new_order_alert.
- WHATSAPP_TEMPLATE_LANGUAGE: template language, en_US.

For local preview, copy .env.example to .env and fill in the same values. The .env file is excluded by .gitignore.

## Local preview

Install Node.js 24, open a terminal in this folder, run npm start, and open http://localhost:3000. Online checkout works after PhonePe PG keys are configured. Shop WhatsApp notifications additionally require the Meta WhatsApp settings and an approved template. The local `file://` preview cannot process payments; use `http://localhost:3000` or the deployed Render Node Web Service.

## Product prices

The server keeps a copy of the price list so customers cannot change a price in the browser. Update prices in server.js and the corresponding product labels in index.html together. Rameshwaram Poondu Thokku is a 150g pack priced at ₹190; update the price in both files if it changes.




## PhonePe Standard Checkout

Checkout starts a PhonePe PG session on the server. Customers can choose UPI, QR, cards, or net banking in the PhonePe hosted checkout. The server checks the final order state and amount with PhonePe before marking it paid.

1. In PhonePe Business, complete merchant onboarding and obtain the Standard Checkout Client ID, Client Secret, and Client Version. Never paste the Client Secret into HTML, GitHub, or chat.
2. Add these private environment variables in Render: PHONEPE_CLIENT_ID, PHONEPE_CLIENT_SECRET, PHONEPE_CLIENT_VERSION, PHONEPE_ENV=SANDBOX while testing, and SHIPPING_FEE_INR=150 for India; INTERNATIONAL_RATE_PER_KG_INR=700 for international courier, charged per started kg with a 1 kg minimum.
3. Deploy the Node Web Service and verify a sandbox payment. Switch to production credentials and PHONEPE_ENV=PRODUCTION only after PhonePe enables your live account.
4. Add a persistent order database and PhonePe webhook before relying on payment records for live operations. The current checkout keeps pending checkout sessions in server memory, so a service restart during payment requires the customer to contact the shop for reconciliation.

The local file:// preview cannot call the payment server. Run npm start and open http://localhost:3000/cart.html, or use the deployed Render service. Checkout needs the PhonePe merchant credentials above.

## Static UPI QR fallback

The checkout also displays the shop-provided QR image (payee RJ Moshe, UPI ID hazina.mew-3@okhdfcbank), a copy-UID action, and an amount-filled UPI app link. The amount displayed includes the current cart items and shipping (₹150 within India; international courier ₹700 per started kg with a minimum charge of 1 kg). Customers can send their UTR/reference with the order through WhatsApp to +91 84386 06950. This QR path is a manual payment flow: do not mark an order paid until the bank receipt is checked. Automatic payment confirmation requires configured PhonePe Standard Checkout credentials and a successful server-side status check. The QR image is images/upi-payment-qr.jpeg.

## Sending UPI payment proof

After a customer pays the static QR, checkout lets them select the successful payment screenshot and share it with the order details. On browsers that support file sharing, the native share sheet opens; the customer must choose WhatsApp Business and the shop chat (+91 84386 06950). Otherwise, the direct WhatsApp chat opens with the order details and the customer must attach the selected image in WhatsApp. The site cannot automatically capture a screenshot from GPay or read/verify the payment. A customer message or screenshot does not confirm receipt; the shop must verify the credit in its bank account before confirming the order.


## Manual bank transfer

The checkout also displays the shop-provided SBI account (Muhaseena A, account number 20282840630, IFSC SBIN0003274, Besant Nagar branch). Bank transfers are manual; verify the credit before confirming an order.
