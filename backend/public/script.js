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

    // Send message
    function sendMessage() {
        const text = input.value.trim();
        if (!text) return;

        addMessage(text, "user");
        input.value = "";

        const typingMsg = addMessage("🤖 Thinking...", "bot");

        fetch(serverUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text, provider: "ollama" })
        })
        .then(async res => {
            typingMsg.remove();
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            const data = await res.json();
            const botReply = data.response || data.reply || "No response received";
            addMessage(botReply, "bot");
        })
        .catch(err => {
            typingMsg.remove();
            console.error("API Error:", err);
            addMessage("⚠️ Error: Cannot connect to backend. Check logs.", "bot");
        });
    }

    // Event listeners
    sendBtn.addEventListener("click", sendMessage);
    input.addEventListener("keypress", function(e) {
        if (e.key === "Enter") sendMessage();
    });

    // Optional: retry last message
    window.retryLastMessage = function() {
        const messages = document.querySelectorAll('.message.user');
        if (messages.length > 0) {
            input.value = messages[messages.length - 1].textContent;
            sendMessage();
        }
    };

    // Optional: test server connection
    fetch(serverUrl)
        .then(res => res.json())
        .then(data => console.log("✅ Backend connected:", data))
        .catch(err => addMessage("⚠️ Warning: Cannot connect to backend.", "bot"));
});
