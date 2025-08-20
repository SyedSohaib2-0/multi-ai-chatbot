document.getElementById("sendBtn").addEventListener("click", sendMessage);
document.getElementById("userInput").addEventListener("keypress", function(e) {
    if (e.key === "Enter") {
        sendMessage();
    }
});

function sendMessage() {
    const input = document.getElementById("userInput");
    const text = input.value.trim();
    if (text === "") return;
    
    addMessage(text, "user");
    input.value = "";
    
    // Show typing indicator
    const typingMsg = addMessage("🤖 Thinking...", "bot");
    
    // FIXED: Correct API endpoint
    fetch("http://localhost:3000/api/generate", {  // Changed from /chat to /api/generate
        method: "POST",
        headers: { 
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify({ 
            message: text,
            provider: "ollama"  // Force fast local responses
        })
    })
    .then(async res => {
        // Remove typing indicator
        typingMsg.remove();
        
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        
        const data = await res.json();
        
        // Handle both response formats
        const botReply = data.response || data.reply || "No response received";
        addMessage(botReply, "bot");
        
        // Optional: Show metadata in console
        if (data.metadata) {
            console.log(`Response from ${data.metadata.provider} in ${data.metadata.totalTime}ms`);
        }
    })
    .catch(err => {
        // Remove typing indicator on error
        typingMsg.remove();
        
        console.error("API Error:", err);
        
        // More specific error messages
        let errorMsg = "⚠️ Error: ";
        if (err.message.includes("Failed to fetch")) {
            errorMsg += "Cannot connect to server. Is the backend running on port 3000?";
        } else if (err.message.includes("404")) {
            errorMsg += "API endpoint not found. Check server configuration.";
        } else if (err.message.includes("500")) {
            errorMsg += "Server error. Check backend logs.";
        } else {
            errorMsg += "Connection failed. Please try again.";
        }
        
        addMessage(errorMsg, "bot");
    });
}

function addMessage(text, sender) {
    const msgContainer = document.getElementById("messages");
    const msg = document.createElement("div");
    msg.className = "message " + sender;
    msg.textContent = text;
    msgContainer.appendChild(msg);
    msgContainer.scrollTop = msgContainer.scrollHeight;
    
    // Return the message element for manipulation (like removing typing indicator)
    return msg;
}

// Optional: Add connection test on page load
window.addEventListener('DOMContentLoaded', function() {
    // Test server connection
    fetch("http://localhost:3000/api/health")
        .then(res => res.json())
        .then(data => {
            console.log("✅ Backend connected:", data.status);
        })
        .catch(err => {
            console.error("❌ Backend connection failed:", err);
            addMessage("⚠️ Warning: Cannot connect to backend server. Please ensure the server is running on port 3000.", "bot");
        });
});

// Optional: Add retry functionality
function retryLastMessage() {
    const messages = document.querySelectorAll('.message.user');
    if (messages.length > 0) {
        const lastUserMessage = messages[messages.length - 1].textContent;
        document.getElementById("userInput").value = lastUserMessage;
        sendMessage();
    }
}