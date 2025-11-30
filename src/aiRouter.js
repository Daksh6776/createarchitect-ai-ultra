// aiRouter.js — main AI engine

import express from "express";
import OpenAI from "openai";

import {
  CREATE_MODE_PROMPT,
  PRO_MODE_PROMPT,
  GENERAL_MODE_PROMPT,
  AUTO_ROUTER_PROMPT
} from "./prompts.js";

import { loadUserProfile, saveUserProfile } from "./userProfile.js";
import {
  appendConversation,
  saveSchematic,
  loadProject
} from "./memory.js";
import { saveBlueprintFile } from "./schematicGenerator.js";
import { estimateStress } from "./tools/createSim.js";

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const CHAT_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const BLUEPRINT_MODEL = process.env.OPENAI_MODEL_BLUEPRINT || "gpt-4.1-mini";

function styleInstruction(profile) {
  return `
User style settings:
- tone: ${profile.tone}
- detail: ${profile.detail}
- emojis: ${profile.emojis}
- formatting: ${profile.formatting}

Respect these settings while answering.
If detail=low, be short. If high, be very detailed.
If emojis=none, do not use emojis. If some, use a few. If max, use more but keep it readable.
If formatting=markdown, use headings and lists when useful.
`.trim();
}

function basePromptForMode(mode) {
  if (mode === "create") return CREATE_MODE_PROMPT;
  if (mode === "pro") return PRO_MODE_PROMPT;
  return GENERAL_MODE_PROMPT;
}

async function autoMode(message) {
  try {
    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: AUTO_ROUTER_PROMPT },
        { role: "user", content: message }
      ]
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    if (parsed.mode === "create" || parsed.mode === "pro" || parsed.mode === "general") {
      return parsed.mode;
    }
  } catch (err) {
    console.warn("Auto router failed; falling back:", err?.message || err);
  }

  const lower = message.toLowerCase();
  if (lower.includes("create ") || lower.includes("factory") || lower.includes("kinetic"))
    return "create";
  if (lower.includes("forge") || lower.includes("fabric") || lower.includes("gradle"))
    return "pro";
  return "general";
}

// POST /api/ai/chat
router.post("/chat", async (req, res) => {
  try {
    const { message, mode = "auto", projectName } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ ok: false, error: "Missing 'message' string" });
    }

    const profile = loadUserProfile();
    const chosenMode = mode === "auto" ? await autoMode(message) : mode;
    const modePrompt = basePromptForMode(chosenMode);
    const styleText = styleInstruction(profile);

    let historyText = "";
    if (projectName) {
      const project = loadProject(projectName);
      if (project?.conversation?.length) {
        const last = project.conversation.slice(-4);
        historyText =
          "Recent project messages:\n" +
          last
            .map((m) => `[${m.role}] ${m.content.slice(0, 200)}`)
            .join("\n");
      }
    }

    const systemContent = [modePrompt, styleText, historyText].filter(Boolean).join("\n\n");

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0.4,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: message }
      ]
    });

    const reply = completion.choices[0]?.message?.content ?? "(no reply)";

    if (projectName) {
      appendConversation(projectName, "user", message);
      appendConversation(projectName, "assistant", reply);
    }

    res.json({ ok: true, mode: chosenMode, reply });
  } catch (err) {
    console.error("AI chat error:", err);
    res.status(500).json({ ok: false, error: "AI error", details: String(err) });
  }
});

// GET /api/ai/style
router.get("/style", (req, res) => {
  try {
    const profile = loadUserProfile();
    res.json({ ok: true, profile });
  } catch (err) {
    console.error("Load style error:", err);
    res.status(500).json({ ok: false, error: "Failed to load style" });
  }
});

// POST /api/ai/style
router.post("/style", (req, res) => {
  try {
    const { tone, detail, emojis, formatting } = req.body || {};
    const updated = saveUserProfile({ tone, detail, emojis, formatting });
    res.json({ ok: true, profile: updated });
  } catch (err) {
    console.error("Save style error:", err);
    res.status(500).json({ ok: false, error: "Failed to save style" });
  }
});

// POST /api/ai/schematic
router.post("/schematic", async (req, res) => {
  try {
    const { instructions, projectName } = req.body || {};
    if (!instructions || typeof instructions !== "string") {
      return res.status(400).json({ ok: false, error: "Missing 'instructions' string" });
    }

    const prompt = `
User wants a Create/Minecraft contraption. Convert into STRICT JSON:

{
  "name": "short_name",
  "description": "what it does",
  "materials": ["key blocks/items"],
  "size": "WxHxL in blocks",
  "steps": [
    "Step 1 ...",
    "Step 2 ..."
  ],
  "stress": {
    "machines": 4,
    "baseStress": 256
  }
}

No markdown, ONLY JSON.

User instructions: ${instructions}
`.trim();

    const completion = await openai.chat.completions.create({
      model: BLUEPRINT_MODEL,
      temperature: 0.1,
      messages: [
        { role: "system", content: CREATE_MODE_PROMPT },
        { role: "user", content: prompt }
      ]
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";

    let blueprint;
    try {
      blueprint = JSON.parse(raw);
    } catch (err) {
      blueprint = { parseError: String(err), raw };
    }

    if (blueprint?.stress?.machines) {
      blueprint.stressEstimate = estimateStress(
        blueprint.stress.machines,
        blueprint.stress.baseStress || 256
      );
    }

    if (projectName) {
      saveSchematic(projectName, blueprint);
      saveBlueprintFile(projectName, blueprint);
    }

    res.json({ ok: true, schematic: blueprint });
  } catch (err) {
    console.error("Schematic error:", err);
    res.status(500).json({ ok: false, error: "Schematic AI error", details: String(err) });
  }
});

export default router;
