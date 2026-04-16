import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { google } from "googleapis";
import cors from "cors";
import dotenv from "dotenv";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { fileURLToPath } from "url";

import fs from "fs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
// We'll try to initialize with default credentials or project ID from config
const firebaseConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, "firebase-applet-config.json"), "utf8")
);

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const db = getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId);

// Test Firestore connection on startup
async function testFirestore() {
  try {
    console.log("Testing Firestore connection...");
    await db.collection("settings").doc("connection_test").set({ lastTest: new Date().toISOString() });
    console.log("Firestore connection test successful");
  } catch (error: any) {
    console.error("Firestore connection test failed:", error.message);
  }
}
testFirestore();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/api/auth/google/callback`
  );

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // 1. Get Google Auth URL
  app.get("/api/auth/google/url", (req, res) => {
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/calendar.events"],
      prompt: "consent",
    });
    res.json({ url });
  });

  // 2. Google Auth Callback
  app.get("/api/auth/google/callback", async (req, res) => {
    const { code } = req.query;
    
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.APP_URL) {
      console.error("Missing environment variables for Google Auth");
      return res.status(500).send("Server configuration missing (Env vars)");
    }

    try {
      console.log("Exchanging code for tokens...");
      const { tokens } = await oauth2Client.getToken(code as string);
      console.log("Tokens received successfully");
      
      // Clean tokens to remove undefined properties
      const cleanTokens = JSON.parse(JSON.stringify(tokens));
      
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'OAUTH_AUTH_SUCCESS', 
                  tokens: ${JSON.stringify(cleanTokens)} 
                }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>구글 캘린더 연동이 완료되었습니다. 이 창은 자동으로 닫힙니다.</p>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error("Error exchanging code for tokens:", error.response?.data || error.message || error);
      res.status(500).send(`Authentication failed: ${error.message}`);
    }
  });

  // 3. Sync Event to Google Calendar
  app.post("/api/calendar/sync", async (req, res) => {
    const { summary, description, start, end, calendarId, tokens } = req.body;

    if (!tokens) {
      return res.status(401).json({ error: "Google Calendar tokens missing" });
    }

    try {
      oauth2Client.setCredentials(tokens);

      const calendar = google.calendar({ version: "v3", auth: oauth2Client });

      const event = {
        summary,
        description,
        start: {
          date: start, // YYYY-MM-DD for all-day events
        },
        end: {
          date: end, // YYYY-MM-DD (exclusive)
        },
      };

      const response = await calendar.events.insert({
        calendarId: calendarId || "primary",
        requestBody: event,
      });

      res.json({ success: true, eventId: response.data.id });
    } catch (error) {
      console.error("Error syncing to Google Calendar:", error);
      res.status(500).json({ error: "Failed to sync to Google Calendar" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
