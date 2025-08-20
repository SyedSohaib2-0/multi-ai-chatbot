import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import NodeCache from 'node-cache';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
app.use(cors());


// Load environment variables
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Cache system
const cache = new NodeCache({ stdTTL: parseInt(process.env.CACHE_TTL) || 300 }); // Default 5 minutes

// ✅ UPDATED AI Provider Configuration with CORRECT OpenRouter Models
const AI_PROVIDERS = {
    openai: {
        name: 'OpenAI GPT-4',
        url: 'https://api.openai.com/v1/chat/completions',
        key: process.env.OPENAI_API_KEY || 'your-openai-key-here',
        model: 'gpt-4o-mini'
    },
    deepseek: {
        name: 'DeepSeek',
        url: 'https://api.deepseek.com/v1/chat/completions',
        key: process.env.DEEPSEEK_API_KEY || 'your-deepseek-key-here',
        model: 'deepseek-chat'
    },
    openrouter: {
        name: 'OpenRouter',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        key: process.env.OPENROUTER_API_KEY || 'your-openrouter-key-here',
        
        // ✅ CORRECTED MODEL IDENTIFIERS
        models: {
            // 🆓 FREE MODELS (Correct identifiers)
            'mistral-7b-free': 'mistralai/mistral-7b-instruct:free',
            'mixtral-8x7b-free': 'mistralai/mixtral-8x7b-instruct:free',
            'llama-3.1-8b-free': 'meta-llama/llama-3.1-8b-instruct:free',
            'qwen-2.5-7b-free': 'qwen/qwen-2.5-7b-instruct:free',
            'gemma-2-9b-free': 'google/gemma-2-9b-it:free',
            'hermes-mixtral-free': 'nousresearch/nous-hermes-2-mixtral-8x7b-dpo:free',
            'deepseek-coder-free': 'deepseek/deepseek-coder-6.7b-instruct:free',
            'zephyr-7b-free': 'huggingfaceh4/zephyr-7b-beta:free',
            
            // 💎 PREMIUM MODELS (Corrected)
            'gpt-4o': 'openai/gpt-4o',
            'gpt-4o-mini': 'openai/gpt-4o-mini',
            'gpt-4-turbo': 'openai/gpt-4-turbo',
            'gpt-3.5-turbo': 'openai/gpt-3.5-turbo',
            'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet',
            'claude-3.5-haiku': 'anthropic/claude-3.5-haiku',
            'claude-3-opus': 'anthropic/claude-3-opus',
            'claude-3-sonnet': 'anthropic/claude-3-sonnet',
            'claude-3-haiku': 'anthropic/claude-3-haiku',
            'gemini-1.5-pro': 'google/gemini-1.5-pro',
            'gemini-1.5-flash': 'google/gemini-1.5-flash',
            'gemini-pro': 'google/gemini-pro',
            'llama-3.1-405b': 'meta-llama/llama-3.1-405b-instruct',
            'llama-3.1-70b': 'meta-llama/llama-3.1-70b-instruct',
            'llama-3.1-8b': 'meta-llama/llama-3.1-8b-instruct',
            'mistral-large': 'mistralai/mistral-large',
            'mistral-medium': 'mistralai/mistral-medium',
            'cohere-command-r': 'cohere/command-r-plus',
            'perplexity-llama': 'perplexity/llama-3.1-sonar-large-128k-online'
        },
        
        // ✅ SET TO WORKING FREE MODEL
        defaultModel: 'mistralai/mistral-7b-instruct:free',
        
        // Model categories for smart selection
        categories: {
            free: [
                'mistralai/mistral-7b-instruct:free',
                'mistralai/mixtral-8x7b-instruct:free',
                'meta-llama/llama-3.1-8b-instruct:free',
                'qwen/qwen-2.5-7b-instruct:free'
            ],
            coding: [
                'deepseek/deepseek-coder-6.7b-instruct:free',
                'anthropic/claude-3.5-sonnet',
                'openai/gpt-4o'
            ],
            creative: [
                'anthropic/claude-3-opus',
                'anthropic/claude-3.5-sonnet',
                'nousresearch/nous-hermes-2-mixtral-8x7b-dpo:free'
            ],
            reasoning: [
                'anthropic/claude-3.5-sonnet',
                'openai/gpt-4o',
                'google/gemini-1.5-pro'
            ],
            fast: [
                'openai/gpt-4o-mini',
                'anthropic/claude-3-haiku',
                'mistralai/mistral-7b-instruct:free'
            ]
        }
    },
    ollama: {
        name: 'Ollama Local',
        url: process.env.OLLAMA_URL || 'http://localhost:11434',
        models: ['llama3.2:latest', 'llama3.1:8b', 'mistral:latest', 'gemma2:2b', 'codellama:7b']
    }
};

// Enhanced statistics tracking
let stats = {
    totalRequests: 0,
    cacheHits: 0,
    errors: 0,
    fallbacks: 0,
    rateLimits: 0,
    uptime: Date.now(),
    providerUsage: {
        openai: 0,
        deepseek: 0,
        openrouter: 0,
        ollama: 0
    },
    modelUsage: {},
    responseTimeStats: {
        total: 0,
        count: 0,
        average: 0
    }
};

// ✅ Enhanced smart AI provider selection with OpenRouter prioritization
function selectOptimalProvider(prompt, options = {}) {
    const promptLower = prompt.toLowerCase();
    
    // If specific OpenRouter model requested
    if (options.openrouterModel) {
        return 'openrouter';
    }
    
    // If user specifies free models preference
    if (options.preferFree) {
        return 'openrouter'; // Use free OpenRouter models
    }
    
    // Complex reasoning tasks -> Premium OpenRouter models
    if (/analyze|reason|complex|explain|theory|philosophy|ethics|research|academic/.test(promptLower)) {
        return 'openrouter';
    }
    
    // Programming/code tasks -> OpenRouter (free DeepSeek coder or premium Claude)
    if (/code|programming|function|debug|javascript|python|java|css|html|sql|database|algorithm/.test(promptLower)) {
        return 'openrouter'; // Will use deepseek-coder-free or Claude
    }
    
    // Creative writing -> OpenRouter (Claude excels here)
    if (/write|story|poem|creative|essay|blog|article|fiction|narrative/.test(promptLower)) {
        return 'openrouter';
    }
    
    // Quick/simple questions -> Ollama (fastest local response)
    if (prompt.length < 30 && /hello|hi|thanks|ok|yes|no/.test(promptLower)) {
        return 'ollama';
    }
    
    // Math/calculations -> OpenRouter (GPT-4 or Claude)
    if (/math|calculate|solve|equation|formula|statistics/.test(promptLower)) {
        return 'openrouter';
    }
    
    // Default to OpenRouter (free models available)
    return 'openrouter';
}

// Utility function for delay
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ✅ Enhanced OpenRouter integration with smart model selection
async function chatWithOpenRouter(prompt, options = {}) {
    let model;
    
    // Determine model based on request type
    if (options.openrouterModel) {
        model = AI_PROVIDERS.openrouter.models[options.openrouterModel] || options.openrouterModel;
    } else {
        // Smart model selection based on prompt
        const promptLower = prompt.toLowerCase();
        
        if (/code|programming|debug/.test(promptLower)) {
            model = options.preferFree ? 'deepseek/deepseek-coder-6.7b-instruct:free' : 'anthropic/claude-3.5-sonnet';
        } else if (/creative|story|write/.test(promptLower)) {
            model = options.preferFree ? 'nousresearch/nous-hermes-2-mixtral-8x7b-dpo:free' : 'anthropic/claude-3-opus';
        } else if (/complex|analyze|reason/.test(promptLower)) {
            model = options.preferFree ? 'mistralai/mixtral-8x7b-instruct:free' : 'anthropic/claude-3.5-sonnet';
        } else {
            // Default to free model
            model = AI_PROVIDERS.openrouter.defaultModel;
        }
    }
    
    console.log(`🌐 OpenRouter Request: ${model} - ${prompt.substring(0, 50)}...`);
    
    try {
        const requestBody = {
            model: model,
            messages: [
                { role: 'system', content: options.systemPrompt || 'You are a helpful AI assistant.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: options.maxTokens || 1000,
            temperature: options.temperature || 0.7,
            top_p: options.topP || 1,
            frequency_penalty: options.frequencyPenalty || 0,
            presence_penalty: options.presencePenalty || 0
        };

        const response = await fetch(AI_PROVIDERS.openrouter.url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AI_PROVIDERS.openrouter.key}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.SITE_URL || 'http://localhost:3000',
                'X-Title': process.env.APP_NAME || 'Multi-AI Chatbot Server'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`OpenRouter Error: ${response.status} ${response.statusText}`, errorText);
            
            if (response.status === 429) {
                stats.rateLimits++;
                throw new Error(`OpenRouter rate limit exceeded (429)`);
            }
            
            if (response.status === 404) {
                console.error(`Model not found: ${model}. Falling back to default.`);
                // Try with default free model
                if (model !== AI_PROVIDERS.openrouter.defaultModel) {
                    return await chatWithOpenRouter(prompt, { 
                        ...options, 
                        openrouterModel: null // Use default
                    });
                }
            }
            
            throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('✅ OpenRouter Response received');
        
        // Track model usage
        stats.modelUsage[model] = (stats.modelUsage[model] || 0) + 1;
        
        return {
            content: data.choices[0]?.message?.content || 'No response generated',
            model: data.model || model,
            usage: data.usage,
            provider: 'openrouter'
        };

    } catch (error) {
        console.error('OpenRouter Connection Error:', error.message);
        throw error;
    }
}

// Enhanced Ollama integration
async function chatWithOllama(prompt, options = {}) {
    const model = options.model || 'llama3.2:latest';
    
    console.log(`🤖 Ollama Request: ${model} - ${prompt.substring(0, 50)}...`);
    
    try {
        const response = await fetch(`${AI_PROVIDERS.ollama.url}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                prompt: prompt,
                stream: false,
                options: {
                    temperature: options.temperature || 0.7,
                    top_p: 0.9,
                    num_predict: options.maxTokens || 500
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Ollama Error:', response.status, response.statusText, errorText);
            throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('✅ Ollama Response received');
        
        stats.modelUsage[model] = (stats.modelUsage[model] || 0) + 1;
        
        return {
            content: data.response || 'No response generated',
            model: model,
            provider: 'ollama'
        };

    } catch (error) {
        console.error('Ollama Connection Error:', error.message);
        throw error;
    }
}

// Enhanced OpenAI integration with retry logic
async function chatWithOpenAI(prompt, options = {}) {
    const maxRetries = 3;
    let attempt = 0;
    
    while (attempt < maxRetries) {
        try {
            const response = await fetch(AI_PROVIDERS.openai.url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${AI_PROVIDERS.openai.key}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: options.model || AI_PROVIDERS.openai.model,
                    messages: [
                        { role: 'system', content: options.systemPrompt || 'You are a helpful AI assistant.' },
                        { role: 'user', content: prompt }
                    ],
                    max_tokens: options.maxTokens || 1000,
                    temperature: options.temperature || 0.7
                })
            });

            if (response.ok) {
                const data = await response.json();
                stats.modelUsage[data.model] = (stats.modelUsage[data.model] || 0) + 1;
                return {
                    content: data.choices[0]?.message?.content || 'No response generated',
                    model: data.model,
                    usage: data.usage,
                    provider: 'openai'
                };
            }

            if (response.status === 429) {
                stats.rateLimits++;
                const retryAfter = response.headers.get('retry-after');
                const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt) * 1000;
                
                console.log(`⏳ OpenAI rate limit hit, waiting ${waitTime/1000}s (attempt ${attempt + 1}/${maxRetries})`);
                
                if (attempt < maxRetries - 1) {
                    await delay(waitTime);
                    attempt++;
                    continue;
                } else {
                    throw new Error(`OpenAI rate limit exceeded (429)`);
                }
            }

            throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);

        } catch (error) {
            if (attempt === maxRetries - 1 || !error.message.includes('429')) {
                throw error;
            }
            attempt++;
            await delay(1000 * attempt);
        }
    }
}

// Enhanced DeepSeek integration with retry logic
async function chatWithDeepSeek(prompt, options = {}) {
    const maxRetries = 2;
    let attempt = 0;
    
    while (attempt < maxRetries) {
        try {
            const response = await fetch(AI_PROVIDERS.deepseek.url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${AI_PROVIDERS.deepseek.key}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: options.model || AI_PROVIDERS.deepseek.model,
                    messages: [
                        { role: 'system', content: options.systemPrompt || 'You are a helpful AI assistant.' },
                        { role: 'user', content: prompt }
                    ],
                    max_tokens: options.maxTokens || 1000,
                    temperature: options.temperature || 0.7
                })
            });

            if (response.ok) {
                const data = await response.json();
                stats.modelUsage[data.model] = (stats.modelUsage[data.model] || 0) + 1;
                return {
                    content: data.choices[0]?.message?.content || 'No response generated',
                    model: data.model,
                    usage: data.usage,
                    provider: 'deepseek'
                };
            }

            if (response.status === 429) {
                stats.rateLimits++;
                throw new Error(`DeepSeek rate limit exceeded (429)`);
            }

            throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);

        } catch (error) {
            if (attempt === maxRetries - 1) {
                throw error;
            }
            attempt++;
            await delay(1000 * attempt);
        }
    }
}

// ✅ Enhanced main AI chat function with improved fallback strategy
async function chatWithAI(provider, prompt, options = {}) {
    const startTime = Date.now();
    const cacheKey = `${provider}:${options.openrouterModel || options.model || 'default'}:${Buffer.from(prompt).toString('base64').slice(0, 50)}`;
    
    // Check cache first
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

    // Enhanced fallback order - prioritize OpenRouter
    let fallbackOrder;
    if (provider === 'openrouter') {
        fallbackOrder = ['openrouter', 'ollama']; // OpenRouter first, then local fallback
    } else if (provider === 'openai') {
        fallbackOrder = ['openai', 'openrouter', 'ollama'];
    } else if (provider === 'deepseek') {
        fallbackOrder = ['deepseek', 'openrouter', 'ollama'];
    } else {
        fallbackOrder = ['ollama', 'openrouter']; // Ollama requested
    }

    let lastError = null;
    
    for (const currentProvider of fallbackOrder) {
        try {
            let result;
            
            switch (currentProvider) {
                case 'openai':
                    result = await chatWithOpenAI(prompt, options);
                    break;
                case 'deepseek':
                    result = await chatWithDeepSeek(prompt, options);
                    break;
                case 'openrouter':
                    result = await chatWithOpenRouter(prompt, options);
                    break;
                case 'ollama':
                    result = await chatWithOllama(prompt, options);
                    break;
                default:
                    throw new Error(`Unknown provider: ${currentProvider}`);
            }

            const responseTime = Date.now() - startTime;
            
            // Update response time statistics
            stats.responseTimeStats.total += responseTime;
            stats.responseTimeStats.count++;
            stats.responseTimeStats.average = Math.round(stats.responseTimeStats.total / stats.responseTimeStats.count);
            
            // Track provider usage
            stats.providerUsage[currentProvider]++;
            
            // Cache the result
            if (result) {
                cache.set(cacheKey, result, 600); // Cache for 10 minutes
            }

            // Log fallback usage
            if (currentProvider !== provider) {
                stats.fallbacks++;
                console.log(`🔄 Fallback used: ${provider} → ${currentProvider} (${lastError?.message || 'error'})`);
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
            console.error(`${currentProvider} AI error:`, error.message);
            lastError = error;
            
            // Continue to next provider in fallback chain
            if (currentProvider !== fallbackOrder[fallbackOrder.length - 1]) {
                console.log(`🔄 Trying next fallback provider...`);
                continue;
            }
        }
    }
    
    stats.errors++;
    throw lastError || new Error('All providers failed');
}

// ✅ Enhanced chat endpoint
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

        console.log(`📨 Chat Request: ${provider || 'auto'} - "${message.substring(0, 50)}..."`);

        // Select provider intelligently
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

        console.log(`✅ Response sent: ${aiResult.provider}/${aiResult.model} (${totalTime}ms)${aiResult.fallbackUsed ? ' [FALLBACK]' : ''}${aiResult.cached ? ' [CACHED]' : ''}`);
        res.json(response);

    } catch (error) {
        console.error('❌ Chat API error:', error);
        
        const errorResponse = {
            error: 'Failed to get AI response',
            message: error.message,
            code: error.message.includes('429') ? 'RATE_LIMIT' : 'AI_ERROR',
            timestamp: new Date().toISOString(),
            requestTime: Date.now() - startTime
        };

        res.status(500).json(errorResponse);
    }
});

// ✅ Enhanced OpenRouter models endpoint
app.get('/api/openrouter/models', async (req, res) => {
    try {
        if (AI_PROVIDERS.openrouter.key.includes('your-openrouter-key-here')) {
            return res.json({
                success: false,
                error: 'OpenRouter API key not configured',
                availableModels: AI_PROVIDERS.openrouter.models,
                message: 'Add OPENROUTER_API_KEY to your .env file'
            });
        }

        const response = await fetch('https://openrouter.ai/api/v1/models', {
            headers: {
                'Authorization': `Bearer ${AI_PROVIDERS.openrouter.key}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch OpenRouter models');
        }
        
        const data = await response.json();
        res.json({
            success: true,
            models: data.data || [],
            configuredModels: AI_PROVIDERS.openrouter.models,
            categories: AI_PROVIDERS.openrouter.categories,
            defaultModel: AI_PROVIDERS.openrouter.defaultModel,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'OpenRouter not available',
            message: error.message,
            availableModels: AI_PROVIDERS.openrouter.models
        });
    }
});

// Fast response endpoint
app.post('/api/chat/fast', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { message, preferFree = true } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Use free OpenRouter model for fast responses
        const options = {
            maxTokens: 300,
            temperature: 0.3,
            preferFree: true,
            openrouterModel: 'mistral-7b-free' // Use fast free model
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
        // Fallback to Ollama for fast responses
        try {
            const aiResult = await chatWithAI('ollama', req.body.message, {
                maxTokens: 300,
                temperature: 0.3
            });
            res.json({
                reply: aiResult.response,
                provider: 'ollama',
                mode: 'fast-fallback',
                responseTime: aiResult.responseTime,
                totalTime: Date.now() - startTime
            });
        } catch (fallbackError) {
            res.status(500).json({ 
                error: 'Fast response service unavailable',
                message: fallbackError.message 
            });
        }
    }
});

// ✅ Enhanced provider status endpoint
app.get('/api/providers/status', async (req, res) => {
    const providerStatus = {};
    
    // Check Ollama
    try {
        const response = await fetch(`${AI_PROVIDERS.ollama.url}/api/tags`, { 
            signal: AbortSignal.timeout(3000) 
        });
        if (response.ok) {
            const data = await response.json();
            providerStatus.ollama = {
                status: 'online',
                models: data.models?.map(m => m.name) || [],
                name: 'Ollama Local',
                url: AI_PROVIDERS.ollama.url
            };
        } else {
            providerStatus.ollama = { status: 'offline', name: 'Ollama Local' };
        }
    } catch (error) {
        providerStatus.ollama = { 
            status: 'offline', 
            name: 'Ollama Local',
            error: 'Connection failed - make sure Ollama is running: ollama serve',
            url: AI_PROVIDERS.ollama.url
        };
    }
    
    // Check OpenRouter
    try {
        if (AI_PROVIDERS.openrouter.key.includes('your-openrouter-key-here')) {
            providerStatus.openrouter = {
                status: 'not-configured',
                name: 'OpenRouter',
                error: 'API key not set'
            };
        } else {
            const response = await fetch('https://openrouter.ai/api/v1/models', { 
                headers: { 'Authorization': `Bearer ${AI_PROVIDERS.openrouter.key}` },
                signal: AbortSignal.timeout(5000)
            });
            if (response.ok) {
                const data = await response.json();
                providerStatus.openrouter = {
                    status: 'online',
                    name: 'OpenRouter',
                    availableModels: data.data?.length || 0,
                    configuredModels: Object.keys(AI_PROVIDERS.openrouter.models).length,
                    defaultModel: AI_PROVIDERS.openrouter.defaultModel
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
    
    // Check other providers
    providerStatus.openai = {
        status: AI_PROVIDERS.openai.key.includes('your-openai-key-here') ? 'not-configured' : 'configured',
        name: 'OpenAI GPT-4',
        rateLimits: stats.rateLimits
    };
    
    providerStatus.deepseek = {
        status: AI_PROVIDERS.deepseek.key.includes('your-deepseek-key-here') ? 'not-configured' : 'configured',
        name: 'DeepSeek'
    };

    res.json({
        providers: providerStatus,
        timestamp: new Date().toISOString()
    });
});

// ✅ Enhanced statistics endpoint
app.get('/api/stats', (req, res) => {
    const uptime = Date.now() - stats.uptime;
    
    res.json({
        ...stats,
        uptime: {
            milliseconds: uptime,
            seconds: Math.floor(uptime / 1000),
            minutes: Math.floor(uptime / 60000),
            hours: Math.floor(uptime / 3600000),
            formatted: formatUptime(uptime)
        },
        cache: {
            keys: cache.keys().length,
            stats: cache.getStats()
        },
        rates: {
            fallbackRate: stats.totalRequests > 0 ? ((stats.fallbacks / stats.totalRequests) * 100).toFixed(1) + '%' : '0%',
            cacheHitRate: stats.totalRequests > 0 ? ((stats.cacheHits / stats.totalRequests) * 100).toFixed(1) + '%' : '0%',
            errorRate: stats.totalRequests > 0 ? ((stats.errors / stats.totalRequests) * 100).toFixed(1) + '%' : '0%'
        },
        performance: {
            averageResponseTime: stats.responseTimeStats.average + 'ms',
            totalResponses: stats.responseTimeStats.count
        },
        topModels: Object.entries(stats.modelUsage)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([model, count]) => ({ model, usage: count })),
        timestamp: new Date().toISOString()
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: formatUptime(Date.now() - stats.uptime),
        version: '2.0.0',
        providers: {
            total: Object.keys(AI_PROVIDERS).length,
            configured: Object.values(AI_PROVIDERS).filter(p => 
                !p.key?.includes('your-') && p.key !== undefined
            ).length
        }
    });
});

// Cache management
app.post('/api/cache/clear', (req, res) => {
    const cleared = cache.keys().length;
    cache.flushAll();
    
    res.json({
        message: 'Cache cleared successfully',
        entriesCleared: cleared,
        timestamp: new Date().toISOString()
    });
});

// ✅ Enhanced Ollama model management
app.get('/api/ollama/models', async (req, res) => {
    try {
        const response = await fetch(`${AI_PROVIDERS.ollama.url}/api/tags`, {
            signal: AbortSignal.timeout(5000)
        });
        if (!response.ok) {
            throw new Error('Ollama not available');
        }
        
        const data = await response.json();
        const models = data.models || [];
        
        res.json({
            success: true,
            models: models,
            count: models.length,
            recommended: AI_PROVIDERS.ollama.models,
            url: AI_PROVIDERS.ollama.url,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ollama not available',
            message: 'Make sure Ollama is running: ollama serve',
            url: AI_PROVIDERS.ollama.url,
            recommended: AI_PROVIDERS.ollama.models
        });
    }
});

// ✅ New endpoint: Model recommendations
app.get('/api/models/recommend', (req, res) => {
    const { task, preferFree = false } = req.query;
    
    const recommendations = {
        coding: {
            free: 'deepseek/deepseek-coder-6.7b-instruct:free',
            premium: 'anthropic/claude-3.5-sonnet',
            description: 'Best for programming and code generation'
        },
        creative: {
            free: 'nousresearch/nous-hermes-2-mixtral-8x7b-dpo:free',
            premium: 'anthropic/claude-3-opus',
            description: 'Excellent for creative writing and storytelling'
        },
        reasoning: {
            free: 'mistralai/mixtral-8x7b-instruct:free',
            premium: 'anthropic/claude-3.5-sonnet',
            description: 'Great for complex analysis and reasoning'
        },
        math: {
            free: 'meta-llama/llama-3.1-8b-instruct:free',
            premium: 'openai/gpt-4o',
            description: 'Strong mathematical and scientific capabilities'
        },
        general: {
            free: 'mistralai/mistral-7b-instruct:free',
            premium: 'openai/gpt-4o-mini',
            description: 'General purpose conversation'
        },
        fast: {
            free: 'mistralai/mistral-7b-instruct:free',
            premium: 'anthropic/claude-3-haiku',
            description: 'Quick responses with good quality'
        }
    };
    
    if (task && recommendations[task]) {
        const rec = recommendations[task];
        res.json({
            task,
            recommended: preferFree === 'true' ? rec.free : rec.premium,
            alternatives: {
                free: rec.free,
                premium: rec.premium
            },
            description: rec.description,
            provider: 'openrouter'
        });
    } else {
        res.json({
            availableTasks: Object.keys(recommendations),
            default: preferFree === 'true' ? 
                recommendations.general.free : 
                recommendations.general.premium,
            recommendations
        });
    }
});

// ✅ New endpoint: Test specific model
app.post('/api/test/model', async (req, res) => {
    const { model, message = 'Hello! Can you respond briefly?' } = req.body;
    const startTime = Date.now();
    
    try {
        if (!model) {
            return res.status(400).json({ error: 'Model parameter required' });
        }
        
        console.log(`🧪 Testing model: ${model}`);
        
        const result = await chatWithOpenRouter(message, { 
            openrouterModel: model,
            maxTokens: 100 
        });
        
        const responseTime = Date.now() - startTime;
        
        res.json({
            success: true,
            model: result.model,
            response: result.content,
            responseTime: responseTime + 'ms',
            usage: result.usage,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            model: model,
            error: error.message,
            responseTime: (Date.now() - startTime) + 'ms',
            timestamp: new Date().toISOString()
        });
    }
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ✅ Enhanced 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl,
        method: req.method,
        availableEndpoints: {
            chat: [
                'POST /api/chat - Main chat endpoint',
                'POST /api/chat/fast - Fast responses',
                'POST /api/test/model - Test specific model'
            ],
            info: [
                'GET /api/providers/status - Provider status',
                'GET /api/stats - Server statistics',
                'GET /api/health - Health check'
            ],
            models: [
                'GET /api/openrouter/models - OpenRouter models',
                'GET /api/ollama/models - Ollama models',
                'GET /api/models/recommend - Model recommendations'
            ],
            utils: [
                'POST /api/cache/clear - Clear cache'
            ]
        },
        timestamp: new Date().toISOString()
    });
});

// Error handler
app.use((error, req, res, next) => {
    console.error('Global error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        path: req.path,
        timestamp: new Date().toISOString()
    });
});

// Utility functions
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

// ✅ Graceful shutdown with cleanup
process.on('SIGTERM', () => {
    console.log('🛑 Shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        cache.close();
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        cache.close();
        process.exit(0);
    });
});

// ✅ Enhanced server startup
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('\n🚀 MULTI-AI CHATBOT SERVER v2.0');
    console.log('━'.repeat(60));
    console.log(`🌍 Server: http://localhost:${PORT}`);
    console.log(`📡 API: http://localhost:${PORT}/api/`);
    console.log(`🏥 Health: http://localhost:${PORT}/api/health`);
    console.log(`📊 Stats: http://localhost:${PORT}/api/stats`);
    console.log('━'.repeat(60));
    console.log('\n🤖 AI PROVIDERS:');
    console.log('   • 🌟 OpenRouter (400+ Models) - Primary');
    console.log('   • 🏠 Ollama Local (Fast Responses)');
    console.log('   • 🚀 OpenAI GPT-4 (Premium Fallback)');
    console.log('   • 🔥 DeepSeek (Code & Chat)');
    console.log('\n✨ FEATURES:');
    console.log('   • Smart provider/model selection');
    console.log('   • Free & premium model access via OpenRouter');
    console.log('   • Automatic fallback on errors/rate limits');
    console.log('   • Intelligent caching system');
    console.log('   • Performance monitoring & statistics');
    console.log('   • Fast response mode');
    console.log('   • Model testing & recommendations');
    console.log('\n🆓 FREE OPENROUTER MODELS:');
    console.log('   • Mistral 7B Instruct (Default)');
    console.log('   • Mixtral 8x7B (High Performance)');
    console.log('   • Llama 3.1 8B (Meta)');
    console.log('   • DeepSeek Coder (Programming)');
    console.log('   • Qwen 2.5 7B (Multilingual)');
    console.log('\n💎 PREMIUM MODELS AVAILABLE:');
    console.log('   • Claude 3.5 Sonnet (Best Overall)');
    console.log('   • GPT-4o (Latest OpenAI)');
    console.log('   • Gemini 1.5 Pro (Google)');
    console.log('   • Claude 3 Opus (Most Creative)');
    console.log('   • Llama 3.1 405B (Largest Open Model)');
    
    // Show configuration status
    console.log('\n🔑 CONFIGURATION STATUS:');
    const openRouterConfigured = !AI_PROVIDERS.openrouter.key.includes('your-openrouter-key-here');
    const openAiConfigured = !AI_PROVIDERS.openai.key.includes('your-openai-key-here');
    const deepSeekConfigured = !AI_PROVIDERS.deepseek.key.includes('your-deepseek-key-here');
    
    console.log(`   • OpenRouter: ${openRouterConfigured ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   • OpenAI: ${openAiConfigured ? '✅ Configured' : '⚠️ Optional'}`);
    console.log(`   • DeepSeek: ${deepSeekConfigured ? '✅ Configured' : '⚠️ Optional'}`);
    console.log(`   • Ollama: ⏳ Checking connection...`);
    
    if (!openRouterConfigured) {
        console.log('\n⚠️  To access premium models:');
        console.log('   1. Get API key from https://openrouter.ai');
        console.log('   2. Add OPENROUTER_API_KEY to your .env file');
        console.log('   3. Restart server');
    }
    
    console.log('\n🎉 Server ready! Try sending a message...\n');
    
    // Test Ollama connection
    fetch(`${AI_PROVIDERS.ollama.url}/api/tags`, { signal: AbortSignal.timeout(3000) })
        .then(response => response.ok ? 
            console.log('✅ Ollama: Connected successfully') : 
            console.log('⚠️  Ollama: Not running (optional)')
        )
        .catch(() => console.log('⚠️  Ollama: Not available (run: ollama serve)'));
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
        console.log('💡 Try: kill -9 $(lsof -ti:3000) or use different PORT');
        process.exit(1);
    } else {
        console.error('❌ Server error:', error);
        process.exit(1);
    }
});

// ✅ Export for testing
export default app;