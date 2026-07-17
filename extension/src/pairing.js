// pairing.js - Manages the pairing modal overlay and code verification flow

export function initPairingUI() {
  const overlay = document.getElementById("pairing-overlay");
  const codeInput = document.getElementById("pairing-code-input");
  const submitBtn = document.getElementById("btn-submit-pairing");
  const errorMsg = document.getElementById("pairing-error-message");

  if (!overlay) return;

  // Check if we are already paired
  chrome.storage.local.get(["tiSessionId"], (res) => {
    if (res.tiSessionId) {
      overlay.classList.add("hidden");
    } else {
      overlay.classList.remove("hidden");
    }
  });

  submitBtn.addEventListener("click", async () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!code || code.length !== 6) {
      showError("Please enter a valid 6-character code");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Pairing...";
    errorMsg.textContent = "";

    try {
      chrome.runtime.sendMessage({ type: "ws.pair", payload: { code } }, (response) => {
        submitBtn.disabled = false;
        submitBtn.textContent = "Pair";

        if (response && response.ok) {
          overlay.classList.add("hidden");
          console.log("Pairing successful!");
        } else {
          showError(response?.error?.message || "Pairing failed. Please verify the code.");
        }
      });
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Pair";
      showError("Communication error with background script");
    }
  });

  function showError(msg) {
    errorMsg.textContent = msg;
  }
}
