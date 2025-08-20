const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();
const NodeCache = require('node-cache');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Enhanced CORS configuration
app.use(cors({
    origin: true, // Allow all origins for now
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    optionsSuccessStatus: 200
}));

// Handle preflight requests
app.options('*', cors());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use(express.static(path.join(__dirname)));

// Cache system
const cache = new NodeCache({ 
    stdTTL: parseInt(process.env.CACHE_TTL) || 300,
    checkperiod: 60
});

// AI Provider Configuration
const AI_PROVIDERS = {
    openrouter: {
        name: 'OpenRouter',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        key: process.env.OPENROUTER_API_KEY,
        models: {
            // Free models
            'mistral-7b': 'mistralai/mistral-7b-instruct:free',
            'mixtral-8x7b': 'mistralai/mixtral-8x7b-instruct:free',
            'llama-3.1-8b': 'meta-llama/llama-3.1-8b-instruct:free',
            'deepseek-coder': 'deepseek/deepseek-coder-6.7b-instruct:free',
            // Premium models
            'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet',
            'claude-3-opus': 'anthropic/claude-3-opus',
            'claude-3-haiku': 'anthropic/claude-3-haiku',
            'gpt-4o': 'openai/gpt-4o',
            'gpt-4o-mini': 'openai/gpt-4o-mini',
            'gemini-1.5-pro': 'google/gemini-1.5-pro'
        },
        defaultModel: 'mistralai/mistral-7b-instruct:free'
    },
    openai: {
        name: 'OpenAI',
        url: 'https://api.openai.com/v1/chat/completions',
        key: process.env.OPENAI_API_KEY,
        model: 'gpt-4o-mini'
    },
    deepseek: {
        name: 'DeepSeek',
        url: 'https://api.deepseek.com/v1/chat/completions',
        key: process.env.DEEPSEEK_API_KEY,
        model: 'deepseek-chat'
    },
    ollama: {
        name: 'Ollama',
        url: process.env.OLLAMA_URL || 'http://localhost:11434',
        models: ['llama3.2:latest', 'llama3.1:8b', 'mistral:latest']
    }
};

// Statistics
let stats = {
    totalRequests: 0,
    cacheHits: 0,
    errors: 0,
    fallbacks: 0,
    uptime: Date.now(),
    providerUsage: {
        openrouter: 0,
        openai: 0,
        deepseek: 0,
        ollama: 0
    },
    responseTimeStats: {
        total: 0,
        count: 0,
        average: 0
    }
};

// Enhanced fetch function with better error handling
async function safeFetch(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

// Smart provider selection
function selectOptimalProvider(prompt, options = {}) {
    const promptLower = prompt.toLowerCase();
    
    // If OpenRouter model specified
    if (options.openrouterModel) {
        return 'openrouter';
    }
    
    // Code-related queries
    if (/code|programming|function|debug|javascript|python|java|css|html|sql/.test(promptLower)) {
        return 'openrouter';
    }
    
    // Creative writing
    if (/write|story|poem|creative|essay|blog|fiction/.test(promptLower)) {
        return 'openrouter';
    }
    
    // Complex reasoning
    if (/analyze|reason|complex|explain|theory|philosophy|research/.test(promptLower)) {
        return 'openrouter';
    }
    
    // Quick responses
    if (prompt.length < 30) {
        return 'ollama';
    }
    
    return 'openrouter'; // Default to OpenRouter
}

// OpenRouter chat function
async function chatWithOpenRouter(prompt, options = {}) {
    if (!AI_PROVIDERS.openrouter.key) {
        throw new Error('OpenRouter API key not configured');
    }
    
    let model = options.openrouterModel || AI_PROVIDERS.openrouter.defaultModel;
    
    // Map frontend model names to actual model IDs
    if (AI_PROVIDERS.openrouter.models[model]) {
        model = AI_PROVIDERS.openrouter.models[model];
    }
    
    console.log(`🌐 OpenRouter Request: ${model}`);
    
    const requestBody = {
        model: model,
        messages: [
            { role: 'system', content: 'You are a helpful AI assistant.' },
            { role: 'user', content: prompt }
        ],
        max_tokens: options.maxTokens || 1000,
        temperature: options.temperature || 0.7
    };
    
    const response = await safeFetch(AI_PROVIDERS.openrouter.url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${AI_PROVIDERS.openrouter.key}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://multi-ai-chatbot.railway.app',
            'X-Title': 'Multi-AI Chatbot'
        },
        body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`OpenRouter Error: ${response.status}`, errorText);
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
        content: data.choices[0]?.message?.content || 'No response generated',
        model: data.model || model,
        provider: 'openrouter',
        usage: data.usage
    };
}

// Ollama chat function
async function chatWithOllama(prompt, options = {}) {
    const model = options.model || 'llama3.2:latest';
    
    console.log(`🤖 Ollama Request: ${model}`);
    
    const response = await safeFetch(`${AI_PROVIDERS.ollama.url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: model,
            prompt: prompt,
            stream: false,
            options: {
                temperature: options.temperature || 0.7,
                num_predict: options.maxTokens || 500
            }
        })
    });
    
    if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    return {
        content: data.response || 'No response generated',
        model: model,
        provider: 'ollama'
    };
}

// OpenAI chat function
async function chatWithOpenAI(prompt, options = {}) {
    if (!AI_PROVIDERS.openai.key) {
        throw new Error('OpenAI API key not configured');
    }
    
    console.log('🚀 OpenAI Request');
    
    const response = await safeFetch(AI_PROVIDERS.openai.url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${AI_PROVIDERS.openai.key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: options.model || AI_PROVIDERS.openai.model,
            messages: [
                { role: 'system', content: 'You are a helpful AI assistant.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: options.maxTokens || 1000,
            temperature: options.temperature || 0.7
        })
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenAI Error:', response.status, errorText);
        throw new Error(`OpenAI API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    return {
        content: data.choices[0]?.message?.content || 'No response generated',
        model: data.model,
        provider: 'openai',
        usage: data.usage
    };
}

// DeepSeek chat function
async function chatWithDeepSeek(prompt, options = {}) {
    if (!AI_PROVIDERS.deepseek.key) {
        throw new Error('DeepSeek API key not configured');
    }
    
    console.log('🔥 DeepSeek Request');
    
    const response = await safeFetch(AI_PROVIDERS.deepseek.url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${AI_PROVIDERS.deepseek.key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: options.model || AI_PROVIDERS.deepseek.model,
            messages: [
                { role: 'system', content: 'You are a helpful AI assistant.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: options.maxTokens || 1000,
            temperature: options.temperature || 0.7
        })
    });
    
    if (!response.ok) {
        throw new Error(`DeepSeek API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    return {
        content: data.choices[0]?.message?.content || 'No response generated',
        model: data.model,
        provider: 'deepseek',
        usage: data.usage
    };
}

// Main AI chat function with fallback
async function chatWithAI(provider, prompt, options = {}) {
    const startTime = Date.now();
    const cacheKey = `${provider}:${options.openrouterModel || 'default'}:${Buffer.from(prompt).toString('base64').slice(0, 50)}`;
    
    // Check cache
    if (cache.has(cacheKey)) {
        stats.cacheHits++;
        const cachedResult = cache.get(cacheKey);
        return {
            response: cachedResult.content,
            provider,
            cached: true,
            responseTime: Date.now() - startTime,
            model: cachedResult.model
        };
    }
    
    // Define fallback order
    const fallbackOrder = provider === 'openrouter' ? 
        ['openrouter', 'ollama'] : 
        [provider, 'openrouter', 'ollama'];
    
    let lastError = null;
    
    for (const currentProvider of fallbackOrder) {
        try {
            let result;
            
            switch (currentProvider) {
                case 'openrouter':
                    result = await chatWithOpenRouter(prompt, options);
                    break;
                case 'openai':
                    result = await chatWithOpenAI(prompt, options);
                    break;
                case 'deepseek':
                    result = await chatWithDeepSeek(prompt, options);
                    break;
                case 'ollama':
                    result = await chatWithOllama(prompt, options);
                    break;
                default:
                    throw new Error(`Unknown provider: ${currentProvider}`);
            }
            
            const responseTime = Date.now() - startTime;
            
            // Update stats
            stats.responseTimeStats.total += responseTime;
            stats.responseTimeStats.count++;
            stats.responseTimeStats.average = Math.round(stats.responseTimeStats.total / stats.responseTimeStats.count);
            stats.providerUsage[currentProvider]++;
            
            // Cache result
            if (result) {
                cache.set(cacheKey, result, 600);
            }
            
            // Log fallback usage
            if (currentProvider !== provider) {
                stats.fallbacks++;
                console.log(`🔄 Fallback: ${provider} → ${currentProvider}`);
            }
            
            return {
                response: result.content,
                provider: currentProvider,
                originalProvider: provider,
                fallbackUsed: currentProvider !== provider,
                cached: false,
                responseTime,
                model: result.model,
                usage: result.usage
            };
            
        } catch (error) {
            console.error(`${currentProvider} error:`, error.message);
            lastError = error;
            
            // Continue to next provider if not the last one
            if (currentProvider !== fallbackOrder[fallbackOrder.length - 1]) {
                continue;
            }
        }
    }
    
    stats.errors++;
    throw lastError || new Error('All providers failed');
}

// Main chat endpoint
app.post('/api/chat', async (req, res) => {
    const startTime = Date.now();
    stats.totalRequests++;
    
    try {
        const { message, provider, options = {} } = req.body;
        
        if (!message || message.trim().length === 0) {
            return res.status(400).json({
                error: 'Message is required',
                code: 'EMPTY_MESSAGE'
            });
        }
        
        console.log(`💬 Chat Request: ${provider || 'auto'} - "${message.substring(0, 50)}..."`);
        
        // Select provider
        const selectedProvider = provider || selectOptimalProvider(message, options);
        
        // Get AI response
        const aiResult = await chatWithAI(selectedProvider, message, options);
        const totalTime = Date.now() - startTime;
        
        const response = {
            reply: aiResult.response,
            metadata: {
                provider: aiResult.provider,
                originalProvider: aiResult.originalProvider || aiResult.provider,
                providerName: AI_PROVIDERS[aiResult.provider].name,
                model: aiResult.model,
                fallbackUsed: aiResult.fallbackUsed || false,
                responseTime: aiResult.responseTime,
                totalTime,
                cached: aiResult.cached,
                usage: aiResult.usage,
                timestamp: new Date().toISOString()
            }
        };
        
        console.log(`✅ Response: ${aiResult.provider}/${aiResult.model} (${totalTime}ms)${aiResult.fallbackUsed ? ' [FALLBACK]' : ''}${aiResult.cached ? ' [CACHED]' : ''}`);
        res.json(response);
        
    } catch (error) {
        console.error('❌ Chat error:', error);
        
        res.status(500).json({
            error: 'Failed to get AI response',
            message: error.message,
            code: error.message.includes('429') ? 'RATE_LIMIT' : 'AI_ERROR',
            timestamp: new Date().toISOString(),
            requestTime: Date.now() - startTime
        });
    }
});

// Fast chat endpoint
app.post('/api/chat/fast', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { message } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        // Use free OpenRouter model for fast responses
        const options = {
            maxTokens: 300,
            temperature: 0.3,
            openrouterModel: 'mistral-7b'
        };
        
        const aiResult = await chatWithAI('openrouter', message, options);
        
        res.json({
            reply: aiResult.response,
            provider: aiResult.provider,
            model: aiResult.model,
            mode: 'fast',
            responseTime: aiResult.responseTime,
            totalTime: Date.now() - startTime,
            cached: aiResult.cached
        });
        
    } catch (error) {
        console.error('Fast chat error:', error);
        res.status(500).json({
            error: 'Fast response service unavailable',
            message: error.message
        });
    }
});

// Provider status endpoint
app.get('/api/providers/status', async (req, res) => {
    const providerStatus = {};
    
    // Check OpenRouter
    try {
        if (!AI_PROVIDERS.openrouter.key) {
            providerStatus.openrouter = {
                status: 'not-configured',
                name: 'OpenRouter',
                error: 'API key not set'
            };
        } else {
            const response = await safeFetch('https://openrouter.ai/api/v1/models', {
                headers: { 'Authorization': `Bearer ${AI_PROVIDERS.openrouter.key}` }
            });
            
            if (response.ok) {
                providerStatus.openrouter = {
                    status: 'online',
                    name: 'OpenRouter',
                    models: Object.keys(AI_PROVIDERS.openrouter.models).length
                };
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        }
    } catch (error) {
        providerStatus.openrouter = {
            status: 'error',
            name: 'OpenRouter',
            error: error.message
        };
    }
    
    // Check Ollama
    try {
        const response = await safeFetch(`${AI_PROVIDERS.ollama.url}/api/tags`);
        if (response.ok) {
            const data = await response.json();
            providerStatus.ollama = {
                status: 'online',
                name: 'Ollama',
                models: data.models?.length || 0
            };
        } else {
            providerStatus.ollama = { status: 'offline', name: 'Ollama' };
        }
    } catch (error) {
        providerStatus.ollama = {
            status: 'offline',
            name: 'Ollama',
            error: 'Connection failed'
        };
    }
    
    // Other providers
    providerStatus.openai = {
        status: AI_PROVIDERS.openai.key ? 'configured' : 'not-configured',
        name: 'OpenAI'
    };
    
    providerStatus.deepseek = {
        status: AI_PROVIDERS.deepseek.key ? 'configured' : 'not-configured',
        name: 'DeepSeek'
    };
    
    res.json({
        providers: providerStatus,
        timestamp: new Date().toISOString()
    });
});

// Stats endpoint
app.get('/api/stats', (req, res) => {
    const uptime = Date.now() - stats.uptime;
    
    res.json({
        ...stats,
        uptime: {
            milliseconds: uptime,
            formatted: formatUptime(uptime)
        },
        cache: {
            keys: cache.keys().length
        },
        timestamp: new Date().toISOString()
    });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: formatUptime(Date.now() - stats.uptime),
        version: '2.0.0',
        providers: {
            configured: Object.keys(AI_PROVIDERS).filter(p => 
                AI_PROVIDERS[p].key && !AI_PROVIDERS[p].key.includes('your-')
            ).length
        }
    });
});

// Clear cache endpoint
app.post('/api/cache/clear', (req, res) => {
    const cleared = cache.keys().length;
    cache.flushAll();
    
    res.json({
        message: 'Cache cleared successfully',
        entriesCleared: cleared,
        timestamp: new Date().toISOString()
    });
});

// OpenRouter models endpoint
app.get('/api/openrouter/models', (req, res) => {
    res.json({
        success: true,
        models: AI_PROVIDERS.openrouter.models,
        defaultModel: AI_PROVIDERS.openrouter.defaultModel,
        timestamp: new Date().toISOString()
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle 404
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl,
        availableEndpoints: [
            'POST /api/chat',
            'POST /api/chat/fast',
            'GET /api/health',
            'GET /api/stats',
            'GET /api/providers/status'
        ]
    });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Global error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString()
    });
});

// Utility function
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

// Add global fetch if not available (for older Node.js versions)
if (typeof fetch === 'undefined') {
    global.fetch = require('node-fetch');
}

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('\n🚀 MULTI-AI CHATBOT SERVER v2.0');
    console.log('━'.repeat(50));
    console.log(`🌐 Server: http://localhost:${PORT}`);
    console.log(`📡 API: http://localhost:${PORT}/api/`);
    console.log(`🏥 Health: http://localhost:${PORT}/api/health`);
    console.log('━'.repeat(50));
    
    // Show configuration
    console.log('\n🔐 CONFIGURATION:');
    console.log(`   OpenRouter: ${AI_PROVIDERS.openrouter.key ? '✅ Configured' : '❌ Missing'}`);
    console.log(`   OpenAI: ${AI_PROVIDERS.openai.key ? '✅ Configured' : '⚠️ Optional'}`);
    console.log(`   DeepSeek: ${AI_PROVIDERS.deepseek.key ? '✅ Configured' : '⚠️ Optional'}`);
    console.log(`   Ollama: ⏳ Checking...`);
    
    console.log('\n🎉 Server ready!\n');
    
    // Test Ollama connection
    fetch(`${AI_PROVIDERS.ollama.url}/api/tags`, { signal: AbortSignal.timeout(3000) })
        .then(r => r.ok ? 
            console.log('✅ Ollama: Connected') : 
            console.log('⚠️ Ollama: Not running'))
        .catch(() => console.log('⚠️ Ollama: Not available'));
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is in use`);
        process.exit(1);
    } else {
        console.error('❌ Server error:', error);
        process.exit(1);
    }
});

module.exports = app;