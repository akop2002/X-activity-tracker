// background.js
// Enhanced with better error handling, data validation, and migration support.

const DEFAULT_GOALS = {
  tweets: { daily: 5 },
  replies: { daily: 30 },
  likes: { daily: 100 },
  quotes: { daily: 3 },
  media: { daily: 1, weeklyMin: 3 },
  threads: { weeklyMax: 3, weeklyMin: 1 }
};

const STORAGE_VERSION = 2;

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function initialDailyCounts() {
  return { tweets: 0, replies: 0, likes: 0, quotes: 0, media: 0 };
}

function initialWeeklyCounts() {
  return { media: 0, threads: 0 };
}

async function migrateStorageIfNeeded() {
  return new Promise(resolve => {
    chrome.storage.local.get(["version"], (res) => {
      const currentVersion = res.version || 1;
      if (currentVersion < STORAGE_VERSION) {
        // Perform migrations if needed in future versions
        chrome.storage.local.set({ version: STORAGE_VERSION }, resolve);
      } else {
        resolve();
      }
    });
  });
}

async function getState() {
  return new Promise(resolve => {
    chrome.storage.local.get(["state", "goals", "version"], async (res) => {
      await migrateStorageIfNeeded();
      const goals = res.goals || JSON.parse(JSON.stringify(DEFAULT_GOALS));
      const state = res.state || {};
      resolve({ state, goals });
    });
  });
}

async function saveState(state, goals) {
  return new Promise(resolve => {
    chrome.storage.local.set({ 
      state, 
      goals,
      version: STORAGE_VERSION,
      lastUpdated: Date.now()
    }, resolve);
  });
}

async function ensureDateTurnover() {
  const { state, goals } = await getState();
  const dKey = todayKey();
  const wKey = isoWeekKey();
  const newState = { ...state };

  // Initialize if not present
  if (!newState.daily || newState.dailyKey !== dKey) {
    newState.dailyKey = dKey;
    newState.daily = initialDailyCounts();
  }
  if (!newState.weekly || newState.weeklyKey !== wKey) {
    newState.weeklyKey = wKey;
    newState.weekly = initialWeeklyCounts();
  }
  
  // Save if state changed
  if (newState.dailyKey !== state.dailyKey || newState.weeklyKey !== state.weeklyKey) {
    await saveState(newState, goals);
  }
  
  return { state: newState, goals };
}

// Message router with enhanced error handling
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "get") {
        const current = await ensureDateTurnover();
        sendResponse(current);
        return;
      }
      
      if (msg.type === "bump") {
        const { metric, amount, scope } = msg;
        const current = await ensureDateTurnover();
        const st = current.state;
        
        if (scope === "daily") {
          st.daily[metric] = Math.max(0, (st.daily[metric] || 0) + amount);
        } else if (scope === "weekly") {
          st.weekly[metric] = Math.max(0, (st.weekly[metric] || 0) + amount);
        }
        
        await saveState(st, current.goals);
        sendResponse({ ok: true, state: st, goals: current.goals });
        return;
      }
      
      if (msg.type === "setGoals") {
        const { goals } = msg;
        // Validate goals structure
        const validatedGoals = {};
        for (const [key, value] of Object.entries(goals)) {
          if (DEFAULT_GOALS[key]) {
            validatedGoals[key] = { ...DEFAULT_GOALS[key], ...value };
          }
        }
        
        const cur = await ensureDateTurnover();
        await saveState(cur.state, validatedGoals);
        sendResponse({ ok: true, goals: validatedGoals });
        return;
      }
      
      if (msg.type === "reset") {
        const st = {
          dailyKey: todayKey(),
          daily: initialDailyCounts(),
          weeklyKey: isoWeekKey(),
          weekly: initialWeeklyCounts()
        };
        const { goals } = await getState();
        await saveState(st, goals);
        sendResponse({ ok: true, state: st, goals });
        return;
      }
      
      if (msg.type === "exportData") {
        const data = await getState();
        sendResponse({ ok: true, data });
        return;
      }
      
      if (msg.type === "importData") {
        const { data } = msg;
        if (data && data.state && data.goals) {
          await saveState(data.state, data.goals);
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: "Invalid data format" });
        }
        return;
      }
      
      sendResponse({ ok: false, error: "Unknown message type" });
    } catch (error) {
      console.error('Background script error:', error);
      sendResponse({ ok: false, error: error.message });
    }
  })();
  
  return true; // Keep channel open for async response
});

// Clear old data periodically
chrome.alarms.create("cleanup", { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "cleanup") {
    await ensureDateTurnover();
  }
});