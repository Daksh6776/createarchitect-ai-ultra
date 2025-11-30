// userProfile.js — store / load reply style

import fs from "fs";
import path from "path";

const PROFILE_PATH = path.join("data", "userStyle.json");

const defaultProfile = {
  tone: "friendly",        // friendly | formal | technical | casual | serious
  detail: "medium",        // low | medium | high
  emojis: "some",          // none | some | max
  formatting: "markdown"   // plain | markdown | bullet | tutorial | markdown
};

if (!fs.existsSync("data")) {
  fs.mkdirSync("data");
}

export function saveUserProfile(style) {
  const merged = { ...defaultProfile, ...style };
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

export function loadUserProfile() {
  if (!fs.existsSync(PROFILE_PATH)) {
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(defaultProfile, null, 2));
    return defaultProfile;
  }
  try {
    return JSON.parse(fs.readFileSync(PROFILE_PATH, "utf8"));
  } catch (e) {
    console.error("Failed to read user profile:", e);
    return defaultProfile;
  }
}
