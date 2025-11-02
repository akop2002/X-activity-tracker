// popup.js
// Enhanced with tab navigation, goal setting, and data management.

const $ = (id) => document.getElementById(id);

function showNotification(message, type = 'success') {
  const notification = $('notification');
  notification.textContent = message;
  notification.className = `notification ${type} show`;
  setTimeout(() => {
    notification.classList.remove('show');
  }, 3000);
}

function calculateDailyCompletion(state, goals) {
  const metrics = [
    { current: state.daily.tweets || 0, goal: goals.tweets.daily },
    { current: state.daily.replies || 0, goal: goals.replies.daily },
    { current: state.daily.likes || 0, goal: goals.likes.daily },
    { current: state.daily.quotes || 0, goal: goals.quotes.daily },
    { current: state.daily.media || 0, goal: goals.media.daily }
  ];
  
  const totalProgress = metrics.reduce((sum, m) => sum + Math.min(m.current / m.goal, 1), 0);
  return Math.round((totalProgress / metrics.length) * 100);
}

function calculateWeeklyCompletion(state, goals) {
  const mediaProgress = Math.min((state.weekly.media || 0) / goals.media.weeklyMin, 1);
  const threadsProgress = Math.min((state.weekly.threads || 0) / goals.threads.weeklyMax, 1);
  return Math.round(((mediaProgress + threadsProgress) / 2) * 100);
}

function getProgressColor(percentage) {
  if (percentage >= 100) return '#4CAF50';
  if (percentage >= 75) return '#8BC34A';
  if (percentage >= 50) return '#FFC107';
  if (percentage >= 25) return '#FF9800';
  return '#F44336';
}

function render(state, goals) {
  const d = state.daily || {};
  const w = state.weekly || {};
  
  // Update completion percentages
  const dailyComp = calculateDailyCompletion(state, goals);
  const weeklyComp = calculateWeeklyCompletion(state, goals);
  $("dailyCompletion").textContent = `${dailyComp}%`;
  $("weeklyCompletion").textContent = `${weeklyComp}%`;
  $("dailyCompletion").style.color = getProgressColor(dailyComp);
  $("weeklyCompletion").style.color = getProgressColor(weeklyComp);
  
  // Daily metrics
  const dailyMetrics = [
    { id: 'tweets', value: d.tweets || 0, goal: goals.tweets.daily },
    { id: 'replies', value: d.replies || 0, goal: goals.replies.daily },
    { id: 'likes', value: d.likes || 0, goal: goals.likes.daily },
    { id: 'quotes', value: d.quotes || 0, goal: goals.quotes.daily },
    { id: 'media', value: d.media || 0, goal: goals.media.daily }
  ];
  
  dailyMetrics.forEach(metric => {
    $(`${metric.id}Val`).textContent = metric.value;
    $(`${metric.id}Goal`).textContent = metric.goal;
    $(`${metric.id}Bar`).max = metric.goal;
    $(`${metric.id}Bar`).value = metric.value;
    
    // Update progress bar color based on completion
    const percentage = (metric.value / metric.goal) * 100;
    $(`${metric.id}Bar`).style.background = `linear-gradient(90deg, ${getProgressColor(percentage)} 0%, ${getProgressColor(percentage)} ${percentage}%, #e0e0e0 ${percentage}%)`;
  });

  // Weekly metrics
  $("wMediaVal").textContent = w.media || 0;
  $("wMediaMin").textContent = goals.media.weeklyMin;
  $("wMediaBar").max = goals.media.weeklyMin;
  $("wMediaBar").value = Math.min(w.media || 0, goals.media.weeklyMin);

  $("wThreadsVal").textContent = w.threads || 0;
  $("wThreadsMax").textContent = goals.threads.weeklyMax;
  $("wThreadsBar").max = goals.threads.weeklyMax;
  $("wThreadsBar").value = Math.min(w.threads || 0, goals.threads.weeklyMax);
}

function renderGoals(goals) {
  $("goalTweets").value = goals.tweets.daily;
  $("goalReplies").value = goals.replies.daily;
  $("goalLikes").value = goals.likes.daily;
  $("goalQuotes").value = goals.quotes.daily;
  $("goalMediaDaily").value = goals.media.daily;
  $("goalMediaWeekly").value = goals.media.weeklyMin;
  $("goalThreads").value = goals.threads.weeklyMax;
}

function getState() {
  return new Promise(resolve => chrome.runtime.sendMessage({ type: "get" }, resolve));
}

function bump(metric, amount = 1, scope = "daily") {
  return new Promise(resolve => chrome.runtime.sendMessage({ type: "bump", metric, amount, scope }, resolve));
}

function setGoals(goals) {
  return new Promise(resolve => chrome.runtime.sendMessage({ type: "setGoals", goals }, resolve));
}

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active class from all tabs and contents
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      // Add active class to clicked tab and corresponding content
      tab.classList.add('active');
      $(`${tab.dataset.tab}-tab`).classList.add('active');
    });
  });
}

async function init() {
  try {
    const res = await getState();
    if (!res || !res.state || !res.goals) {
      console.error('Failed to load state');
      showNotification('Error loading data', 'error');
      return;
    }
    
    const { state, goals } = res;
    render(state, goals);
    renderGoals(goals);
    setupTabs();

    // Handle + buttons (FIXED to check data-scope attribute)
    document.querySelectorAll('button[data-plus]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const metric = btn.getAttribute('data-plus');
        const scope = btn.getAttribute('data-scope') || 'daily'; // Check for scope attribute
        const isMedia = metric === "media";
        
        try {
          let updatedState;
          if (isMedia && scope === 'daily') {
            // Media affects both daily and weekly
            const r1 = await bump(metric, 1, "daily");
            const r2 = await bump(metric, 1, "weekly");
            updatedState = r2;
          } else {
            // Regular bump with the specified scope
            const r = await bump(metric, 1, scope);
            updatedState = r;
          }
          
          if (updatedState.ok) {
            render(updatedState.state, updatedState.goals);
            showNotification(`${metric} count updated`);
          }
        } catch (err) {
          console.error('Error bumping metric:', err);
          showNotification('Error updating count', 'error');
        }
      });
    });

    // Handle - buttons (FIXED to check data-scope attribute)
    document.querySelectorAll('button[data-minus]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const metric = btn.getAttribute('data-minus');
        const scope = btn.getAttribute('data-scope') || 'daily'; // Check for scope attribute
        const isMedia = metric === "media";
        
        try {
          let updatedState;
          if (isMedia && scope === 'daily') {
            // Media affects both daily and weekly
            const r1 = await bump(metric, -1, "daily");
            const r2 = await bump(metric, -1, "weekly");
            updatedState = r2;
          } else {
            // Regular bump with the specified scope
            const r = await bump(metric, -1, scope);
            updatedState = r;
          }
          
          if (updatedState.ok) {
            render(updatedState.state, updatedState.goals);
            showNotification(`${metric} count updated`);
          }
        } catch (err) {
          console.error('Error decrementing metric:', err);
          showNotification('Error updating count', 'error');
        }
      });
    });

    // Reset button
    $("reset").addEventListener("click", async () => {
      if (confirm("Reset all today's counts to zero?")) {
        try {
          const r = await new Promise(resolve => 
            chrome.runtime.sendMessage({ type: "reset" }, resolve)
          );
          render(r.state, r.goals);
          showNotification("Today's counts reset successfully");
        } catch (err) {
          console.error('Error resetting:', err);
          showNotification('Error resetting counts', 'error');
        }
      }
    });

    // Save goals button
    $("saveGoals").addEventListener("click", async () => {
      const goals = {
        tweets: { daily: parseInt($("goalTweets").value) },
        replies: { daily: parseInt($("goalReplies").value) },
        likes: { daily: parseInt($("goalLikes").value) },
        quotes: { daily: parseInt($("goalQuotes").value) },
        media: { 
          daily: parseInt($("goalMediaDaily").value),
          weeklyMin: parseInt($("goalMediaWeekly").value)
        },
        threads: { 
          weeklyMax: parseInt($("goalThreads").value),
          weeklyMin: 1 // Keep minimum for weekly completion calculation
        }
      };
      
      try {
        const result = await setGoals(goals);
        if (result.ok) {
          // Update the display with new goals
          const currentState = await getState();
          render(currentState.state, result.goals || goals);
          showNotification("Goals updated successfully");
        }
      } catch (err) {
        console.error('Error saving goals:', err);
        showNotification('Error saving goals', 'error');
      }
    });

    // Reset goals button
    $("resetGoals").addEventListener("click", async () => {
      if (confirm("Reset all goals to default values?")) {
        try {
          const result = await setGoals(JSON.parse(JSON.stringify({
            tweets: { daily: 5 },
            replies: { daily: 30 },
            likes: { daily: 100 },
            quotes: { daily: 3 },
            media: { daily: 1, weeklyMin: 3 },
            threads: { weeklyMax: 3, weeklyMin: 1 }
          })));
          
          if (result.ok) {
            renderGoals(result.goals);
            const currentState = await getState();
            render(currentState.state, result.goals);
            showNotification("Goals reset to defaults");
          }
        } catch (err) {
          console.error('Error resetting goals:', err);
          showNotification('Error resetting goals', 'error');
        }
      }
    });

    // Export data button
    $("exportData").addEventListener("click", async () => {
      try {
        const result = await new Promise(resolve => 
          chrome.runtime.sendMessage({ type: "exportData" }, resolve)
        );
        
        if (result.ok) {
          const dataStr = JSON.stringify(result.data, null, 2);
          const dataBlob = new Blob([dataStr], { type: 'application/json' });
          
          const url = URL.createObjectURL(dataBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `x-tracker-data-${new Date().toISOString().split('T')[0]}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          
          showNotification("Data exported successfully");
        }
      } catch (err) {
        console.error('Error exporting data:', err);
        showNotification('Error exporting data', 'error');
      }
    });

    // Import data button
    $("importData").addEventListener("click", () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      
      input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          
          if (confirm("This will replace all your current data. Continue?")) {
            const result = await new Promise(resolve =>
              chrome.runtime.sendMessage({ type: "importData", data }, resolve)
            );
            
            if (result.ok) {
              const current = await getState();
              render(current.state, current.goals);
              renderGoals(current.goals);
              showNotification("Data imported successfully");
            } else {
              showNotification(result.error || 'Error importing data', 'error');
            }
          }
        } catch (err) {
          console.error('Error importing data:', err);
          showNotification('Invalid data file', 'error');
        }
      });
      
      input.click();
    });

  } catch (err) {
    console.error('Initialization error:', err);
    showNotification('Error initializing extension', 'error');
  }
}

// Initialize when popup opens
document.addEventListener('DOMContentLoaded', init);