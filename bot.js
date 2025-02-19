const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const wordsToNumbers = require("words-to-numbers").wordsToNumbers;
const puppeteer = require("puppeteer");

// Use Puppeteer's bundled Chromium by calling puppeteer.executablePath()
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: puppeteer.executablePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// List your admin numbers (without any "@c.us" suffix)
const adminList = ["+254758838334"];

// Global bot mode: "public" (default) or "private"
let botMode = "public";

// Helper function to safely reply to messages.
// If message.reply fails, fall back to client.sendMessage.
async function safeReply(message, text, options = {}) {
  try {
    await message.reply(text, options);
  } catch (error) {
    console.error("Error using message.reply, falling back to sendMessage:", error);
    await client.sendMessage(message.from, text, options);
  }
}

client.on("qr", (qr) => {
  console.log("Scan this QR code to log in:");
  qrcode.generate(qr, { small: false });
});

client.on("ready", () => console.log("✅ Bot is online and ready!"));

const loadData = (filename, defaultValue) => {
  try {
    return JSON.parse(fs.readFileSync(filename));
  } catch (error) {
    return defaultValue;
  }
};

// Data files
let triviaData = loadData("trivia.json", { easy: [], medium: [], hard: [] });
let goldenBellsLyrics = loadData("golden_bells_lyrics.json", {});
let leaderboard = loadData("leaderboard.json", {});
let sundayTeachings = loadData("teachings.json", {});
let teams = loadData("teams.json", {});

// Active sessions and state
let activeQuizzes = {};
let pendingDifficultySelection = {};
let bestOfTenSessions = {};
let activeBattles = {};

const normalizeAnswer = (answer) => {
  let normalized = answer.toLowerCase().trim();
  let converted = wordsToNumbers(normalized);
  return converted !== null ? converted.toString() : normalized;
};

client.on("message", async (message) => {
  try {
    const text = message.body.trim();
    const senderName = message._data.notifyName || "friend";
    const chatId = message.from;
    // In groups, message.author is the sender; in private chats, message.from is used.
    const senderId = message.author || message.from;
    // Normalize the sender id by removing any suffix (e.g., "@c.us")
    const normalizedSender = senderId.replace(/@.*$/, "");
  
    console.log(`Received: ${text} from ${senderName} (${normalizedSender}) in chat ${chatId}`);
  
    // -------------------------
    // MODE TOGGLING (Admin only)
    // -------------------------
    if (text === "!private" && adminList.includes(normalizedSender)) {
      botMode = "private";
      return await safeReply(message, "🔒 Bot mode set to PRIVATE. Only admins can interact with the bot.");
    }
    if (text === "!public" && adminList.includes(normalizedSender)) {
      botMode = "public";
      return await safeReply(message, "🌐 Bot mode set to PUBLIC. Everyone can now interact with the bot.");
    }
  
    // -------------------------
    // PRIVATE MODE CHECK
    // -------------------------
    if (botMode === "private" && !adminList.includes(normalizedSender)) {
      return await safeReply(message, "🚫 This bot is currently in PRIVATE mode. Please contact an admin.");
    }
  
    // -------------------------
    // CANCEL PENDING QUIZ IF A NEW COMMAND IS RECEIVED
    // -------------------------
    if (pendingDifficultySelection[chatId] && text.startsWith("!") && text !== "!quiz") {
      delete pendingDifficultySelection[chatId];
    }
  
    // -------------------------
    // MAIN MENU
    // -------------------------
    if (text === "!menu") {
      return await safeReply(
        message,
        `📜 *Church Bot Commands* 📜\n\n` +
          `✨ *Bible Quiz & Battles*\n` +
          `   ➤ *!quiz* - Start a Bible quiz\n` +
          `   ➤ *!bestof10 <difficulty>* - Play 10 quiz questions\n` +
          `   ➤ *!battle <@opponent>* - Challenge a friend\n` +
          `\n🎵 *Golden Bells Songs*\n` +
          `   ➤ *!lyrics <song name>* - Get song lyrics\n` +
          `\n🏆 *Leaderboard & Scores*\n` +
          `   ➤ *!leaderboard* - View top quiz scores\n` +
          `\n📖 *Sunday Teachings*\n` +
          `   ➤ *!addteaching <title>: <message>* - Save a teaching\n` +
          `   ➤ *!teachings* - List all teachings\n` +
          `   ➤ *!teaching <title>* - Retrieve a specific teaching\n` +
          `\n🏅 *Teams & Group Features*\n` +
          `   ➤ *!jointeam <team_name>* - Join a team\n` +
          `   ➤ *!teamleaderboard* - View team rankings\n` +
          `   ➤ *!tagall* - Mention all group members\n` +
          `\n⚙️ *Admin Commands*\n` +
          `   ➤ *!resetleaderboard* - Clear quiz scores (Admins only)\n` +
          `\n💡 *Stay Blessed!*\n` +
          `   *LOVE: THE TREASURE AND FOUNDATION OF LIFE*\n` +
          `   *©2025 Vergaz_the_Don. All Rights Reserved.* ✨\n`
      );
    }
  
    // -------------------------
    // QUIZ FEATURES
    // -------------------------
    if (text === "!quiz") {
      pendingDifficultySelection[chatId] = true;
      return await safeReply(message, "📚 Select a difficulty: *easy*, *medium*, *hard*.");
    }
  
    if (pendingDifficultySelection[chatId]) {
      let difficulty = text.toLowerCase();
      if (["easy", "medium", "hard"].includes(difficulty)) {
        if (!triviaData[difficulty].length) {
          return await safeReply(message, "❌ No questions available for this difficulty.");
        }
        let questionData = triviaData[difficulty][Math.floor(Math.random() * triviaData[difficulty].length)];
        activeQuizzes[chatId] = { question: questionData.question, answer: questionData.answer.toLowerCase() };
        delete pendingDifficultySelection[chatId];
        return await safeReply(message, `📖 *${difficulty.toUpperCase()} Quiz*\n\n${questionData.question}`);
      } else {
        return await safeReply(message, "❌ Invalid difficulty! Choose: *easy*, *medium*, *hard* or type another command to cancel.");
      }
    }
  
    if (activeQuizzes[chatId]) {
      let correctAnswer = normalizeAnswer(activeQuizzes[chatId].answer);
      let userAnswer = normalizeAnswer(text);
      if (userAnswer === correctAnswer) {
        leaderboard[senderName] = (leaderboard[senderName] || 0) + 1;
        fs.writeFileSync("leaderboard.json", JSON.stringify(leaderboard, null, 2));
        delete activeQuizzes[chatId];
        return await safeReply(message, "🎉 Correct! Type *!quiz* for another.");
      } else {
        return await safeReply(message, "❌ Incorrect! Try again or type *!quiz* for a new question.");
      }
    }
  
    // -------------------------
    // Best of 10 Quiz Feature
    // -------------------------
    if (text.startsWith("!bestof10")) {
      let args = text.split(" ");
      let difficulty = args[1];
      if (!["easy", "medium", "hard"].includes(difficulty) || triviaData[difficulty].length < 10) {
        return await safeReply(message, "❌ Invalid difficulty! Use: *!bestof10 easy*, *!bestof10 medium*, or *!bestof10 hard*.");
      }
      let questions = [...triviaData[difficulty]].sort(() => 0.5 - Math.random()).slice(0, 10);
      bestOfTenSessions[chatId] = { questions: questions, current: 0, score: 0 };
      return await safeReply(message, `📖 *Best of 10 - ${difficulty.toUpperCase()}*\n\nQuestion 1/10:\n${questions[0].question}`);
    }
  
    if (bestOfTenSessions[chatId]) {
      let session = bestOfTenSessions[chatId];
      let correctAnswer = normalizeAnswer(session.questions[session.current].answer);
      let userAnswer = normalizeAnswer(text);
      if (userAnswer === correctAnswer) session.score++;
      session.current++;
      if (session.current < 10) {
        return await safeReply(message, `📖 Question ${session.current + 1}/10:\n${session.questions[session.current].question}`);
      } else {
        leaderboard[senderName] = (leaderboard[senderName] || 0) + session.score;
        fs.writeFileSync("leaderboard.json", JSON.stringify(leaderboard, null, 2));
        delete bestOfTenSessions[chatId];
        return await safeReply(message, `🎉 Best of 10 Completed! You scored ${session.score}/10.`);
      }
    }
  
    // -------------------------
    // GOLDEN BELLS LYRICS
    // -------------------------
    if (text.startsWith("!lyrics")) {
      const songName = text.slice(8).trim();
      if (!goldenBellsLyrics[songName]) {
        return await safeReply(message, "❌ Song not found.");
      }
      return await safeReply(message, `🎵 *${songName}*\n\n${goldenBellsLyrics[songName]}`);
    }
  
    // -------------------------
    // LEADERBOARD
    // -------------------------
    if (text === "!leaderboard") {
      let sorted = Object.entries(leaderboard).sort((a, b) => b[1] - a[1]).slice(0, 5);
      let result = "🏆 *Leaderboard*\n\n" +
        (sorted.length
          ? sorted.map(([user, score], i) => `*${i + 1}.* ${user} - ${score} points`).join("\n")
          : "No scores yet.");
      return await safeReply(message, result);
    }
  
    // -------------------------
    // SUNDAY TEACHINGS
    // -------------------------
    if (text.startsWith("!addteaching")) {
      const parts = text.slice(13).split(":");
      if (parts.length < 2) {
        return await safeReply(message, "❌ Use format: *!addteaching <title>: <message>*");
      }
      const title = parts[0].trim();
      const content = parts.slice(1).join(":").trim();
      sundayTeachings[title] = content;
      fs.writeFileSync("teachings.json", JSON.stringify(sundayTeachings, null, 2));
      return await safeReply(message, `✅ Teaching *"${title}"* has been saved.`);
    }
    
    if (text === "!teachings") {
      if (Object.keys(sundayTeachings).length === 0) {
        return await safeReply(message, "❌ No teachings available yet.");
      }
      let teachingList = "📖 *Available Teachings:*\n\n" +
        Object.keys(sundayTeachings).map((t) => `- *${t}*`).join("\n");
      return await safeReply(message, teachingList);
    }
    
    if (text.startsWith("!teaching")) {
      const title = text.slice(10).trim();
      if (!sundayTeachings[title]) {
        return await safeReply(message, `❌ Teaching *"${title}"* not found.`);
      }
      return await safeReply(message, `📖 *${title}*\n\n${sundayTeachings[title]}`);
    }
    
    // -------------------------
    // TEAMS & GROUP FEATURES
    // -------------------------
    if (text.startsWith("!jointeam")) {
      const teamName = text.slice(10).trim();
      teams[teamName] = teams[teamName] || [];
      if (!teams[teamName].includes(senderName)) {
        teams[teamName].push(senderName);
        fs.writeFileSync("teams.json", JSON.stringify(teams, null, 2));
        return await safeReply(message, `✅ ${senderName} has joined *${teamName}*.`);
      } else {
        return await safeReply(message, `❌ You are already in *${teamName}*.`);
      }
    }
    
    if (text === "!teamleaderboard") {
      let teamScores = Object.entries(teams)
        .map(([team, members]) => `*${team}* - ${members.length} members`)
        .join("\n");
      return await safeReply(message, teamScores || "❌ No teams yet.");
    }
    
    if (text === "!tagall") {
      const chat = await message.getChat();
      if (!chat || !chat.participants) {
        return await safeReply(message, "❌ Unable to fetch participants.");
      }
      let mentions = chat.participants.map((p) => p.id._serialized);
      return await safeReply(message, "📢 *Attention everyone!*", { mentions });
    }
    
    // -------------------------
    // BATTLE MODE
    // -------------------------
    if (text.startsWith("!battle")) {
      const parts = text.split(" ");
      if (parts.length < 2) {
        return await safeReply(message, "❌ Please mention an opponent: *!battle @opponent*");
      }
      const opponent = parts[1];
      if (!opponent.startsWith("@")) {
        return await safeReply(message, "❌ Invalid opponent format. Use: *!battle @opponent*");
      }
      activeBattles[chatId] = { player1: senderName, player2: opponent, score1: 0, score2: 0 };
      return await safeReply(message, `🔥 Battle started! ${senderName} vs ${opponent}`);
    }
    
    // -------------------------
    // ADMIN COMMANDS
    // -------------------------
    if (text === "!resetleaderboard" && adminList.includes(normalizedSender)) {
      leaderboard = {};
      fs.writeFileSync("leaderboard.json", JSON.stringify({}, null, 2));
      return await safeReply(message, "✅ Leaderboard has been reset.");
    }
  
  } catch (error) {
    console.error("Error processing message:", error);
  }
});

client.initialize();

