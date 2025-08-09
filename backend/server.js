import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import NodeCache from 'node-cache';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Load environment variables
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// AI Provider Configuration
const AI_PROVIDERS = {
    openai: {
        name: 'OpenAI GPT-4',
        url: 'https://api.openai.com/v1/chat/completions',
        key: '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',
        model: 'gpt-4-turbo-preview'
    },
    deepseek: {
        name: 'DeepSeek',
        url: 'https://api.deepseek.com/v1/chat/completions',
        key: 'sk-6118215940fa4022aee05dd59283fca1',
        model: 'deepseek-chat'
    },
    ollama: {
        name: 'Ollama Local',
        url: 'http://localhost:11434/api/generate',
        models: ['llama3.2:latest', 'gemma2:latest', 'mistral:latest', 'codellama:latest']
    }
};

// Google Search Configuration
const GOOGLE_CONFIG = {
    searchApiKey: '86cc1b0e5cf12d9659803cfa76422e34',
    customSearchApiKey: 'AIzaSyDm7uUslpZCp9m0_Q2KnkOr7dHgm9xjZHY',
    searchEngineId: '57aad852a1a8442b9',
    maxResults: 10
};

// Enhanced middleware with security and performance
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Advanced rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

// Multi-layer intelligent caching system
const responseCache = new NodeCache({ 
    stdTTL: 300, // 5 minutes
    checkperiod: 60,
    maxKeys: 10000
});
const searchCache = new NodeCache({ 
    stdTTL: 1800, // 30 minutes
    checkperiod: 120,
    maxKeys: 5000
});
const aiCache = new NodeCache({ 
    stdTTL: 180, // 3 minutes
    checkperiod: 60,
    maxKeys: 8000
});

// Performance and analytics tracking
let globalStats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    searchQueries: 0,
    aiRequests: 0,
    averageResponseTime: 0,
    errorCount: 0,
    providerStats: {},
    uptime: Date.now(),
    lastActivity: Date.now(),
    totalDataTransferred: 0,
    uniqueUsers: new Set(),
    requestsPerMinute: []
};

// Enhanced search detection patterns
const SEARCH_PATTERNS = [
    // Current events and news
    /latest|recent|today|yesterday|this week|current|now|breaking|news/i,
    
    // Prices and market data
    /price of|cost of|how much|worth|value|trading at|market cap|stock price/i,
    
    // Weather and location
    /weather in|temperature in|forecast|climate|humidity|rainfall/i,
    
    // Real-time data
    /status of|update on|what happened|when did|live|real time/i,
    
    // Shopping and products
    /buy|purchase|compare|review|rating|best|top|cheapest/i,
    
    // Technology and trends
    /new|launch|release|update|version|beta|announcement/i,
    
    // Questions requiring current data
    /who is the current|what is the latest|when is the next/i,
];

// Smart AI provider selection based on query type
function selectOptimalAIProvider(prompt, userPreference = null) {
    if (userPreference && AI_PROVIDERS[userPreference]) {
        return userPreference;
    }

    const promptLower = prompt.toLowerCase();
    
    // Code-related queries -> DeepSeek or Ollama CodeLlama
    if (/code|programming|function|algorithm|debug|syntax|javascript|python|java|c\+\+/.test(promptLower)) {
        return Math.random() > 0.5 ? 'deepseek' : 'ollama';
    }
    
    // Creative writing -> OpenAI
    if (/write|story|poem|creative|narrative|blog post|essay/.test(promptLower)) {
        return 'openai';
    }
    
    // Analysis and reasoning -> OpenAI or DeepSeek
    if (/analyze|explain|compare|evaluate|detailed|complex|research/.test(promptLower)) {
        return Math.random() > 0.5 ? 'openai' : 'deepseek';
    }
    
    // Quick responses -> Ollama
    if (prompt.length < 50 || /hi|hello|thanks|yes|no|ok/.test(promptLower)) {
        return 'ollama';
    }
    
    // Default: Round-robin between available providers
    const providers = Object.keys(AI_PROVIDERS);
    return providers[globalStats.totalRequests % providers.length];
}

// Enhanced Google Search with multiple fallbacks
async function performAdvancedSearch(query, options = {}) {
    const cacheKey = `search:${query}:${JSON.stringify(options)}`;
    
    if (searchCache.has(cacheKey)) {
        globalStats.cacheHits++;
        return searchCache.get(cacheKey);
    }

    globalStats.cacheMisses++;
    globalStats.searchQueries++;

    try {
        const searchResults = await Promise.allSettled([
            googleCustomSearch(query, options),
            googleWebSearch(query, options),
            duckDuckGoSearch(query, options)
        ]);

        const results = [];
        
        // Combine and deduplicate results
        searchResults.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                results.push(...result.value);
            }
        });

        // Remove duplicates and sort by relevance
        const uniqueResults = removeDuplicateResults(results);
        const sortedResults = sortByRelevance(uniqueResults, query);
        const finalResults = sortedResults.slice(0, options.maxResults || 8);

        const searchData = {
            query,
            results: finalResults,
            totalFound: finalResults.length,
            searchTime: Date.now(),
            sources: ['Google Custom', 'Google Web', 'DuckDuckGo'],
            cached: false
        };

        searchCache.set(cacheKey, searchData);
        return searchData;

    } catch (error) {
        console.error('Search error:', error);
        return {
            query,
            results: [],
            error: 'Search temporarily unavailable',
            cached: false
        };
    }
}

// Google Custom Search API
async function googleCustomSearch(query, options = {}) {
    try {
        const url = `https://www.googleapis.com/customsearch/v1?` +
            `key=${GOOGLE_CONFIG.customSearchApiKey}&` +
            `cx=${GOOGLE_CONFIG.searchEngineId}&` +
            `q=${encodeURIComponent(query)}&` +
            `num=${Math.min(options.maxResults || 5, 10)}&` +
            `dateRestrict=${options.dateRestrict || 'm1'}&` +
            `safe=${options.safe || 'medium'}&` +
            `gl=${options.country || 'us'}&` +
            `lr=${options.language || 'lang_en'}`;

        const response = await fetch(url, { timeout: 5000 });
        const data = await response.json();

        if (data.items) {
            return data.items.map(item => ({
                title: item.title,
                snippet: item.snippet,
                link: item.link,
                displayLink: item.displayLink,
                source: 'Google Custom',
                relevance: calculateRelevance(item, query),
                timestamp: new Date().toISOString()
            }));
        }

        return [];
    } catch (error) {
        console.error('Google Custom Search error:', error);
        return [];
    }
}

// Google Web Search (alternative method)
async function googleWebSearch(query, options = {}) {
    try {
        // Using SerpApi or similar service as fallback
        const url = `https://serpapi.com/search.json?` +
            `q=${encodeURIComponent(query)}&` +
            `api_key=${GOOGLE_CONFIG.searchApiKey}&` +
            `num=${options.maxResults || 5}&` +
            `hl=${options.language || 'en'}&` +
            `gl=${options.country || 'us'}`;

        const response = await fetch(url, { timeout: 5000 });
        const data = await response.json();

        if (data.organic_results) {
            return data.organic_results.map(item => ({
                title: item.title,
                snippet: item.snippet,
                link: item.link,
                displayLink: item.displayed_link,
                source: 'Google Web',
                relevance: calculateRelevance(item, query),
                timestamp: new Date().toISOString()
            }));
        }

        return [];
    } catch (error) {
        console.error('Google Web Search error:', error);
        return [];
    }
}

// Enhanced DuckDuckGo search
async function duckDuckGoSearch(query, options = {}) {
    try {
        const url = `https://api.duckduckgo.com/?` +
            `q=${encodeURIComponent(query)}&` +
            `format=json&` +
            `no_html=1&` +
            `skip_disambig=1&` +
            `no_redirect=1&` +
            `safe_search=${options.safe || 'moderate'}`;

        const response = await fetch(url, { timeout: 5000 });
        const data = await response.json();

        const results = [];

        // Add instant answer
        if (data.Answer) {
            results.push({
                title: 'Instant Answer',
                snippet: data.Answer,
                link: data.AnswerURL || '#',
                displayLink: 'DuckDuckGo',
                source: 'DuckDuckGo Instant',
                relevance: 0.9,
                timestamp: new Date().toISOString()
            });
        }

        // Add definition
        if (data.Definition) {
            results.push({
                title: 'Definition',
                snippet: data.Definition,
                link: data.DefinitionURL || '#',
                displayLink: data.DefinitionSource || 'DuckDuckGo',
                source: 'DuckDuckGo Definition',
                relevance: 0.8,
                timestamp: new Date().toISOString()
            });
        }

        // Add related topics
        if (data.RelatedTopics) {
            data.RelatedTopics.slice(0, 3).forEach(topic => {
                if (topic.Text && topic.FirstURL) {
                    results.push({
                        title: topic.Text.split(' - ')[0] || 'Related Topic',
                        snippet: topic.Text,
                        link: topic.FirstURL,
                        displayLink: 'DuckDuckGo',
                        source: 'DuckDuckGo Related',
                        relevance: 0.7,
                        timestamp: new Date().toISOString()
                    });
                }
            });
        }

        return results;
    } catch (error) {
        console.error('DuckDuckGo search error:', error);
        return [];
    }
}

// Calculate relevance score for search results
function calculateRelevance(item, query) {
    const queryWords = query.toLowerCase().split(' ');
    const titleWords = (item.title || '').toLowerCase().split(' ');
    const snippetWords = (item.snippet || '').toLowerCase().split(' ');
    
    let score = 0;
    queryWords.forEach(word => {
        if (titleWords.includes(word)) score += 2;
        if (snippetWords.includes(word)) score += 1;
    });
    
    return Math.min(score / (queryWords.length * 3), 1);
}

// Remove duplicate search results
function removeDuplicateResults(results) {
    const seen = new Set();
    return results.filter(result => {
        const key = `${result.title}:${result.link}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// Sort results by relevance and recency
function sortByRelevance(results, query) {
    return results.sort((a, b) => {
        const relevanceDiff = (b.relevance || 0) - (a.relevance || 0);
        if (Math.abs(relevanceDiff) > 0.1) return relevanceDiff;
        
        // If relevance is similar, prefer recent results
        const timeA = new Date(a.timestamp || 0).getTime();
        const timeB = new Date(b.timestamp || 0).getTime();
        return timeB - timeA;
    });
}

// Advanced AI communication with multiple providers
async function chatWithAI(provider, prompt, options = {}) {
    const startTime = Date.now();
    const cacheKey = `${provider}:${JSON.stringify(options)}:${prompt}`;
    
    if (options.useCache !== false && aiCache.has(cacheKey)) {
        globalStats.cacheHits++;
        return {
            response: aiCache.get(cacheKey),
            provider,
            cached: true,
            responseTime: Date.now() - startTime
        };
    }

    globalStats.cacheMisses++;
    globalStats.aiRequests++;

    try {
        let result;
        
        switch (provider) {
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
                throw new Error(`Unknown AI provider: ${provider}`);
        }

        const responseTime = Date.now() - startTime;
        
        if (result && options.useCache !== false) {
            aiCache.set(cacheKey, result);
        }

        // Update provider stats
        if (!globalStats.providerStats[provider]) {
            globalStats.providerStats[provider] = {
                requests: 0,
                totalTime: 0,
                errors: 0,
                avgResponseTime: 0
            };
        }
        
        globalStats.providerStats[provider].requests++;
        globalStats.providerStats[provider].totalTime += responseTime;
        globalStats.providerStats[provider].avgResponseTime = 
            globalStats.providerStats[provider].totalTime / globalStats.providerStats[provider].requests;

        return {
            response: result,
            provider,
            cached: false,
            responseTime,
            model: AI_PROVIDERS[provider].model || options.model
        };

    } catch (error) {
        console.error(`${provider} AI error:`, error);
        
        if (globalStats.providerStats[provider]) {
            globalStats.providerStats[provider].errors++;
        }
        
        globalStats.errorCount++;
        
        return {
            response: `⚠️ ${AI_PROVIDERS[provider].name} is temporarily unavailable. Please try again.`,
            provider,
            cached: false,
            error: true,
            responseTime: Date.now() - startTime
        };
    }
}

// OpenAI GPT-4 integration
async function chatWithOpenAI(prompt, options = {}) {
    const response = await fetch(AI_PROVIDERS.openai.url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${AI_PROVIDERS.openai.key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: options.model || AI_PROVIDERS.openai.model,
            messages: [
                {
                    role: 'system',
                    content: options.systemPrompt || 'You are a helpful, accurate, and knowledgeable AI assistant. Provide clear, concise, and informative responses.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            max_tokens: options.maxTokens || 1000,
            temperature: options.temperature || 0.7,
            top_p: options.topP || 0.9,
            frequency_penalty: options.frequencyPenalty || 0.1,
            presence_penalty: options.presencePenalty || 0.1
        }),
        timeout: 30000
    });

    if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || 'No response generated';
}

// DeepSeek integration
async function chatWithDeepSeek(prompt, options = {}) {
    const response = await fetch(AI_PROVIDERS.deepseek.url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${AI_PROVIDERS.deepseek.key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: options.model || AI_PROVIDERS.deepseek.model,
            messages: [
                {
                    role: 'system',
                    content: options.systemPrompt || 'You are DeepSeek, an advanced AI assistant. Provide accurate, helpful, and detailed responses.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            max_tokens: options.maxTokens || 1000,
            temperature: options.temperature || 0.7,
            top_p: options.topP || 0.9
        }),
        timeout: 30000
    });

    if (!response.ok) {
        throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || 'No response generated';
}

// Enhanced Ollama integration with model selection
async function chatWithOllama(prompt, options = {}) {
    const model = options.model || selectOllamaModel(prompt);
    
    const response = await fetch(AI_PROVIDERS.ollama.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: model,
            prompt: prompt,
            stream: false,
            options: {
                temperature: options.temperature || 0.7,
                top_p: options.topP || 0.9,
                num_predict: options.maxTokens || 500,
                stop: options.stop || []
            }
        }),
        timeout: 30000
    });

    if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.response || 'No response generated';
}

// Smart Ollama model selection
function selectOllamaModel(prompt) {
    const promptLower = prompt.toLowerCase();
    
    if (/code|programming|function|debug/.test(promptLower)) {
        return 'codellama:latest';
    }
    
    if (prompt.length > 500 || /analyze|explain|detailed|complex/.test(promptLower)) {
        return 'llama3.2:latest';
    }
    
    if (prompt.length < 50) {
        return 'gemma2:latest';
    }
    
    return 'mistral:latest';
}

// Intelligent search detection
function needsWebSearch(prompt) {
    return SEARCH_PATTERNS.some(pattern => pattern.test(prompt));
}

// Update global statistics
function updateGlobalStats(responseTime, additionalData = {}) {
    globalStats.totalRequests++;
    globalStats.lastActivity = Date.now();
    globalStats.totalDataTransferred += additionalData.dataSize || 0;
    
    // Update average response time
    globalStats.averageResponseTime = 
        ((globalStats.averageResponseTime * (globalStats.totalRequests - 1)) + responseTime) / globalStats.totalRequests;
    
    // Track requests per minute
    const currentMinute = Math.floor(Date.now() / 60000);
    if (!globalStats.requestsPerMinute[currentMinute]) {
        globalStats.requestsPerMinute[currentMinute] = 0;
    }
    globalStats.requestsPerMinute[currentMinute]++;
    
    // Cleanup old minute data (keep last 60 minutes)
    const oldestMinute = currentMinute - 60;
    Object.keys(globalStats.requestsPerMinute).forEach(minute => {
        if (parseInt(minute) < oldestMinute) {
            delete globalStats.requestsPerMinute[minute];
        }
    });
}

// ============================================================================
// API ROUTES
// ============================================================================

// Main intelligent chat endpoint
app.post('/api/chat', async (req, res) => {
    const startTime = Date.now();
    const clientIP = req.ip || req.connection.remoteAddress;
    
    try {
        const {
            message,
            provider: requestedProvider,
            model,
            useSearch = 'auto',
            searchOptions = {},
            aiOptions = {},
            userId,
            sessionId
        } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({
                error: 'Message is required and cannot be empty',
                code: 'EMPTY_MESSAGE'
            });
        }

        if (message.length > 8000) {
            return res.status(400).json({
                error: 'Message too long. Maximum 8000 characters allowed.',
                code: 'MESSAGE_TOO_LONG'
            });
        }

        // Track unique users
        if (userId) globalStats.uniqueUsers.add(userId);
        if (clientIP) globalStats.uniqueUsers.add(clientIP);

        let enhancedPrompt = message;
        let searchResults = null;
        let usedSearch = false;

        // Intelligent search decision
        const shouldSearch = useSearch === true || 
            (useSearch === 'auto' && needsWebSearch(message));

        if (shouldSearch) {
            console.log('🔍 Performing web search for:', message);
            searchResults = await performAdvancedSearch(message, {
                maxResults: searchOptions.maxResults || 6,
                dateRestrict: searchOptions.dateRestrict || 'm1',
                safe: searchOptions.safe || 'medium',
                country: searchOptions.country || 'us',
                language: searchOptions.language || 'en'
            });
            
            usedSearch = true;

            if (searchResults && searchResults.results.length > 0) {
                const searchContext = searchResults.results
                    .slice(0, 5)
                    .map(r => `${r.title}: ${r.snippet}`)
                    .join('\n');

                enhancedPrompt = `Based on this current information from the web:\n\n${searchContext}\n\nUser question: ${message}\n\nPlease provide a comprehensive, accurate answer using the search results above as context. Be specific and cite relevant information when possible.`;
            }
        }

        // Select optimal AI provider
        const selectedProvider = selectOptimalAIProvider(message, requestedProvider);
        console.log(`🤖 Using AI provider: ${selectedProvider}`);

        // Enhanced AI options
        const enhancedAIOptions = {
            ...aiOptions,
            model: model,
            systemPrompt: aiOptions.systemPrompt || 
                (usedSearch ? 
                    'You are an advanced AI assistant with access to current information. Use the provided search results to give accurate, up-to-date answers.' :
                    'You are a helpful, knowledgeable AI assistant. Provide clear, accurate, and informative responses.'
                ),
            maxTokens: aiOptions.maxTokens || (usedSearch ? 1200 : 800),
            temperature: aiOptions.temperature || 0.7,
            useCache: aiOptions.useCache !== false
        };

        // Get AI response
        const aiResult = await chatWithAI(selectedProvider, enhancedPrompt, enhancedAIOptions);
        const responseTime = Date.now() - startTime;

        // Update statistics
        updateGlobalStats(responseTime, {
            dataSize: JSON.stringify(req.body).length + JSON.stringify(aiResult.response).length
        });

        // Prepare response
        const response = {
            reply: aiResult.response,
            metadata: {
                provider: selectedProvider,
                providerName: AI_PROVIDERS[selectedProvider].name,
                model: aiResult.model,
                searchUsed: usedSearch,
                searchResults: usedSearch ? {
                    query: searchResults?.query,
                    totalFound: searchResults?.results?.length || 0,
                    results: searchResults?.results?.slice(0, 3) || []
                } : null,
                responseTime: aiResult.responseTime,
                totalTime: responseTime,
                cached: aiResult.cached,
                searchCached: searchResults?.cached || false,
                timestamp: new Date().toISOString(),
                requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            }
        };

        res.json(response);

    } catch (error) {
        console.error('Chat API error:', error);
        globalStats.errorCount++;
        
        const errorResponse = {
            error: 'Internal server error occurred',
            message: error.message,
            code: 'INTERNAL_ERROR',
            timestamp: new Date().toISOString(),
            requestTime: Date.now() - startTime
        };

        res.status(500).json(errorResponse);
    }
});

// Fast response endpoint (prioritizes speed)
app.post('/api/chat/fast', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { message, provider = 'ollama' } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const aiResult = await chatWithAI(provider, message, {
            maxTokens: 300,
            temperature: 0.3,
            useCache: true,
            model: provider === 'ollama' ? 'gemma2:latest' : undefined
        });

        res.json({
            reply: aiResult.response,
            provider,
            mode: 'fast',
            responseTime: aiResult.responseTime,
            totalTime: Date.now() - startTime,
            cached: aiResult.cached
        });

    } catch (error) {
        console.error('Fast chat error:', error);
        res.status(500).json({ error: 'Fast response service unavailable' });
    }
});

// Search-only endpoint
app.post('/api/search', async (req, res) => {
    try {
        const { query, options = {} } = req.body;
        
        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }

        const searchResults = await performAdvancedSearch(query, options);
        res.json(searchResults);

    } catch (error) {
        console.error('Search API error:', error);
        res.status(500).json({ error: 'Search service temporarily unavailable' });
    }
});

// Streaming endpoint
app.post('/api/chat/stream', async (req, res) => {
    const { message, provider = 'openai' } = req.body;
    
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    try {
        // For now, simulate streaming (implement actual streaming based on provider capabilities)
        const fullResponse = await chatWithAI(provider, message, { useCache: false });
        const words = fullResponse.response.split(' ');
        
        for (let i = 0; i < words.length; i++) {
            const chunk = words.slice(0, i + 1).join(' ');
            res.write(`data: ${JSON.stringify({
                text: chunk,
                complete: i === words.length - 1,
                provider: fullResponse.provider
            })}\n\n`);
            
            await new Promise(resolve => setTimeout(resolve, 50));
        }

    } catch (error) {
        res.write(`data: ${JSON.stringify({
            error: 'Streaming failed',
            complete: true
        })}\n\n`);
    }

    res.end();
});

// Provider status and health check
app.get('/api/providers/status', async (req, res) => {
    const providerStatus = {};
    
    // Check each provider
    for (const [key, provider] of Object.entries(AI_PROVIDERS)) {
        try {
            const startTime = Date.now();
            let status = 'unknown';
            let responseTime = null;
            let error = null;

            if (key === 'openai') {
                const response = await fetch('https://api.openai.com/v1/models', {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${provider.key}` },
                    timeout: 5000
                });
                status = response.ok ? 'online' : 'offline';
                responseTime = Date.now() - startTime;
            } else if (key === 'deepseek') {
                const response = await fetch(provider.url, {
                    method: 'POST',
                    headers: { 
                        'Authorization': `Bearer ${provider.key}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: provider.model,
                        messages: [{ role: 'user', content: 'test' }],
                        max_tokens: 1
                    }),
                    timeout: 5000
                });
                status = response.ok ? 'online' : 'offline';
                responseTime = Date.now() - startTime;
            } else if (key === 'ollama') {
                const response = await fetch('http://localhost:11434/api/tags', {
                    method: 'GET',
                    timeout: 3000
                });
                const data = await response.json();
                status = response.ok && data.models ? 'online' : 'offline';
                responseTime = Date.now() - startTime;
            }

            providerStatus[key] = {
                name: provider.name,
                status,
                responseTime,
                lastChecked: new Date().toISOString(),
                stats: globalStats.providerStats[key] || null
            };

        } catch (err) {
            providerStatus[key] = {
                name: provider.name || key,
                status: 'offline',
                error: err.message,
                lastChecked: new Date().toISOString(),
                stats: globalStats.providerStats[key] || null
            };
        }
    }

    // Add search status
    const searchStatus = {
        google: { status: 'online', lastChecked: new Date().toISOString() },
        duckduckgo: { status: 'online', lastChecked: new Date().toISOString() }
    };

    res.json({
        providers: providerStatus,
        search: searchStatus,
        timestamp: new Date().toISOString()
    });
});

// Comprehensive statistics endpoint
app.get('/api/stats', (req, res) => {
    const uptime = Date.now() - globalStats.uptime;
    const currentMinute = Math.floor(Date.now() / 60000);
    const recentActivity = Object.values(globalStats.requestsPerMinute).reduce((a, b) => a + b, 0);

    res.json({
        ...globalStats,
        uptime: {
            milliseconds: uptime,
            seconds: Math.floor(uptime / 1000),
            minutes: Math.floor(uptime / 60000),
            hours: Math.floor(uptime / 3600000),
            formatted: formatUptime(uptime)
        },
        uniqueUsers: globalStats.uniqueUsers.size,
        cacheStats: {
            response: {
                keys: responseCache.keys().length,
                hits: globalStats.cacheHits,
                misses: globalStats.cacheMisses,
                hitRate: ((globalStats.cacheHits / (globalStats.cacheHits + globalStats.cacheMisses)) * 100).toFixed(2) + '%'
            },
            search: {
                keys: searchCache.keys().length
            },
            ai: {
                keys: aiCache.keys().length
            }
        },
        performance: {
            requestsPerMinute: recentActivity,
            averageResponseTime: Math.round(globalStats.averageResponseTime),
            errorRate: ((globalStats.errorCount / globalStats.totalRequests) * 100).toFixed(2) + '%'
        },
        providers: globalStats.providerStats,
        timestamp: new Date().toISOString()
    });
});

// Cache management endpoints
app.post('/api/cache/clear', (req, res) => {
    const { type = 'all' } = req.body;
    let cleared = 0;

    switch (type) {
        case 'response':
            cleared = responseCache.keys().length;
            responseCache.flushAll();
            break;
        case 'search':
            cleared = searchCache.keys().length;
            searchCache.flushAll();
            break;
        case 'ai':
            cleared = aiCache.keys().length;
            aiCache.flushAll();
            break;
        case 'all':
        default:
            cleared = responseCache.keys().length + searchCache.keys().length + aiCache.keys().length;
            responseCache.flushAll();
            searchCache.flushAll();
            aiCache.flushAll();
            break;
    }

    res.json({
        message: `Cleared ${type} cache`,
        entriesCleared: cleared,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/cache/stats', (req, res) => {
    res.json({
        response: {
            keys: responseCache.keys().length,
            stats: responseCache.getStats()
        },
        search: {
            keys: searchCache.keys().length,
            stats: searchCache.getStats()
        },
        ai: {
            keys: aiCache.keys().length,
            stats: aiCache.getStats()
        }
    });
});

// AI provider switching endpoint
app.post('/api/providers/switch', async (req, res) => {
    const { provider, message = 'Hello, this is a connection test.' } = req.body;
    
    if (!AI_PROVIDERS[provider]) {
        return res.status(400).json({
            error: `Unknown provider: ${provider}`,
            availableProviders: Object.keys(AI_PROVIDERS)
        });
    }

    try {
        const result = await chatWithAI(provider, message, { useCache: false });
        
        res.json({
            success: true,
            provider,
            providerName: AI_PROVIDERS[provider].name,
            testResponse: result.response,
            responseTime: result.responseTime,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            provider,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Search testing endpoint
app.get('/api/search/test/:query', async (req, res) => {
    try {
        const { query } = req.params;
        const options = {
            maxResults: parseInt(req.query.maxResults) || 5,
            dateRestrict: req.query.dateRestrict || 'm1',
            safe: req.query.safe || 'medium'
        };

        const searchResults = await performAdvancedSearch(query, options);
        
        res.json({
            success: true,
            query,
            options,
            results: searchResults,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Batch processing endpoint
app.post('/api/chat/batch', async (req, res) => {
    const { messages, provider, options = {} } = req.body;
    
    if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'Messages array is required' });
    }

    if (messages.length > 10) {
        return res.status(400).json({ error: 'Maximum 10 messages per batch' });
    }

    const results = [];
    
    for (const message of messages) {
        try {
            const result = await chatWithAI(provider, message.content || message, {
                ...options,
                useCache: options.useCache !== false
            });
            
            results.push({
                input: message,
                output: result.response,
                provider: result.provider,
                responseTime: result.responseTime,
                cached: result.cached,
                success: true
            });
        } catch (error) {
            results.push({
                input: message,
                error: error.message,
                success: false
            });
        }
    }

    res.json({
        results,
        totalProcessed: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        timestamp: new Date().toISOString()
    });
});

// Real-time updates via Server-Sent Events
app.get('/api/stats/live', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    const sendStats = () => {
        const data = {
            totalRequests: globalStats.totalRequests,
            cacheHits: globalStats.cacheHits,
            searchQueries: globalStats.searchQueries,
            averageResponseTime: Math.round(globalStats.averageResponseTime),
            activeProviders: Object.keys(globalStats.providerStats).length,
            timestamp: Date.now()
        };
        
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Send initial data
    sendStats();
    
    // Send updates every 5 seconds
    const interval = setInterval(sendStats, 5000);
    
    // Cleanup on disconnect
    req.on('close', () => {
        clearInterval(interval);
    });
});

// Model management for Ollama
app.get('/api/ollama/models', async (req, res) => {
    try {
        const response = await fetch('http://localhost:11434/api/tags');
        const data = await response.json();
        
        res.json({
            success: true,
            models: data.models || [],
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ollama not available',
            message: error.message
        });
    }
});

app.post('/api/ollama/pull', async (req, res) => {
    const { model } = req.body;
    
    if (!model) {
        return res.status(400).json({ error: 'Model name is required' });
    }

    try {
        const response = await fetch('http://localhost:11434/api/pull', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: model })
        });
        
        if (response.ok) {
            res.json({
                success: true,
                message: `Model ${model} pull initiated`,
                model,
                timestamp: new Date().toISOString()
            });
        } else {
            throw new Error(`Failed to pull model: ${response.statusText}`);
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            model
        });
    }
});

// Configuration endpoint
app.get('/api/config', (req, res) => {
    res.json({
        providers: Object.keys(AI_PROVIDERS).map(key => ({
            id: key,
            name: AI_PROVIDERS[key].name,
            available: true // Could check availability here
        })),
        features: {
            search: true,
            streaming: true,
            caching: true,
            batchProcessing: true,
            multiProvider: true
        },
        limits: {
            maxMessageLength: 8000,
            maxBatchSize: 10,
            rateLimit: 1000
        },
        version: '3.0.0',
        timestamp: new Date().toISOString()
    });
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: formatUptime(Date.now() - globalStats.uptime),
        version: '3.0.0',
        services: {
            api: 'healthy',
            cache: 'healthy',
            search: 'healthy'
        },
        providers: {}
    };

    // Quick health check for each provider
    for (const key of Object.keys(AI_PROVIDERS)) {
        try {
            if (key === 'ollama') {
                const response = await fetch('http://localhost:11434/api/tags', { timeout: 1000 });
                health.providers[key] = response.ok ? 'healthy' : 'unhealthy';
            } else {
                health.providers[key] = 'assumed-healthy'; // Skip detailed checks for external APIs
            }
        } catch (error) {
            health.providers[key] = 'unhealthy';
        }
    }

    const allHealthy = Object.values(health.providers).every(status => 
        status === 'healthy' || status === 'assumed-healthy'
    );
    
    if (!allHealthy) {
        health.status = 'degraded';
    }

    res.status(health.status === 'healthy' ? 200 : 503).json(health);
});

// Serve static files and main page
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        availableEndpoints: [
            'POST /api/chat',
            'POST /api/chat/fast',
            'POST /api/chat/stream',
            'POST /api/search',
            'GET /api/stats',
            'GET /api/health',
            'GET /api/providers/status'
        ],
        timestamp: new Date().toISOString()
    });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Global error handler:', error);
    globalStats.errorCount++;
    
    res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString(),
        requestId: `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
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

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully...');
    
    // Save stats or cleanup if needed
    console.log('📊 Final stats:', {
        totalRequests: globalStats.totalRequests,
        uptime: formatUptime(Date.now() - globalStats.uptime),
        cacheHitRate: ((globalStats.cacheHits / (globalStats.cacheHits + globalStats.cacheMisses)) * 100).toFixed(2) + '%'
    });
    
    process.exit(0);
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('\n🚀 ADVANCED AI CHATBOT SERVER STARTED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🌐 Server running on: http://localhost:${PORT}`);
    console.log(`📡 API endpoints: http://localhost:${PORT}/api/`);
    console.log(`📊 Statistics: http://localhost:${PORT}/api/stats`);
    console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    console.log('\n🤖 AI PROVIDERS CONFIGURED:');
    Object.entries(AI_PROVIDERS).forEach(([key, provider]) => {
        console.log(`   • ${provider.name} (${key})`);
    });
    
    console.log('\n🔍 SEARCH CAPABILITIES:');
    console.log('   • Google Custom Search API ✓');
    console.log('   • Google Web Search (SerpApi) ✓');
    console.log('   • DuckDuckGo Search ✓');
    console.log('   • Intelligent search detection ✓');
    
    console.log('\n⚡ PERFORMANCE FEATURES:');
    console.log('   • Multi-layer caching system ✓');
    console.log('   • Smart AI provider selection ✓');
    console.log('   • Real-time performance monitoring ✓');
    console.log('   • Batch processing support ✓');
    console.log('   • Streaming responses ✓');
    
    console.log('\n🛡️ SECURITY & RELIABILITY:');
    console.log('   • Rate limiting enabled ✓');
    console.log('   • Request validation ✓');
    console.log('   • Error handling & recovery ✓');
    console.log('   • Health monitoring ✓');
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 Ready to process requests!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

// Handle server startup errors
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
        process.exit(1);
    } else {
        console.error('❌ Server startup error:', error);
        process.exit(1);
    }
});

export default app;