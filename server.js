import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (HTML/CSS) from the 'static' folder
app.use(express.static(path.join(__dirname, 'static')));

// --- Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// We use the current server URL for the Web App button
const WEB_APP_URL = process.env.WEB_APP_URL; 

const GEMINI_MODEL_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
const TELEGRAM_API_BASE = TELEGRAM_BOT_TOKEN ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}` : null;

let last_update_id = 0;
let userChatHistories = {};

// --- 1. Telegram Message Sender ---
async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    if (!TELEGRAM_API_BASE) return;
    
    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    try {
        await fetch(`${TELEGRAM_API_BASE}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (error) {
        console.error("Error sending Telegram message:", error);
    }
}

// --- 2. Gemini AI Logic ---
async function getGeminiResponse(chatHistory) {
    if (!GEMINI_API_KEY) return "My brain (API Key) is missing!";

    try {
        const payload = {
            contents: chatHistory,
            generationConfig: { temperature: 0.7, topP: 0.9, topK: 40 }
        };
        
        const response = await fetch(`${GEMINI_MODEL_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
            return data.candidates[0].content.parts[0].text;
        } else {
            return "I'm having trouble thinking right now. (API Error)";
        }
    } catch (error) {
        console.error("Gemini Error:", error);
        return "Network error connecting to AI.";
    }
}

// --- 3. Telegram Long Polling ---
async function getTelegramUpdates() {
    if (!TELEGRAM_API_BASE) return;

    try {
        const response = await fetch(`${TELEGRAM_API_BASE}/getUpdates?offset=${last_update_id + 1}&timeout=60`);
        const data = await response.json();

        if (data.result && data.result.length > 0) {
            for (const update of data.result) {
                last_update_id = update.update_id;
                if (update.message && update.message.text) {
                    const chatId = update.message.chat.id;
                    const text = update.message.text.trim();

                    if (text === '/start') {
                        userChatHistories[chatId] = [];
                        await sendTelegramMessage(chatId, "Hello! I am Blazer AI. Type below or launch the app:", {
                            inline_keyboard: [[{ text: 'Launch App 🚀', web_app: { url: WEB_APP_URL } }]]
                        });
                    } else {
                        if (!userChatHistories[chatId]) userChatHistories[chatId] = [];
                        userChatHistories[chatId].push({ role: "user", parts: [{ text: text }] });
                        
                        const aiReply = await getGeminiResponse(userChatHistories[chatId]);
                        await sendTelegramMessage(chatId, aiReply);
                        
                        userChatHistories[chatId].push({ role: "model", parts: [{ text: aiReply }] });
                    }
                }
            }
        }
    } catch (error) {
        console.error("Polling Error:", error);
    }
    // Keep polling
    setTimeout(getTelegramUpdates, 1000);
}

// --- 4. Web App Chat Endpoint (The Proxy) ---
app.post('/chat', async (req, res) => {
    const { contents } = req.body;
    if (!GEMINI_API_KEY) return res.status(500).json({ error: "Server missing API Key" });

    try {
        const response = await fetch(`${GEMINI_MODEL_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents })
        });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve the main HTML file for any other route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`Blazer AI running on port ${PORT}`);
    if (TELEGRAM_BOT_TOKEN) getTelegramUpdates();
});
