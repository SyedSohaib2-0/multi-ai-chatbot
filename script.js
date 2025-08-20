window.addEventListener('DOMContentLoaded', function() {
    const serverUrl = "https://multi-ai-chatbot-production.up.railway.app/api/generate";
    const input = document.getElementById("userInput");
    const sendBtn = document.getElementById("sendBtn");
    const messagesContainer = document.getElementById("messages");

    // Add message to chat
    function addMessage(text, sender) {
        const msg = document.createElement("div");
        msg.className = "message " + sender;
        msg.textContent = text;
        messagesContainer.appendChild(msg);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return msg;
    }

    // Send a message to the AI
    async function sendMessage() {
        const text = input.value.trim();
        if (!text) return;

        addMessage(text, "user");
        input.value = "";

        const typingMsg = addMessage("🤖 Thinking...", "bot");

        try {
            const res = await fetch(serverUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: text, provider: "ollama" })
            });

            typingMsg.remove();

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }

            const data = await res.json();
            const botReply = data.response || data.reply || "No response received";
            addMessage(botReply, "bot");

            if (data.metadata) {
                console.log(`Response from ${data.metadata.provider} in ${data.metadata.totalTime}ms`);
            }

        } catch (err) {
            typingMsg.remove();
            console.error("API Error:", err);
            let errorMsg = "⚠️ Error: ";

            if (err.message.includes("Failed to fetch")) {
                errorMsg += "Cannot connect to server. Check backend.";
            } else if (err.message.includes("404")) {
                errorMsg += "API endpoint not found.";
            } else if (err.message.includes("500")) {
                errorMsg += "Server error. Check backend logs.";
            } else {
                errorMsg += "Connection failed. Try again.";
            }

            addMessage(errorMsg, "bot");
        }
    }

    // Retry last user message
    function retryLastMessage() {
        const messages = document.querySelectorAll('.message.user');
        if (messages.length > 0) {
            input.value = messages[messages.length - 1].textContent;
            sendMessage();
        }
    }

    // Event listeners
    sendBtn.addEventListener("click", sendMessage);
    input.addEventListener("keypress", function(e) {
        if (e.key === "Enter") sendMessage();
    });

    // Optional: test server connection on page load
    (async function testConnection() {
        try {
            const res = await fetch(serverUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Hello", provider: "ollama" }) });
            const data = await res.json();
            console.log("✅ Backend connected:", data);
        } catch (err) {
            console.error("❌ Backend connection failed:", err);
            addMessage("⚠️ Warning: Cannot connect to backend server.", "bot");
        }
    })();

    // Expose retry function globally
    window.retryLastMessage = retryLastMessage;
});
