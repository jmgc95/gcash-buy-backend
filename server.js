require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const AUTO_APPROVE_KEY = process.env.AUTO_APPROVE_KEY || "";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID in .env");
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true }); // we don't need polling

// In-memory store
const uploads = {};

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}-${file.originalname}`;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// Serve static files
app.use(express.static('.'));
app.use(express.json());

// Upload endpoint
app.post('/api/upload', upload.single('receipt'), async (req, res) => {
  const { name, email, amount, autokey } = req.body;

  if (!req.file) {
    return res.json({ success: false, message: "No file uploaded" });
  }

  const id = uuidv4();
  const token = uuidv4();
  const isAutoApproved = autokey === AUTO_APPROVE_KEY;

  uploads[id] = {
    id,
    token,
    name: name || "Unknown",
    email: email || "No email",
    amount: amount || "149",
    status: isAutoApproved ? 'approved' : 'pending',
    filePath: req.file.path,
    timestamp: Date.now()
  };

  const filePath = req.file.path;

  try {
    // Prepare caption
    const caption = `
New Payment Receipt

Name: ${name || "Unknown"}
Email: ${email || "N/A"}
Amount: ₱${amount || "149"}
Status: ${isAutoApproved ? "AUTO APPROVED" : "Pending Approval"}
Upload ID: ${id}
    `.trim();

    // Inline approve/reject buttons
    const keyboard = isAutoApproved ? null : {
      inline_keyboard: [
        [
          { text: "Approve", callback_data: `approve_${id}` },
          { text: "Reject", callback_data: `reject_${id}` }
        ]
      ]
    };

    // Send photo with caption + buttons
    await bot.sendPhoto(TELEGRAM_ADMIN_CHAT_ID, fs.createReadStream(filePath), {
      caption,
      parse_mode: "HTML",
      reply_markup: keyboard
    });

    console.log(`Receipt sent to Telegram (ID: ${id})`);
  } catch (err) {
    console.error("Failed to send to Telegram:", err.message);
    // Don't fail upload just because Telegram failed
  }

  res.json({ success: true, id });
});

// Handle button clicks from Telegram
bot.on('callback_query', (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;

  if (!data) return;

  const [action, id] = data.split('_');

  if (!uploads[id]) {
    bot.answerCallbackQuery(query.id, { text: "Invalid or expired ID" });
    return;
  }

  if (action === 'approve') {
    uploads[id].status = 'approved';
    bot.sendMessage(chatId, `Payment ${id} has been APPROVED`);
  } else if (action === 'reject') {
    uploads[id].status = 'rejected';
    bot.sendMessage(chatId, `Payment ${id} has been REJECTED`);
  }

  // 🔥 REMOVE buttons after clicking
  bot.editMessageReplyMarkup(
    { inline_keyboard: [] },
    {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id
    }
  );

  bot.answerCallbackQuery(query.id);
});

// Status check
app.get('/api/status', (req, res) => {
  const { id } = req.query;
  if (!id || !uploads[id]) return res.json({});

  const u = uploads[id];
  res.json({
    [id]: {
      status: u.status,
      id: u.id,
      token: u.token
    }
  });
});

// Download route
app.get('/download/:id/:token', (req, res) => {
  const { id, token } = req.params;
  const upload = uploads[id];

  if (!upload || upload.token !== token || upload.status !== 'approved') {
    return res.status(403).send('Access denied or not approved');
  }

  const file = path.join(__dirname, 'GCashTrackerPro-v9.0.zip');
  if (!fs.existsSync(file)) {
    return res.status(404).send('File not found on server');
  }

  res.download(file, 'GCashTrackerPro-v9.0.zip');
});

app.listen(PORT, () => {
  console.log(`Server running on ${PUBLIC_BASE_URL}`);
  console.log(`Admin will receive receipts in Telegram!`);
});