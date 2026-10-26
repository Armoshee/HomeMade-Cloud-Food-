# HomeMade Cloud Food Online Orders

This folder contains the website and a Node.js server. Customers can add products to a cart, submit their name and delivery address online, and the server sends an order notification to the shop WhatsApp number.

## What is ready

- Add to Cart, Buy Now, quantity controls, and order totals.
- Checkout form for customer name, phone, delivery address, city, PIN code, and notes.
- Server-side product and price validation.
- WhatsApp Business Platform template notification to the shop after online checkout.

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

Install Node.js 24, open a terminal in this folder, run npm start, and open http://localhost:3000. Orders work only after WhatsApp settings and the approved template are configured.

## Product prices

The server keeps a copy of the price list so customers cannot change a price in the browser. Update prices in server.js and the corresponding product labels in index.html together. Rameshwaram Poondu Thokku is a 150g pack priced at ₹190; update the price in both files if it changes.



