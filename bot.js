
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");

// Set Puppeteer Executable Path
process.env.PUPPETEER_EXECUTABLE_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
});

client.on("qr", (qr) => {
    console.log("Scan this QR code to log in:");
    qrcode.generate(qr, { small: true });
});

client.on("ready", () => console.log("✅ Bot is online and ready!"));

// Load Data from JSON Files
const loadData = (filename, defaultValue) => {
    try { return JSON.parse(fs.readFileSync(filename)); }
    catch (error) { return defaultValue; }
};

let triviaData = loadData("trivia.json", { easy: [], medium: [], hard: [] });
let goldenBellsLyrics = loadData("golden_bells_lyrics.json", {});
let leaderboard = loadData("leaderboard.json", {});

// Active game sessions
let activeQuizzes = {}, pendingDifficultySelection = {}, bestOfTenSessions = {};

const normalizeAnswer = (answer) => answer.toLowerCase().trim();

client.on("message", async (message) => {
    const text = message.body.trim().toLowerCase();
    const senderName = message._data.notifyName || "friend";
    const chatId = message.from;

    if (text.startsWith("!")) {
        const args = text.slice(1).split(" ");
        const command = args.shift();

        // Help Command
    if (command === "help") {
        return await message.reply(
        `📜 *Church Bot Commands* 📜\n\n` +
        `✨ *Bible Quiz*\n` +
        `   ➤ *!quiz* - Start a Bible quiz\n` +
        `   ➤ *!bestof10 <difficulty>* - Play 10 quiz questions in a row (easy/medium/hard)\n\n` +
        `🎵 *Golden Bells Songs*\n` +
        `   ➤ *!lyrics <song name>* - Get Golden Bells song lyrics\n\n` +
        `🏆 *Leaderboard & Scores*\n` +
        `   ➤ *!leaderboard* - View top quiz scores\n\n` +
        `🙏 *Prayer & Encouragement*\n` +
        `   ➤ *!prayer <request>* - Submit a prayer request\n\n` +
        `ℹ️ *General Commands*\n` +
        `   ➤ *!help* - Display this help menu\n`
        );
    }


        if (command === "lyrics") {
            const songName = args.join(" ");
            return goldenBellsLyrics[songName] 
                ? await message.reply(`🎶 *${goldenBellsLyrics[songName].title}*\n\n${goldenBellsLyrics[songName].lyrics}`)
                : await message.reply(`❌ Song "${songName}" not found.`);
        }

        if (command === "leaderboard") {
            let sorted = Object.entries(leaderboard).sort((a, b) => b[1] - a[1]).slice(0, 5);
            let result = "🏆 *Leaderboard*\n\n" + (sorted.length ? sorted.map(([user, score], i) => `*${i + 1}.* ${user} - ${score} points`).join("\n") : "No scores yet.");
            return await message.reply(result);
        }
    }

    // Handle Best of 10 game
    if (bestOfTenSessions[chatId]) {
        let session = bestOfTenSessions[chatId];
        let correctAnswer = normalizeAnswer(session.questions[session.currentIndex].answer);
        let userAnswer = normalizeAnswer(text);

        if (userAnswer === correctAnswer) session.score++;
        session.currentIndex++;

        if (session.currentIndex < 10) {
            return await message.reply(`📖 *Question ${session.currentIndex + 1}/10*\n\n${session.questions[session.currentIndex].question}`);
        } else {
            leaderboard[senderName] = (leaderboard[senderName] || 0) + session.score;
            fs.writeFileSync("leaderboard.json", JSON.stringify(leaderboard, null, 2));
            delete bestOfTenSessions[chatId];
            return await message.reply(`🎉 *Best of 10 Completed!*\nYou scored *${session.score}/10*!`);
        }
    }

    // Handle normal quiz
    if (activeQuizzes[chatId]) {
        let correctAnswer = normalizeAnswer(activeQuizzes[chatId].answer);
        let userAnswer = normalizeAnswer(text);

        if (userAnswer === correctAnswer) {
            leaderboard[senderName] = (leaderboard[senderName] || 0) + 1;
            fs.writeFileSync("leaderboard.json", JSON.stringify(leaderboard, null, 2));
            delete activeQuizzes[chatId];
            return await message.reply(`🎉 Correct! Type *!quiz* for another.`);
        } else {
            return await message.reply(`❌ Incorrect! Try again or type *!quiz* for a new question.`);
        }
    }

    // Handle quiz difficulty selection
    if (pendingDifficultySelection[chatId]) {
        let difficulty = text;
        if (!["easy", "medium", "hard"].includes(difficulty) || !triviaData[difficulty].length) {
            return await message.reply("❌ Invalid difficulty! Choose: *easy*, *medium*, *hard*.");
        }
        let questionData = triviaData[difficulty][Math.floor(Math.random() * triviaData[difficulty].length)];
        activeQuizzes[chatId] = { question: questionData.question, answer: questionData.answer.toLowerCase() };
        delete pendingDifficultySelection[chatId];
        return await message.reply(`📖 *${difficulty.toUpperCase()} Quiz*\n\n${questionData.question}`);
    }

    if (text === "!quiz") {
        pendingDifficultySelection[chatId] = true;
        return await message.reply("📚 Select a difficulty: *easy*, *medium*, *hard*.");
    }


    if (text.startsWith("!bestof10")) {
        let difficulty = args[0];
        if (!["easy", "medium", "hard"].includes(difficulty) || triviaData[difficulty].length < 10) {
            return await message.reply("❌ Invalid difficulty! Type: *!bestof10 easy*, *!bestof10 medium*, or *!bestof10 hard*.");
        }
        let selectedQuestions = [...triviaData[difficulty]].sort(() => 0.5 - Math.random()).slice(0, 10);
        bestOfTenSessions[chatId] = { questions: selectedQuestions, currentIndex: 0, score: 0 };
        return await message.reply(`📖 *Best of 10 - ${difficulty.toUpperCase()}*\n\n*Question 1/10*\n\n${selectedQuestions[0].question}`);
    }
});

client.initialize();
