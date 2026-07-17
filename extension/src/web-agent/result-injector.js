// result-injector.js
// Injects tool execution results back into ChatGPT conversation
// Uses Chrome's debugging protocol to insert DOM nodes or messages

class ResultInjector {
  constructor() {
    this.injectorId = 'ti-result-injector';
  }

  /**
   * Inject a final response into the active conversation
   * @param {Object} finalResponse - Result to inject
   * @returns {Promise<void>}
   */
  async injectFinalResponse(finalResponse) {
    // Find the response container in ChatGPT DOM
    const responseContainer = document.querySelector('[data-message-author-role="assistant"]');
    if (!responseContainer) return;

    // Create a formatted block with the result
    const block = document.createElement('div');
    block.className = 'ti-result-block';
    block.innerHTML = `
      <pre style="background:#f6f8fa;padding:8px;border-radius:4px;overflow:auto">
${JSON.stringify(finalResponse, null, 2)}
      </pre>
    `;

    // Insert after the response
    responseContainer.parentNode.insertBefore(block, responseContainer.nextSibling);
  }

  /**
   * Inject a tool result as a metadata tag for downstream processing
   * @param {Object} toolResult 
   */
  markToolResult(toolResult) {
    const marker = document.createElement('div');
    marker.style.display = 'none';
    marker.dataset.toolResult = JSON.stringify(toolResult);
    document.documentElement.appendChild(marker);
  }
}

// Export singleton for use by provider
export const resultInjector = new ResultInjector();