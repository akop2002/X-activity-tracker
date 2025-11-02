// content.js
// Enhanced tracking with better detection and duplicate prevention.

function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function getState() {
  return new Promise(resolve => chrome.runtime.sendMessage({ type: "get" }, resolve));
}

function bump(metric, amount = 1, scope = "daily") {
  return new Promise(resolve => chrome.runtime.sendMessage({ type: "bump", metric, amount, scope }, resolve));
}

// Enhanced tracking with session-based IDs to prevent duplicates
const trackedActions = new Map();
const SESSION_ID = Date.now().toString(36) + Math.random().toString(36).substr(2);

function generateActionId(type, element) {
  const tweetElement = element.closest('[data-testid="tweet"], [role="article"]');
  const tweetId = tweetElement?.getAttribute('data-tweet-id') || 
                  tweetElement?.querySelector('a[href*="/status/"]')?.href ||
                  element.textContent?.slice(0, 50) ||
                  Math.random().toString(36).substr(2, 9);
  return `${SESSION_ID}-${type}-${tweetId}`;
}

function cleanupOldTrackedActions() {
  const now = Date.now();
  for (const [id, timestamp] of trackedActions.entries()) {
    if (now - timestamp > 30 * 60 * 1000) { // 30 minutes
      trackedActions.delete(id);
    }
  }
}

// Enhanced detection functions
async function trackPost(target) {
  const actionId = generateActionId('post', target);
  if (trackedActions.has(actionId)) return;
  
  trackedActions.set(actionId, Date.now());
  cleanupOldTrackedActions();

  try {
    await bump("tweets", 1, "daily");

    // Enhanced media detection
    setTimeout(async () => {
      const mediaSelectors = [
        '[data-testid="attachments"]',
        '[aria-label*="Image"]',
        '[aria-label*="Video"]',
        '[data-testid="videoPlayer"]',
        'div[aria-label="Media"]'
      ];
      
      const hasMedia = mediaSelectors.some(selector => 
        document.querySelector(selector)
      );
      
      if (hasMedia) {
        await bump("media", 1, "daily");
        await bump("media", 1, "weekly");
      }
    }, 500);

    // Enhanced thread detection
    const tweetTextareas = document.querySelectorAll([
      '[data-testid^="tweetTextarea_"]',
      '[data-testid="tweetTextarea_0"]',
      'div[data-testid="tweetTextarea_0"]'
    ].join(','));
    
    if (tweetTextareas.length > 1) {
      const threadId = generateActionId('thread', target);
      if (!trackedActions.has(threadId)) {
        trackedActions.set(threadId, Date.now());
        await bump("threads", 1, "weekly");
      }
    }
  } catch (err) {
    console.error('X Tracker: Error tracking post:', err);
  }
}

async function trackReply(target) {
  const actionId = generateActionId('reply', target);
  if (trackedActions.has(actionId)) return;
  
  trackedActions.set(actionId, Date.now());
  
  try {
    await bump("replies", 1, "daily");
  } catch (err) {
    console.error('X Tracker: Error tracking reply:', err);
  }
}

async function trackLike(target) {
  const tweet = target.closest('[data-testid="tweet"], [role="article"]');
  const actionId = generateActionId('like', tweet);
  
  const pressed = target.getAttribute("aria-pressed");
  const isLiking = pressed === "false" || pressed === null;
  const isUnliking = pressed === "true";
  
  if (isLiking && !trackedActions.has(actionId)) {
    trackedActions.set(actionId, Date.now());
    try {
      await bump("likes", 1, "daily");
    } catch (err) {
      console.error('X Tracker: Error tracking like:', err);
    }
  } else if (isUnliking && trackedActions.has(actionId)) {
    trackedActions.delete(actionId);
    try {
      await bump("likes", -1, "daily");
    } catch (err) {
      console.error('X Tracker: Error tracking unlike:', err);
    }
  }
}

async function trackQuote(target) {
  const actionId = generateActionId('quote', target);
  if (trackedActions.has(actionId)) return;
  
  trackedActions.set(actionId, Date.now());
  
  try {
    await bump("quotes", 1, "daily");
  } catch (err) {
    console.error('X Tracker: Error tracking quote:', err);
  }
}

// Main event listener
function installPostDetector() {
  document.addEventListener("click", async (e) => {
    const target = e.target.closest([
      'div[role="button"]',
      'button',
      '[data-testid]',
      '[role="button"]'
    ].join(','));
    
    if (!target) return;

    const testId = target.getAttribute("data-testid");
    
    // Enhanced button detection with multiple possible testids
    if (testId?.includes("tweetButton") || 
        testId?.includes("tweet") && target.textContent?.includes("Post") ||
        target.querySelector?.('[data-testid*="tweetButton"]')) {
      await trackPost(target);
      return;
    }

    // Enhanced reply detection
    if (testId === "reply" || 
        target.closest('[data-testid="reply"]') ||
        target.querySelector?.('[data-testid="reply"]')) {
      await trackReply(target);
      return;
    }

    // Enhanced like detection
    if (testId === "like" || testId === "unlike" ||
        target.closest('[data-testid="like"], [data-testid="unlike"]')) {
      await trackLike(target);
      return;
    }

    // Enhanced quote detection
    if (testId === "retweet" || 
        target.closest('[data-testid="retweet"]')) {
      // Wait for retweet menu to appear and detect quote selection
      setTimeout(() => {
        const menuHandler = (ev) => {
          const menuItem = ev.target.closest('[role="menuitem"], [role="button"]');
          if (menuItem && /Quote/i.test(menuItem.textContent || "")) {
            trackQuote(target);
            document.removeEventListener("click", menuHandler, true);
          }
        };
        document.addEventListener("click", menuHandler, true);
        setTimeout(() => document.removeEventListener("click", menuHandler, true), 3000);
      }, 100);
    }
  }, true);
}

// Enhanced DOM observer for dynamic content
function installObservers() {
  const observer = new MutationObserver(debounce((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          // Look for new tweet buttons or interactive elements
          const newButtons = node.querySelectorAll?.([
            '[data-testid*="tweetButton"]',
            '[data-testid="reply"]',
            '[data-testid="like"]',
            '[data-testid="retweet"]'
          ].join(','));
          
          newButtons?.forEach(btn => {
            // Ensure these are tracked if they appear dynamically
            btn.style.setProperty('--x-tracker-watched', 'true', 'important');
          });
        }
      });
    });
  }, 500));
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-testid']
  });
}

// Initialize with better checks
(function init() {
  if (window.location.hostname === 'twitter.com' || 
      window.location.hostname === 'x.com' ||
      window.location.hostname.endsWith('.twitter.com') ||
      window.location.hostname.endsWith('.x.com')) {
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        installPostDetector();
        installObservers();
      });
    } else {
      installPostDetector();
      installObservers();
    }
    
    console.log('X Activity Tracker Pro: Enhanced tracking initialized');
  }
})();