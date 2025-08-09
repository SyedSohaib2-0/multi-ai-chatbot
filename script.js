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

    // Send to backend
    fetch("http://localhost:3000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text })
    })
    .then(res => res.json())
    .then(data => {
        addMessage(data.reply, "bot");
    })
    .catch(err => {
        console.error(err);
        addMessage("⚠️ Error talking to Ollama.", "bot");
    });
}

function addMessage(text, sender) {
    const msgContainer = document.getElementById("messages");
    const msg = document.createElement("div");
    msg.className = "message " + sender;
    msg.textContent = text;
    msgContainer.appendChild(msg);
    msgContainer.scrollTop = msgContainer.scrollHeight;
}
