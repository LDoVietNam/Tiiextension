// chatgpt-result-injector.js
// Injects tool execution results back into ChatGPT conversation
// Works within ChatGPT's DOM to append result blocks or markers

class ChatGPTResultInjector {
  constructor() {
    this.injectorId = 'ti-result-injector';
  }

  injectFinalResponse(finalResponse) {
    // Insert a visible block after the latest assistant message
    const target = document.querySelector('[data-testid="conversation"]');
    if (!target) return;

    const block = document.createElement('div');
    block.className = 'ti-result-block';
    block.style.marginTop = '8px';
    block.style.padding = '8px';
    block.style.backgroundColor = '#f1f3f5';
    block.style.borderRadius = '4px';
    block.innerHTML = `
      <strong>Execution Result:</strong>
      <pre style="background:#fff;padding:4px;border:1px solid #ddd;overflow:auto">${JSON.stringify(
        finalResponse,
        null,
        2
      )}</pre>
    `;
    target.appendChild(block);
  }

  // Called by content script when a tool result is ready
  markToolExecution(result) {
    const marker = document.createElement('div');
    marker.style.display = 'none';
    marker.dataset.tiResult = JSON.stringify(result);
    document.head.appendChild(marker);
  }
}

// Export for external use
export { ChatGPTResultInjector };