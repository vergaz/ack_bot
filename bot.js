const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const wordsToNumbers = require("words-to-numbers").wordsToNumbers;

const CHROME_PATH = "C:/Program Files/Google/Chrome/Application/chrome";
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: CHROME_PATH,
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
    // If the error is related to mentions, remove them and try again.
    if (options.mentions) {
      await client.sendMessage(message.from, text);
    } else {
      await client.sendMessage(message.from, text, options);
    }
  }
}

client.on("qr", (qr) => {
  console.log("Scan this QR code to log in:");
  qrcode.generate(qr, { small: true });
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
    // Normalize commands: if message starts with "!", remove any extra space immediately after the exclamation mark.
    let normalizedText = text;
    if (text.startsWith("!")) {
      normalizedText = text.replace(/^!\s+/, "!");
    }
    
    const senderName = message._data.notifyName || "friend";
    const chatId = message.from;
    // In groups, message.author is the sender; in private chats, use message.from.
    const senderId = message.author || message.from;
    // Normalize the sender id by removing any suffix (e.g., "@c.us")
    const normalizedSender = senderId.replace(/@.*$/, "");

    console.log(`Received: ${normalizedText} from ${senderName} (${normalizedSender}) in chat ${chatId}`);

    // -------------------------
    // MODE TOGGLING (Admin only)
    // -------------------------
    if (normalizedText === "!private" && adminList.includes(normalizedSender)) {
      botMode = "private";
      return await safeReply(message, "🔒 Bot mode set to PRIVATE. Only admins can interact with the bot.");
    }
    if (normalizedText === "!public" && adminList.includes(normalizedSender)) {
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
    if (pendingDifficultySelection[chatId] && normalizedText.startsWith("!") && normalizedText !== "!quiz") {
      delete pendingDifficultySelection[chatId];
    }

    // -------------------------
    // MAIN MENU
    // -------------------------
    if (normalizedText === "!menu") {
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
          `   *©2025 Vergaz_the_Don. All Rights Reserved.* ✨\n`
      );
    }

    // -------------------------
    // QUIZ FEATURES
    // -------------------------
    if (normalizedText === "!quiz") {
      pendingDifficultySelection[chatId] = true;
      return await safeReply(message, "📚 Select a difficulty: *easy*, *medium*, *hard*.");
    }

    if (pendingDifficultySelection[chatId]) {
      let difficulty = normalizedText.toLowerCase();
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
      let userAnswer = normalizeAnswer(normalizedText);
      if (userAnswer === correctAnswer) {
        leaderboard[senderName] = (leaderboard[senderName] || 0) + 1;
        fs.writeFileSync("leaderboard.json", JSON.stringify(leaderboard, null, 2));
        delete activeQuizzes[chatId];
        return await safeReply(message, "🎉 Correct! Type *!quiz* for another.");
      } else {
        return await safeReply(message, "❌ Incorrect! Try again or type *!quiz* for a new question.");
      }
    }

    // Best of 10 Quiz Feature
    if (normalizedText.startsWith("!bestof10")) {
      let args = normalizedText.split(" ");
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
      let userAnswer = normalizeAnswer(normalizedText);
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
    if (normalizedText.startsWith("!lyrics")) {
      const songName = normalizedText.slice(8).trim();
      if (!goldenBellsLyrics[songName]) {
        return await safeReply(message, "❌ Song not found.");
      }
      return await safeReply(message, `🎵 *${songName}*\n\n${goldenBellsLyrics[songName]}`);
    }

    // -------------------------
    // LEADERBOARD
    // -------------------------
    if (normalizedText === "!leaderboard") {
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
    if (normalizedText.startsWith("!addteaching")) {
      const parts = normalizedText.slice(13).split(":");
      if (parts.length < 2) {
        return await safeReply(message, "❌ Use format: *!addteaching <title>: <message>*");
      }
      const title = parts[0].trim();
      const content = parts.slice(1).join(":").trim();
      sundayTeachings[title] = content;
      fs.writeFileSync("teachings.json", JSON.stringify(sundayTeachings, null, 2));
      return await safeReply(message, `✅ Teaching *"${title}"* has been saved.`);
    }
    
    if (normalizedText === "!teachings") {
      if (Object.keys(sundayTeachings).length === 0) {
        return await safeReply(message, "❌ No teachings available yet.");
      }
      let teachingList = "📖 *Available Teachings:*\n\n" +
        Object.keys(sundayTeachings).map((t) => `- *${t}*`).join("\n");
      return await safeReply(message, teachingList);
    }
    
    if (normalizedText.startsWith("!teaching")) {
      const title = normalizedText.slice(10).trim();
      if (!sundayTeachings[title]) {
        return await safeReply(message, `❌ Teaching *"${title}"* not found.`);
      }
      return await safeReply(message, `📖 *${title}*\n\n${sundayTeachings[title]}`);
    }
    
    // -------------------------
    // TEAMS & GROUP FEATURES
    // -------------------------
    if (normalizedText.startsWith("!jointeam")) {
      const teamName = normalizedText.slice(10).trim();
      teams[teamName] = teams[teamName] || [];
      if (!teams[teamName].includes(senderName)) {
        teams[teamName].push(senderName);
        fs.writeFileSync("teams.json", JSON.stringify(teams, null, 2));
        return await safeReply(message, `✅ ${senderName} has joined *${teamName}*.`);
      } else {
        return await safeReply(message, `❌ You are already in *${teamName}*.`);
      }
    }
    
    if (normalizedText === "!teamleaderboard") {
      let teamScores = Object.entries(teams)
        .map(([team, members]) => `*${team}* - ${members.length} members`)
        .join("\n");
      return await safeReply(message, teamScores || "❌ No teams yet.");
    }
    
    if (normalizedText === "!tagall") {
      const chat = await message.getChat();
      if (!chat || !chat.participants) {
        return await safeReply(message, "❌ Unable to fetch participants.");
      }
      // Use an array of serialized IDs (strings) for mentions.
      let mentions = chat.participants.map((p) => p.id._serialized);
      return await safeReply(message, "📢 *Attention everyone!*", { mentions });
    }
    
    // -------------------------
    // BATTLE MODE
    // -------------------------
    if (normalizedText.startsWith("!battle")) {
      const parts = normalizedText.split(" ");
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
    if (normalizedText === "!resetleaderboard" && adminList.includes(normalizedSender)) {
      leaderboard = {};
      fs.writeFileSync("leaderboard.json", JSON.stringify({}, null, 2));
      return await safeReply(message, "✅ Leaderboard has been reset.");
    }
    
});

client.initialize();


