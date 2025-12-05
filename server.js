const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();

// --- 🔴 FIXED CORS SECTION ---
app.use((req, res, next) => {
    // 1. Allow connections from ANY website
    res.header("Access-Control-Allow-Origin", "*");
    
    // 2. Allow these standard headers
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    
    // 3. Allow these actions
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    // 4. CRITICAL: If browser sends a "Preflight" (OPTIONS) check, reply OK immediately.
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    
    next();
});

app.use(bodyParser.json());

// ============================================================
// 👇 YOUR FINAL DESTINATION LINK (Verify this is correct)
const FINAL_DESTINATION = "https://t.me/m/V8gacND6Yjcx"; 
// ============================================================

// --- ENV VARS ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
const FB_PIXEL_ID = process.env.FB_PIXEL_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(TELEGRAM_TOKEN); 

// --- FB CAPI FUNCTION ---
async function sendFbEvent(eventName, userData, chatId) {
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
                external_id: chatId
            },
            custom_data: {
                content_name: userData.ad_name,
                content_category: userData.adset_name
            }
        }],
        access_token: FB_ACCESS_TOKEN
    };
    try {
        await axios.post(`https://graph.facebook.com/v18.0/${FB_PIXEL_ID}/events`, payload);
        console.log(`✅ Sent ${eventName} for ${userData.ad_name}`);
    } catch (e) {
        console.error('❌ FB Error:', e.response ? e.response.data : e.message);
    }
}

// --- 1. LANDING PAGE CALLS THIS ---
app.post('/api/init-user', async (req, res) => {
    const { fbclid, userAgent, ip, ad_name, adset_name } = req.body;
    
    const uniqueToken = 'user_' + Math.floor(Math.random() * 10000000);

    // Using your table name: 'usersbalka'
    const { error } = await supabase.from('usersbalka').insert({ 
        unique_token: uniqueToken, 
        fb_clid: fbclid, 
        fb_agent: userAgent, 
        fb_ip: ip,
        ad_name: ad_name || 'unknown',
        adset_name: adset_name || 'unknown'
    });

    if (error) {
        console.error("DB Error:", error);
        return res.status(500).json({ error: 'DB Error' });
    }
    
    res.json({ token: uniqueToken });
});

// --- 2. TELEGRAM CALLS THIS ---
app.post(`/bot${TELEGRAM_TOKEN}`, async (req, res) => {
    const msg = req.body.message;
    res.sendStatus(200);
    if (!msg) return;

    const chatId = msg.chat.id.toString();
    const text = msg.text || "";

    if (text.startsWith('/start user_')) {
        const token = text.split(' ')[1]; 

        const { data: user, error } = await supabase
            .from('usersbalka').select('*').eq('unique_token', token).single();

        if (user && !error) {
            await supabase.from('usersbalka')
                .update({ telegram_id: chatId, status: 'verified' })
                .eq('unique_token', token);

            await sendFbEvent('Lead', user, chatId);

            await bot.sendMessage(chatId, "🎯 **Imaš sreće!**\n\n Ostalo je par posljednjih mjesta za 30 dana FREE VIPA ⏳🔥 \n\n **Uđi odmah!**:", {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: "💬 Pošalji poruku SADA", url: FINAL_DESTINATION }
                    ]]
                }
            });
        } else {
             await bot.sendMessage(chatId, "Ostalo je par posljednjih mjesta za 30 dana FREE VIPA:", {
                reply_markup: { inline_keyboard: [[{ text: "Pošalji poruku SADA", url: FINAL_DESTINATION }]] }
            });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));