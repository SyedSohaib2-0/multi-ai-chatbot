const axios = require('axios');

async function chatWithOllama(model, prompt) {
    try {
        const response = await axios.post('http://localhost:11434/api/generate', {
            model: model,
            prompt: prompt,
            stream: false
        });

        return response.data.response;
    } catch (error) {
        console.error("Error talking to Ollama:", error.message);
        return "⚠️ Unable to connect to Ollama.";
    }
}

module.exports = { chatWithOllama };
