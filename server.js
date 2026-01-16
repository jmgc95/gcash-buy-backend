require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;

/* ========================= ENV ========================= */
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const AUTO_APPROVE_KEY = process.env.AUTO_APPROVE_KEY || "";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID || !PUBLIC_BASE_URL) {
  console.error("❌ Missing ENV: TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID / PUBLIC_BASE_URL");
  process.exit(1);
}

/* ========================= TELEGRAM WEBHOOK ========================= */

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// Set Telegram webhook
bot.setWebHook(`${PUBLIC_BASE_URL}/bot${TELEGRAM_BOT_TOKEN}`);

// Webhook route (Telegram sends updates here)
app.use(express.json());
app.use(express.urlencoded({ extended: true })); 
app.post(`/bot${TELEGRAM_BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

/* ========================= IN-MEMORY DB ========================= */

const uploads = {};

/* ========================= MULTER ========================= */

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "./uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname}`);
  }
});

const upload = multer({ storage });

/* ========================= API ROUTES ========================= */

// Upload receipt
app.post("/api/upload", upload.single("receipt"), async (req, res) => {
  const { name, email, amount, autokey } = req.body;

  if (!req.file) {
    return res.json({ success: false, message: "No file uploaded" });
  }

  const id = uuidv4();
  const token = uuidv4();
  const approved = autokey === AUTO_APPROVE_KEY;

  uploads[id] = {
    id,
    token,
    name: name || "Unknown",
    email: email || "N/A",
    amount: amount || "149",
    status: approved ? "approved" : "pending",
    filePath: req.file.path
  };

  const caption = `
New Payment Receipt

Name: ${uploads[id].name}
Email: ${uploads[id].email}
Amount: ₱${uploads[id].amount}
Status: ${approved ? "AUTO APPROVED" : "Pending Approval"}
Upload ID: ${id}
`.trim();

  const keyboard = approved
    ? null
    : {
        inline_keyboard: [
          [
            { text: "Approve", callback_data: `approve_${id}` },
            { text: "Reject", callback_data: `reject_${id}` }
          ]
        ]
      };

  try {
    await bot.sendPhoto(
      TELEGRAM_ADMIN_CHAT_ID,
      fs.createReadStream(req.file.path),
      {
        caption,
        reply_markup: keyboard
      }
    );
  } catch (err) {
    console.error("Telegram error:", err.message);
  }

  res.json({ success: true, id });
});

// Approve or reject
bot.on("callback_query", (query) => {
  const [action, id] = query.data.split("_");
  const upload = uploads[id];

  if (!upload) {
    bot.answerCallbackQuery(query.id, { text: "Invalid ID" });
    return;
  }

  upload.status = action === "approve" ? "approved" : "rejected";

  bot.editMessageReplyMarkup(
    { inline_keyboard: [] },
    {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id
    }
  );

  bot.sendMessage(
    query.message.chat.id,
    `Payment ${id} has been ${upload.status.toUpperCase()}`
  );

  bot.answerCallbackQuery(query.id);
});

// Status check
app.get("/api/status", (req, res) => {
  const id = req.query.id;
  if (!id || !uploads[id]) return res.json({});
  const u = uploads[id];
  res.json({ [id]: { status: u.status, id, token: u.token } });
});

// File download
app.get("/download/:id/:token", (req, res) => {
  const { id, token } = req.params;
  const upload = uploads[id];

  if (!upload || upload.token !== token || upload.status !== "approved") {
    return res.status(403).send("Access denied / not approved");
  }

  const filePath = path.join(__dirname, "GTracker-1.0-release.apk");
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }

  res.download(filePath);
});

/* ========================= FRONTEND ========================= */

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ========================= START SERVER ========================= */

app.listen(PORT, () => {
  console.log(`🚀 Server running at: ${PUBLIC_BASE_URL}`);
  console.log("✔ Telegram Webhook Active");
});



