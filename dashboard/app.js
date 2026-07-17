// Tiiextension Agent Dashboard - Main Application Logic
// Updated to support web LLM plugin management

const BASE_URL = 'http://127.0.0.1:1840';
let apiKey = localStorage.getItem('apiKey') || 'tiie-dashboard-key-2026';
let selectedModel = localStorage.getItem('selectedModel') || '';
let agentRunId = null;
let plugins = []; // Available plugins
let activePlugins = new Set(); // Currently active plugins

// DOM Elements
const messagesEl = document.getElementById('messages');
const promptInput = document.getElementById('promptInput');
const sendBtn = document.getElementById('sendBtn');
const statusEl = document.getElementById('status');
const apiKeyInput = document.getElementById('apiKey');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const modelSelect = document.getElementById('modelSelect');
const workspaceEl = document.getElementById('workspace');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
// Plugin management elements
const pluginsTab = document.getElementById('pluginsTab');
const pluginsContainer = document.getElementById('pluginsContainer');
const refreshPluginsBtn = document.getElementById('refreshPluginsBtn');

// Utility: Unique ID generator
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// API call helper
async function callAPI(endpoint, options = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      ...options.headers
    }
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

// Tool call helper (for filesystem tools)
async function tool(name, args) {
  return callAPI('/internal/tools/call', {
    method: 'POST',
    body: JSON.stringify({ tool: name, arguments: args, idempotencyKey: `ui_${uid()}` })
  });
}

// Add message to UI
function addMessage(text, isUser = false, isPending = false) {
  const msg = document.createElement('div');
  msg.className = `message ${isUser ? 'user' : 'agent'}${isPending ? ' pending' : ''}`;
  msg.textContent = text;
  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return msg;
}

// Load workspace tree
async function loadWorkspace() {
  try {
    const roots = await tool('get_allowed_roots', {});
    if (!roots.ok || !roots.body?.result?.roots) {
      workspaceEl.innerHTML = '<div class="entry">Lỗi tải workspace</div>';
      return;
    }

    const root = roots.body.result.roots[0]; // First allowed root
    const list = await tool('list_directory', { path: root });
    
    if (!list.ok || !list.body?.result?.entries) {
      workspaceEl.innerHTML = '<div class="entry">Lỗi tải thư mục</div>';
      return;
    }

    workspaceEl.innerHTML = list.body.result.entries
      .slice(0, 50)
      .map(e => `<div class="entry ${e.type}" data-path="${root}/${e.path}">${e.path}</div>`)
      .join('');
  } catch (err) {
    workspaceEl.innerHTML = `<div class="entry">Lỗi: ${err.message}</div>`;
  }
}

// Load available models
async function loadModels() {
  try {
    const res = await callAPI('/v1/models');
    if (res.ok && res.body?.result?.models) {
      modelSelect.innerHTML = res.body.result.models
        .map(m => `<option value="${m.id}">${m.name || m.id}</option>`)
        .join('');
    }
  } catch (err) {
    console.error('Could not load models:', err);
  }
}

// Load available plugins
async function loadPlugins() {
  try {
    // For now, we'll get plugins from a predefined list
    // In a full implementation, this would come from the backend or extension
    plugins = [
      { id: 'chatgpt-web', name: 'ChatGPT Web', description: 'Access ChatGPT via web interface', enabled: false },
      { id: 'claude-web', name: 'Claude Web', description: 'Access Claude via web interface', enabled: false },
      { id: 'gemini-web', name: 'Gemini Web', description: 'Access Gemini via web interface', enabled: false }
    ];
    
    renderPlugins();
  } catch (err) {
    console.error('Could not load plugins:', err);
    pluginsContainer.innerHTML = '<div class="error">Không thể tải danh sách plugin</div>';
  }
}

// Render plugins UI
function renderPlugins() {
  if (!pluginsContainer) return;
  
  if (plugins.length === 0) {
    pluginsContainer.innerHTML = '<div class="empty">Chưa có plugin nào được tìm thấy</div>';
    return;
  }
  
  pluginsContainer.innerHTML = plugins.map(plugin => `
    <div class="plugin-card">
      <div class="plugin-header">
        <h3>${plugin.name}</h3>
        <div class="plugin-toggle">
          <label class="switch">
            <input type="checkbox" ${plugin.enabled ? 'checked' : ''} data-plugin-id="${plugin.id}">
            <span class="slider"></span>
          </label>
          <span>${plugin.enabled ? 'Bật' : 'Tắt'}</span>
        </div>
      </div>
      <p class="plugin-description">${plugin.description}</p>
      <div class="plugin-config">
        <button class="config-btn" data-plugin-id="${plugin.id}">Cấu hình</button>
      </div>
    </div>
  `).join('');
  
  // Add event listeners to toggle buttons
  document.querySelectorAll('.plugin-toggle input').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const pluginId = e.target.dataset.pluginId;
      togglePlugin(pluginId, e.target.checked);
    });
  });
  
  // Add event listeners to config buttons
  document.querySelectorAll('.config-btn').forEach(button => {
    button.addEventListener('click', (e) => {
      const pluginId = e.target.dataset.pluginId;
      configurePlugin(pluginId);
    });
  });
}

// Toggle plugin state
async function togglePlugin(pluginId, enabled) {
  try {
    // Update local state
    const plugin = plugins.find(p => p.id === pluginId);
    if (plugin) {
      plugin.enabled = enabled;
      
      if (enabled) {
        activePlugins.add(pluginId);
        // Initialize plugin
        await initializePlugin(pluginId);
      } else {
        activePlugins.delete(pluginId);
        // Dispose plugin
        await disposePlugin(pluginId);
      }
      
      // Update UI
      renderPlugins();
      updateStatus(`${plugin.name} ${enabled ? 'đã bật' : 'đã tắt'}`);
    }
  } catch (err) {
    console.error(`Failed to ${enabled ? 'enable' : 'disable'} plugin ${pluginId}:`, err);
    updateStatus(`Lỗi: ${err.message}`);
  }
}

// Initialize a plugin
async function initializePlugin(pluginId) {
  try {
    // In a real implementation, this would load and initialize the plugin
    // For now, we'll simulate it
    console.log(`Initializing plugin: ${pluginId}`);
    
    // For demonstration, we'll just mark it as initialized
    // Actual implementation would involve loading the plugin module and calling initialize()
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate async operation
    
    updateStatus(`Plugin ${pluginId} đã khởi tạo`);
  } catch (err) {
    console.error(`Failed to initialize plugin ${pluginId}:`, err);
    throw err;
  }
}

// Dispose a plugin
async function disposePlugin(pluginId) {
  try {
    // In a real implementation, this would dispose the plugin
    console.log(`Disposing plugin: ${pluginId}`);
    
    // For demonstration, we'll just mark it as disposed
    await new Promise(resolve => setTimeout(resolve, 50)); // Simulate async operation
    
    updateStatus(`Plugin ${pluginId} đã tắt`);
  } catch (err) {
    console.error(`Failed to dispose plugin ${pluginId}:`, err);
    throw err;
  }
}

// Configure a plugin
async function configurePlugin(pluginId) {
  // In a real implementation, this would open a configuration modal
  // For now, we'll just show an alert
  alert(`Cấu hình plugin ${pluginId} sẽ được triển khai trong phiên bản tiếp theo`);
}

// Poll agent run status
async function pollAgentRun(runId) {
  const msg = addMessage('Đang chờ phản hồi...', false, true);
  const interval = setInterval(async () => {
    const res = await callAPI(`/v1/agent/runs/${runId}`);
    if (res.ok && res.body?.status) {
      if (res.body.status === 'completed') {
        msg.remove();
        addMessage(res.body.result || res.body.output || 'Hoàn thành', false);
        clearInterval(interval);
        statusEl.textContent = 'Sẵn sàng';
      } else if (res.body.status === 'failed') {
        msg.remove();
        addMessage('Lỗi: ' + (res.body.error || 'Unknown'), false);
        clearInterval(interval);
        statusEl.textContent = 'Lỗi';
      } else {
        statusEl.textContent = `${res.body.status}...`;
      }
    }
  }, 1000);
}

// Send prompt to agent
async function sendToAgent() {
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  
  addMessage(prompt, true);
  promptInput.value = '';
  sendBtn.disabled = true;
  statusEl.textContent = 'Đang xử lý...';
  
  try {
    // Start agent run
    const res = await callAPI('/v1/agent/runs', {
      method: 'POST',
      body: JSON.stringify({
        prompt: prompt,
        allowed_tools: ['list_directory', 'read_file', 'write_file', 'search_files']
      })
    });
    
    if (res.ok && res.body?.id) {
      await pollAgentRun(res.body.id);
    } else {
      addMessage('Lỗi: Không thể bắt đầu agent run', false);
      statusEl.textContent = 'Lỗi';
    }
  } catch (err) {
    addMessage('Lỗi: ' + err.message, false);
    statusEl.textContent = 'Lỗi';
  } finally {
    sendBtn.disabled = false;
  }
}

// Update status bar
function updateStatus(message) {
  if (statusEl) {
    statusEl.textContent = message;
    // Clear after 3 seconds
    setTimeout(() => {
      if (statusEl.textContent === message) {
        statusEl.textContent = 'Sẵn sàng';
      }
    }, 3000);
  }
}

// Event Listeners
sendBtn.addEventListener('click', sendToAgent);
promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendToAgent();
  }
});

saveKeyBtn.addEventListener('click', () => {
  apiKey = apiKeyInput.value.trim();
  localStorage.setItem('apiKey', apiKey);
  apiKeyInput.value = '';
  updateStatus('API key đã lưu');
});

settingsBtn.addEventListener('click', () => {
  settingsModal.classList.add('active');
});

settingsModal.querySelector('.close').addEventListener('click', () => {
  settingsModal.classList.remove('active');
});

// Plugin management event listeners
if (refreshPluginsBtn) {
  refreshPluginsBtn.addEventListener('click', loadPlugins);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadWorkspace();
  loadModels();
  loadPlugins(); // Load plugins on startup
  statusEl.textContent = 'Sẵn sàng';
});