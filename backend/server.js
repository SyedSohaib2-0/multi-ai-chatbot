import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import NodeCache from 'node-cache';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import MySQLStore from 'express-mysql-session';
import bcrypt from 'bcrypt';
import mysql from 'mysql2/promise';
import { body, validationResult } from 'express-validator';

// Load environment variables
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express app FIRST
const app = express();
const PORT = process.env.PORT || 3000;

// Database configuration for Railway
const dbConfig = {
    host: process.env.MYSQLHOST || 'localhost',
    port: process.env.MYSQLPORT || 3306,
    user: process.env.MYSQLUSER || 'root',
    password: process.env.MYSQLPASSWORD || 'password',
    database: process.env.MYSQLDATABASE || 'railway',
    ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
    } : false
};

// Create MySQL connection pool
const dbPool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Session store configuration
const MySQLStoreSession = MySQLStore(session);
const sessionStore = new MySQLStoreSession({
    ...dbConfig,
    clearExpired: true,
    checkExpirationInterval: 900000, // 15 minutes
    expiration: 86400000, // 24 hours
    createDatabaseTable: true,
    schema: {
        tableName: 'sessions',
        columnNames: {
            session_id: 'session_id',
            expires: 'expires',
            data: 'data'
        }
    }
});

// Middleware
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? [process.env.FRONTEND_URL] 
        : ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-super-secret-key-change-this',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    },
    name: 'multi-ai-session'
}));

// Cache system
const cache = new NodeCache({ stdTTL: parseInt(process.env.CACHE_TTL) || 300 }); // Default 5 minutes

// AI Provider Configuration with CORRECT OpenRouter Models
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
        
        // CORRECTED MODEL IDENTIFIERS
        models: {
            // FREE MODELS (Correct identifiers)
            'mistral-7b-free': 'mistralai/mistral-7b-instruct:free',
            'mixtral-8x7b-free': 'mistralai/mixtral-8x7b-instruct:free',
            'llama-3.1-8b-free': 'meta-llama/llama-3.1-8b-instruct:free',
            'qwen-2.5-7b-free': 'qwen/qwen-2.5-7b-instruct:free',
            'gemma-2-9b-free': 'google/gemma-2-9b-it:free',
            'hermes-mixtral-free': 'nousresearch/nous-hermes-2-mixtral-8x7b-dpo:free',
            'deepseek-coder-free': 'deepseek/deepseek-coder-6.7b-instruct:free',
            'zephyr-7b-free': 'huggingfaceh4/zephyr-7b-beta:free',
            
            // PREMIUM MODELS (Corrected)
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
        
        // SET TO WORKING FREE MODEL
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

// Authentication middleware
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ 
            error: 'Authentication required',
            code: 'AUTH_REQUIRED' 
        });
    }
    next();
}

// Optional authentication middleware (allows both authenticated and guest users)
function optionalAuth(req, res, next) {
    // Just pass through, authentication is optional
    next();
}

// Initialize database tables
async function initializeDatabase() {
    try {
        // Create users table
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP NULL,
                INDEX idx_email (email),
                INDEX idx_active (is_active)
            )
        `);

        // Create chat_messages table
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                session_id VARCHAR(255) NOT NULL,
                user_id INT NOT NULL,
                message_type ENUM('user', 'assistant') NOT NULL,
                content TEXT NOT NULL,
                ai_provider VARCHAR(50) NULL,
                ai_model VARCHAR(100) NULL,
                response_time INT NULL,
                metadata JSON NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_session (session_id),
                INDEX idx_user (user_id),
                INDEX idx_created (created_at)
            )
        `);

        // Create api_usage table
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS api_usage (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                provider VARCHAR(50) NOT NULL,
                model VARCHAR(100) NOT NULL,
                request_count INT DEFAULT 1,
                tokens_used INT DEFAULT 0,
                response_time FLOAT DEFAULT 0,
                date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE KEY unique_user_provider_model_date (user_id, provider, model, date),
                INDEX idx_user_date (user_id, date),
                INDEX idx_provider (provider)
            )
        `);

        console.log('Database tables initialized successfully');
    } catch (error) {
        console.error('Database initialization error:', error);
        console.log('Server will continue but database features may not work');
    }
}

// [Rest of your helper functions go here - I'll add just the essential ones for brevity]

// Enhanced smart AI provider selection with OpenRouter prioritization
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

// [Add all your chat functions here: chatWithOpenRouter, chatWithOllama, chatWithOpenAI, chatWithDeepSeek, chatWithAI]
// I'm not including them all here for brevity, but copy them from your original file

// Define all your routes here
// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: formatUptime(Date.now() - stats.uptime),
        version: '2.1.0',
        features: ['authentication', 'chat-history', 'multi-provider', 'guest-mode'],
        providers: {
            total: Object.keys(AI_PROVIDERS).length,
            configured: Object.values(AI_PROVIDERS).filter(p => 
                !p.key?.includes('your-') && p.key !== undefined
            ).length
        }
    });
});

// [Add all your other routes here from the original file]

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Enhanced 404 handler - This should be one of the last routes
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl,
        method: req.method,
        availableEndpoints: {
            auth: [
                'POST /api/auth/register - Create account',
                'POST /api/auth/login - Login',
                'POST /api/auth/logout - Logout',
                'GET /api/auth/me - Get current user'
            ],
            chat: [
                'POST /api/chat - Main chat (auth required)',
                'POST /api/chat/guest - Guest chat (no auth)',
                'POST /api/chat/fast - Fast responses',
                'POST /api/test/model - Test specific model'
            ],
            history: [
                'GET /api/chat/sessions - Chat sessions (auth required)',
                'GET /api/chat/sessions/:id/messages - Session messages',
                'DELETE /api/chat/sessions/:id - Delete session'
            ],
            user: [
                'GET /api/user/dashboard - User dashboard (auth required)'
            ],
            info: [
                'GET /api/providers/status - Provider status',
                'GET /api/stats - Server statistics',
                'GET /api/health - Health check',
                'GET /api/db/health - Database health'
            ],
            models: [
                'GET /api/openrouter/models - OpenRouter models',
                'GET /api/ollama/models - Ollama models',
                'GET /api/models/recommend - Model recommendations'
            ],
            utils: [
                'POST /api/cache/clear - Clear cache (auth required)'
            ]
        },
        timestamp: new Date().toISOString()
    });
});

// Error handler - This should be the last middleware
app.use((error, req, res, next) => {
    console.error('Global error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
        path: req.path,
        timestamp: new Date().toISOString()
    });
});

// NOW we can start the server - at the END of the file
const server = app.listen(PORT, '0.0.0.0', async () => {
    console.log('\n🚀 MULTI-AI CHATBOT SERVER v2.1 WITH AUTHENTICATION');
    console.log('═'.repeat(70));
    console.log(`🌐 Server: http://localhost:${PORT}`);
    console.log(`📡 API: http://localhost:${PORT}/api/`);
    console.log(`🏥 Health: http://localhost:${PORT}/api/health`);
    console.log(`📊 Stats: http://localhost:${PORT}/api/stats`);
    console.log(`🗄️ Database: http://localhost:${PORT}/api/db/health`);
    console.log('═'.repeat(70));
    console.log('\n🤖 AI PROVIDERS:');
    console.log('   • 🌟 OpenRouter (400+ Models) - Primary');
    console.log('   • 🏠 Ollama Local (Fast Responses)');
    console.log('   • 🚀 OpenAI GPT-4 (Premium Fallback)');
    console.log('   • 🔥 DeepSeek (Code & Chat)');
    console.log('\n✨ FEATURES:');
    console.log('   • 🔐 User Authentication & Registration');
    console.log('   • 💬 Chat History & Session Management');
    console.log('   • 👥 Guest Mode (No Registration Required)');
    console.log('   • 🧠 Smart provider/model selection');
    console.log('   • 🆓 Free & premium model access via OpenRouter');
    console.log('   • 🔄 Automatic fallback on errors/rate limits');
    console.log('   • ⚡ Intelligent caching system');
    console.log('   • 📈 Performance monitoring & statistics');
    console.log('   • 🏃‍♂️ Fast response mode');
    console.log('   • 🎯 Model testing & recommendations');
    console.log('   • 📊 User dashboard & usage analytics');
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
    
    // Initialize database
    console.log('\n🗄️ INITIALIZING DATABASE...');
    await initializeDatabase();
    
    // Show configuration status
    console.log('\n🔧 CONFIGURATION STATUS:');
    const openRouterConfigured = !AI_PROVIDERS.openrouter.key.includes('your-openrouter-key-here');
    const openAiConfigured = !AI_PROVIDERS.openai.key.includes('your-openai-key-here');
    const deepSeekConfigured = !AI_PROVIDERS.deepseek.key.includes('your-deepseek-key-here');
    const sessionSecretConfigured = process.env.SESSION_SECRET && !process.env.SESSION_SECRET.includes('your-super-secret-key');
    
    console.log(`   • OpenRouter: ${openRouterConfigured ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   • OpenAI: ${openAiConfigured ? '✅ Configured' : '⚠️ Optional'}`);
    console.log(`   • DeepSeek: ${deepSeekConfigured ? '✅ Configured' : '⚠️ Optional'}`);
    console.log(`   • Session Secret: ${sessionSecretConfigured ? '✅ Configured' : '⚠️ Using default (change in production!)'}`);
    console.log(`   • Database: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
    console.log(`   • Ollama: ⏳ Checking connection...`);
    
    // Test database connection
    try {
        const [result] = await dbPool.execute('SELECT 1 as healthy');
        console.log('   • Database Connection: ✅ Connected');
    } catch (error) {
        console.log('   • Database Connection: ❌ Failed -', error.message);
    }
    
    if (!openRouterConfigured) {
        console.log('\n⚠️ To access premium models:');
        console.log('   1. Get API key from https://openrouter.ai');
        console.log('   2. Add OPENROUTER_API_KEY to your .env file');
        console.log('   3. Restart server');
    }
    
    if (!sessionSecretConfigured) {
        console.log('\n🔒 SECURITY WARNING:');
        console.log('   • Set SESSION_SECRET in your .env file for production!');
        console.log('   • Generate a secure random string (32+ characters)');
    }
    
    console.log('\n🔑 AUTHENTICATION ENDPOINTS:');
    console.log('   • POST /api/auth/register - Create new account');
    console.log('   • POST /api/auth/login - Login existing user');
    console.log('   • POST /api/auth/logout - Logout current user');
    console.log('   • GET /api/auth/me - Get current user info');
    
    console.log('\n💬 CHAT ENDPOINTS:');
    console.log('   • POST /api/chat - Authenticated chat (full features)');
    console.log('   • POST /api/chat/guest - Guest chat (limited features)');
    console.log('   • GET /api/chat/sessions - Chat history (auth required)');
    console.log('   • GET /api/user/dashboard - User analytics (auth required)');
    
    console.log('\n🎉 Server ready! Try these actions:');
    console.log('   1. Register a new account: POST /api/auth/register');
    console.log('   2. Login: POST /api/auth/login');
    console.log('   3. Start chatting: POST /api/chat');
    console.log('   4. Or try guest mode: POST /api/chat/guest\n');
    
    // Test Ollama connection
    fetch(`${AI_PROVIDERS.ollama.url}/api/tags`, { signal: AbortSignal.timeout(3000) })
        .then(response => response.ok ? 
            console.log('   • Ollama: ✅ Connected successfully') : 
            console.log('   • Ollama: ⚠️ Not running (optional)')
        )
        .catch(() => console.log('   • Ollama: ⚠️ Not available (run: ollama serve)'));
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

// Graceful shutdown with cleanup
process.on('SIGTERM', () => {
    console.log('Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        cache.close();
        dbPool.end();
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        cache.close();
        dbPool.end();
        process.exit(0);
    });
});

// Export for testing
export default app;