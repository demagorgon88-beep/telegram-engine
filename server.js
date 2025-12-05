const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// --- CONFIGURATION (Environment Variables) ---
// We will set these in Render.com later, don't worry about them being empty now.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
const FB_PIXEL_ID = process.env.FB_PIXEL_ID;
const APP_URL = process.env.APP_URL; // Your Render URL

// --- INIT CLIENTS ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(TELEGRAM_TOKEN); // No polling, we use Webhooks

// --- FACEBOOK CAPI HELPER ---
async function sendFbEvent(eventName, userData, eventData = {}) {
    const currentTimestamp = Math.floor(new Date() / 1000);
    
    const payload = {
        data: [{
            event_name: eventName,
            event_time: currentTimestamp,
            action_source: "system_generated",
            user_data: {
                fbc: userData.fb_clid ? `fb.1.${currentTimestamp}.${userData.fb_clid}` : undefined,
                client_user_agent: userData.fb_agent,
                client_ip_address: userData.fb_ip,
                external_id: userData.telegram_id // Linking FB to Telegram ID
            },
            ...eventData
        }],
        access_token: FB_ACCESS_TOKEN
    };

    try {
        await axios.post(`https://graph.facebook.com/v18.0/${FB_PIXEL_ID}/events`, payload);
        console.log(`✅ Sent ${eventName} to FB for user ${userData.unique_token}`);
    } catch (error) {
        console.error('❌ FB CAPI Error:', error.response ? error.response.data : error.message);
    }
}

// --- ROUTE 1: LANDING PAGE TRACKING ---
// The LP calls this to save the FB click data and get a token
app.post('/api/init-user', async (req, res) => {
    const { fbclid, userAgent, ip } = req.body;
    
    // Generate a simple random token (e.g., 'user_98234')
    const uniqueToken = 'user_' + Math.floor(Math.random() * 1000000);

    // Save to Supabase
    const { error } = await supabase
        .from('users')
        .insert({ 
            unique_token: uniqueToken, 
            fb_clid: fbclid, 
            fb_agent: userAgent, 
            fb_ip: ip 
        });

    if (error) {
        console.error('Database Error:', error);
        return res.status(500).json({ error: 'Failed to save user' });
    }

    res.json({ token: uniqueToken });
});

// --- ROUTE 2: TELEGRAM WEBHOOK ---
// Telegram sends messages here
app.post(`/bot${TELEGRAM_TOKEN}`, async (req, res) => {
    const msg = req.body.message;
    res.sendStatus(200); // Tell Telegram we got it immediately

    if (!msg) return;

    const chatId = msg.chat.id.toString();
    const text = msg.text || "";

    // CHECK 1: Is this a "Start" command with a payload? (e.g., /start user_123456)
    if (text.startsWith('/start user_')) {
        const uniqueToken = text.split(' ')[1]; // Extract 'user_123456'

        // Find this user in Database
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('unique_token', uniqueToken)
            .single();

        if (user && !error) {
            // Update the user: Add Telegram ID and set status
            await supabase
                .from('users')
                .update({ telegram_id: chatId, status: 'started' })
                .eq('unique_token', uniqueToken);

            // Send LEAD event to Facebook
            // We now bridge the gap: FB Click <-> Telegram ID
            await sendFbEvent('Lead', { ...user, telegram_id: chatId });

            // Send your welcome message
            await bot.sendMessage(chatId, "Welcome! I see you want the 30-day trial. Let's get started!");
        } else {
            await bot.sendMessage(chatId, "Welcome! (Could not track your ad click, but glad you are here).");
        }
    }
    
    // CHECK 2: Listen for specific keywords (Purchase/Reg logic for later)
    else if (text.toLowerCase().includes("buy")) {
        // You would look up the user by chatId here and send a 'Purchase' event
        // We can build this part later once the Lead part works.
    }
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});