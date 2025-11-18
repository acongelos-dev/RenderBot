// RenderBot Pro – Fully Automated Telegram Bot with Stripe Payments
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const Stripe = require('stripe');
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'dummy'); // Prevent Stripe crash if missing
const app = express();
app.use(express.raw({ type: 'application/json' }));

// Global users object
const users = {};

// Pricing
const PRICES = {
  single: 2900,        // $29.00 in cents
  pack5: 9900,         // $99.00
  marketing: 29900     // $299.00
};

// === CRITICAL: Validate Telegram Token BEFORE Creating Bot ===
let bot = null;
const token = process.env.TELEGRAM_TOKEN;
if (!token || token.trim() === '') {
  console.error('🚨 CRITICAL ERROR: TELEGRAM_TOKEN is missing or empty in environment variables!');
  console.error('Fix: Go to Render Dashboard → Environment → Add TELEGRAM_TOKEN with your full token (no quotes/spaces)');
  console.error('Example: 8597793537:AAEzj-or2mCQl9bfrAwsP1_8Z22bM2rPNH4');
} else {
  console.log('✅ Telegram token loaded successfully');
  try {
    bot = new TelegramBot(token, { polling: true });
    console.log('✅ Telegram bot initialized with polling');
  } catch (err) {
    console.error('🚨 Bot initialization failed:', err.message);
  }
}

// === HOMEPAGE (Always Safe, Even If Bot Crashes) ===
app.get('/', (req, res) => {
  let status = '🟡 Partial (Missing Telegram Token – Check Logs)';
  if (bot) status = '🟢 Fully Live';
  
  res.send(`
    <h1>🚀 RenderBot Pro Status</h1>
    <p><strong>Server:</strong> Running on Render</p>
    <p><strong>Bot:</strong> ${status}</p>
    <p>If bot is not live, check Render Logs for TELEGRAM_TOKEN error and fix in Environment tab.</p>
    <p>Stripe webhook ready at /stripe-webhook.</p>
    <hr>
    <small>Powered by Grok-4 + Flux • November 2025</small>
  `);
});

// === STRIPE WEBHOOK (Safe Even Without Bot) ===
app.post('/stripe-webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const telegramId = session.client_reference_id;
    const creditsToAdd = parseInt(session.metadata.credits || '0');
    if (!users[telegramId]) users[telegramId] = { credits: 0 };
    users[telegramId].credits += creditsToAdd;
    
    // Send confirmation ONLY if bot is live
    if (bot) {
      try {
        await bot.sendMessage(telegramId, `Payment successful! You now have ${users[telegramId].credits} rendering credit(s). Upload an elevation to start!`);
      } catch (sendErr) {
        console.error('Failed to send payment confirmation:', sendErr.message);
      }
    } else {
      console.log(`Payment added for user ${telegramId}: ${creditsToAdd} credits (bot offline)`);
    }
  }
  res.json({ received: true });
});

// === BOT EVENT HANDLERS (Only If Bot Is Live) ===
if (bot) {
  // Start command + pricing menu
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (!users[chatId]) users[chatId] = { credits: 0 };

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Buy 1 Rendering – $29', callback_data: 'buy_single' }],
          [{ text: 'Buy 5-Pack – $99', callback_data: 'buy_pack5' }],
          [{ text: 'Full Marketing Kit – $299', callback_data: 'buy_marketing' }],
          [{ text: `Credits: ${users[chatId].credits}`, callback_data: 'ignore' }]
        ]
      }
    };

    bot.sendMessage(chatId,
      `Welcome to *RenderBot Pro* – Instant $5,000-quality architectural renderings in seconds.\n\n` +
      `You have ${users[chatId].credits} rendering credit(s).\n\n` +
      `Just send me a 2D elevation, plan, or sketch and I'll instantly turn it into photorealistic 3D.`,
      { parse_mode: 'Markdown', ...opts }
    );
  });

  // Handle buy buttons
  bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const action = callbackQuery.data;
    let price, credits, name;
    if (action === 'buy_single') { price = PRICES.single; credits = 1; name = '1 Rendering Credit'; }
    if (action === 'buy_pack5') { price = PRICES.pack5; credits = 5; name = '5 Rendering Credits'; }
    if (action === 'buy_marketing') { price = PRICES.marketing; credits = 12; name = 'Full Marketing Kit (12 credits)'; }

    if (price) {
      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{ price_data: { currency: 'usd', product_data: { name }, unit_amount: price }, quantity: 1 }],
          mode: 'payment',
          success_url: 'https://t.me/YourRenderBotPro', // Replace with your real bot username (no @)
          cancel_url: 'https://t.me/YourRenderBotPro',
          client_reference_id: chatId.toString(),
          metadata: { credits: credits.toString() }
        });
        bot.sendMessage(chatId, `Click below to pay securely with Stripe:`, {
          reply_markup: { inline_keyboard: [[{ text: 'Pay Now', url: session.url }]] }
        });
      } catch (err) {
        console.error('Stripe session failed:', err.message);
        bot.sendMessage(chatId, 'Payment setup failed – try again or contact support.');
      }
    }
  });

  // Main rendering logic – receives photo (elevation/plan)
  bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    if (!users[chatId]) users[chatId] = { credits: 0 };
    if (users[chatId].credits < 1) {
      return bot.sendMessage(chatId, 'You need at least 1 credit to render. Buy credits below:', {
        reply_markup: { inline_keyboard: [
          [{ text: '$29 – 1 Rendering', callback_data: 'buy_single' }],
          [{ text: '$99 – 5 Renderings', callback_data: 'buy_pack5' }]
        ]}
      });
    }

    bot.sendMessage(chatId, 'Generating your $5,000-quality rendering... (10–20 seconds)');

    try {
      // Download the highest resolution photo
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const file = await bot.getFile(fileId);
      const imageUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      // Call Grok-4 + Flux (or replace with Gemini/Claude API)
      const response = await axios.post('https://api.x.ai/v1/chat/completions', {
        model: 'grok-4',
        messages: [
          { role: 'system', content: `You are RenderBot Pro. Convert the attached elevation into a photorealistic exterior rendering.
Follow this exact prompt structure (do not deviate):

"Photorealistic exterior rendering of a [style] house strictly matching the attached 2D elevation. 
Match every proportion, window/door placement, roof pitch, materials exactly. 
Camera: eye-level 3/4 corner view (1.6m). Warm golden-hour lighting from left, soft realistic shadows, light overcast sky. 
Ultra-high resolution 8K, cinematic color grading, subtle depth-of-field, lens flare, high-end modern landscaping, reflective surfaces, blurred background with tasteful neighboring buildings and street.
--ar 16:9 --stylize 250 --quality 2"

After the image, add exactly this text:

"✅ RenderBot Pro – Instant Architectural Visualization
Your rendering is ready in seconds — not days.
Want revisions, additional angles, interior views, or animations? Just let me know."` },
          { role: 'user', content: [{ type: 'image_url', image_url: { url: imageUrl } }] }
        ],
        temperature: 0.7,
        max_tokens: 500
      }, {
        headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` }
      });

      const aiResponse = response.data.choices[0].message.content;
      const imageUrlMatch = aiResponse.match(/https:\/\/[^\s]+\.png|https:\/\/[^\s]+\.jpg/);
     
      if (imageUrlMatch) {
        users[chatId].credits -= 1;
        await bot.sendPhoto(chatId, imageUrlMatch[0], {
          caption: aiResponse.split(imageUrlMatch[0])[1].trim() || 
            `✅ RenderBot Pro – Instant Architectural Visualization\n` +
            `Your rendering is ready in seconds — not days.\n` +
            `Want revisions, additional angles, interior views, or animations? Just let me know.\n\n` +
            `Credits remaining: ${users[chatId].credits}`
        });
      } else {
        bot.sendMessage(chatId, 'Something went wrong generating the image. Please try again.');
      }
    } catch (err) {
      console.error('Rendering error:', err.response?.data || err);
      bot.sendMessage(chatId, 'Error generating rendering. Try again or contact support.');
    }
  });

  // Fallback for documents / non-photo
  bot.on('document', (msg) => {
    bot.sendMessage(msg.chat.id, 'Please send your elevation/plan as a photo (not PDF/file) for best results.');
  });
} else {
  console.log('⚠️ Bot handlers skipped – fix TELEGRAM_TOKEN first');
}

// === START SERVER (Always At The End) ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
  console.log(`🌐 Homepage: https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'your-service.onrender.com'}`);
  if (bot) {
    console.log('✅ RenderBot Pro is fully running with Stripe payments!');
  } else {
    console.log('🛑 RenderBot Pro server running but bot offline – check token!');
  }
});
