import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import session from 'express-session';
import MySQLStore from 'express-mysql-session';
import bcrypt from 'bcrypt';
import mysql from 'mysql2/promise';
import { body, validationResult } from 'express-validator';
import multer from 'multer';
import mammoth from 'mammoth';
import PDFExtract from 'pdf.js-extract';
import axios from 'axios';
import NodeCache from 'node-cache';
import fetch from 'node-fetch';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize cache (5 minute TTL by default)
const cache = new NodeCache({ stdTTL: process.env.CACHE_TTL || 300 });

// App statistics
const stats = {
    totalRequests: 0,
    startTime: Date.now(),
    cacheHits: 0,
    errorCount: 0,
    providerRequests: {
        openrouter: 0,
        openai: 0,
        deepseek: 0,
        ollama: 0
    }
};

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
let dbPool;
try {
    dbPool = mysql.createPool({
        ...dbConfig,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        acquireTimeout: 60000,
        timeout: 60000,
        reconnect: true
    });
    console.log('✅ Database pool created successfully');
} catch (error) {
    console.error('❌ Database pool creation failed:', error);
}

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

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

const chatLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 20, // limit each IP to 20 chat requests per minute
    message: { error: 'Too many chat requests, please slow down.' }
});

// File upload configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'application/pdf',
        'text/plain',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Unsupported file type'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
            scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"]
        }
    }
}));

app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://multi-ai-chatbot-production.up.railway.app']
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true
}));

app.use(limiter);
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(compression());

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-super-secret-key-change-this',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    },
    name: 'multi-ai-session'
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Authentication middleware
function requireAuth(req, res, next) {
    if (!req.session?.user) {
        return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    }
    next();
}

// ================= AI PROVIDER FUNCTIONS =================

// OpenRouter API function
async function callOpenRouter(message, options = {}) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        throw new Error('OpenRouter API key not configured');
    }

    const model = options.openrouterModel || 'mistralai/mistral-7b-instruct:free';
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    
    const startTime = Date.now();
    stats.providerRequests.openrouter++;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.SITE_URL || 'http://localhost:3000',
            'X-Title': process.env.APP_NAME || 'Multi-AI Chatbot'
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: message }],
            max_tokens: options.maxTokens || 1000,
            temperature: options.temperature || 0.7
        })
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    const responseTime = Date.now() - startTime;

    return {
        response: data.choices[0]?.message?.content || 'No response generated',
        provider: 'openrouter',
        model,
        responseTime,
        usage: data.usage
    };
}

// OpenAI API function
async function callOpenAI(message, options = {}) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OpenAI API key not configured');
    }

    const startTime = Date.now();
    stats.providerRequests.openai++;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: message }],
            max_tokens: options.maxTokens || 1000,
            temperature: options.temperature || 0.7
        })
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    const responseTime = Date.now() - startTime;

    return {
        response: data.choices[0]?.message?.content || 'No response generated',
        provider: 'openai',
        model: 'gpt-4o-mini',
        responseTime,
        usage: data.usage
    };
}

// DeepSeek API function
async function callDeepSeek(message, options = {}) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        throw new Error('DeepSeek API key not configured');
    }

    const startTime = Date.now();
    stats.providerRequests.deepseek++;

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'deepseek-coder',
            messages: [{ role: 'user', content: message }],
            max_tokens: options.maxTokens || 1000,
            temperature: options.temperature || 0.7
        })
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`DeepSeek API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    const responseTime = Date.now() - startTime;

    return {
        response: data.choices[0]?.message?.content || 'No response generated',
        provider: 'deepseek',
        model: 'deepseek-coder',
        responseTime,
        usage: data.usage
    };
}

// Ollama API function
async function callOllama(message, options = {}) {
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    const startTime = Date.now();
    stats.providerRequests.ollama++;

    try {
        const response = await fetch(`${ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama3.1:8b',
                prompt: message,
                stream: false
            }),
            timeout: 30000
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.status}`);
        }

        const data = await response.json();
        const responseTime = Date.now() - startTime;

        return {
            response: data.response || 'No response generated',
            provider: 'ollama',
            model: 'llama3.1:8b',
            responseTime
        };
    } catch (error) {
        throw new Error(`Ollama connection failed: ${error.message}`);
    }
}

// Smart provider selection
function selectProvider(message, provider = null) {
    if (provider && provider !== 'auto') {
        return provider;
    }

    const lowerMessage = message.toLowerCase();

    // Coding-related queries
    if (lowerMessage.includes('code') || lowerMessage.includes('function') || 
        lowerMessage.includes('javascript') || lowerMessage.includes('python') ||
        lowerMessage.includes('bug') || lowerMessage.includes('debug')) {
        return process.env.DEEPSEEK_API_KEY ? 'deepseek' : 'openrouter';
    }

    // Creative tasks
    if (lowerMessage.includes('write') || lowerMessage.includes('story') ||
        lowerMessage.includes('creative') || lowerMessage.includes('poem')) {
        return process.env.OPENAI_API_KEY ? 'openai' : 'openrouter';
    }

    // Default to OpenRouter for general queries
    if (process.env.OPENROUTER_API_KEY) return 'openrouter';
    if (process.env.OPENAI_API_KEY) return 'openai';
    if (process.env.DEEPSEEK_API_KEY) return 'deepseek';
    
    return 'ollama'; // Fallback to local
}

// Multi-provider chat function with fallback
async function processChat(message, provider = null, options = {}) {
    const selectedProvider = selectProvider(message, provider);
    
    const providers = {
        openrouter: callOpenRouter,
        openai: callOpenAI,
        deepseek: callDeepSeek,
        ollama: callOllama
    };

    const fallbackOrder = ['openrouter', 'openai', 'deepseek', 'ollama'];
    
    // Try selected provider first
    try {
        const providerFunction = providers[selectedProvider];
        if (providerFunction) {
            return await providerFunction(message, options);
        }
    } catch (error) {
        console.warn(`Primary provider ${selectedProvider} failed:`, error.message);
    }

    // Try fallback providers
    for (const fallbackProvider of fallbackOrder) {
        if (fallbackProvider === selectedProvider) continue;
        
        try {
            const providerFunction = providers[fallbackProvider];
            if (providerFunction) {
                const result = await providerFunction(message, options);
                result.fallbackUsed = true;
                result.originalProvider = selectedProvider;
                return result;
            }
        } catch (error) {
            console.warn(`Fallback provider ${fallbackProvider} failed:`, error.message);
            continue;
        }
    }

    throw new Error('All AI providers failed');
}

// File processing functions
async function extractTextFromFile(filePath, mimeType) {
    try {
        switch (mimeType) {
            case 'text/plain':
                return fs.readFileSync(filePath, 'utf8');

            case 'application/pdf':
                const pdfExtract = new PDFExtract();
                const pdfData = await new Promise((resolve, reject) => {
                    pdfExtract.extract(filePath, {}, (err, data) => {
                        if (err) reject(err);
                        else resolve(data);
                    });
                });
                return pdfData.pages.map(page => 
                    page.content.map(item => item.str).join(' ')
                ).join('\n\n');

            case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                const docxResult = await mammoth.extractRawText({ path: filePath });
                return docxResult.value;

            case 'application/msword':
                // Basic DOC support - might need additional libraries
                return fs.readFileSync(filePath, 'utf8');

            default:
                throw new Error('Unsupported file type for text extraction');
        }
    } catch (error) {
        console.error('Text extraction error:', error);
        throw new Error(`Failed to extract text: ${error.message}`);
    }
}

// ================= AUTH ROUTES =================

app.post('/api/auth/register', [
    body('name').trim().isLength({ min: 2, max: 100 }).escape(),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: 'Validation failed', details: errors.array() });
        }

        const { name, email, password } = req.body;
        
        const [existing] = await dbPool.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Email already registered', code: 'EMAIL_EXISTS' });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const [result] = await dbPool.execute(
            'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
            [name, email, passwordHash]
        );

        req.session.user = { id: result.insertId, name, email };

        res.status(201).json({
            message: 'Account created successfully',
            user: { id: result.insertId, name, email }
        });
    } catch (error) {
        console.error('Registration error:', error);
        stats.errorCount++;
        res.status(500).json({ error: 'Registration failed', message: error.message });
    }
});

app.post('/api/auth/login', [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: 'Validation failed', details: errors.array() });
        }

        const { email, password } = req.body;
        
        const [users] = await dbPool.execute(
            'SELECT id, name, email, password_hash FROM users WHERE email = ? AND is_active = TRUE',
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
        }

        const user = users[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
        }

        await dbPool.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
        req.session.user = { id: user.id, name: user.name, email: user.email };

        res.json({
            message: 'Login successful',
            user: { id: user.id, name: user.name, email: user.email }
        });
    } catch (error) {
        console.error('Login error:', error);
        stats.errorCount++;
        res.status(500).json({ error: 'Login failed', message: error.message });
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.clearCookie('multi-ai-session');
        res.json({ message: 'Logged out successfully' });
    });
});

app.get('/api/auth/me', (req, res) => {
    if (req.session?.user) {
        res.json({ user: req.session.user });
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

// ================= FILE UPLOAD ROUTES =================

app.post('/api/files/upload', requireAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const userId = req.session.user.id;
        const filePath = req.file.path;
        
        // Extract text from the uploaded file
        let extractedText = '';
        try {
            extractedText = await extractTextFromFile(filePath, req.file.mimetype);
        } catch (error) {
            console.warn('Text extraction failed:', error.message);
            extractedText = 'Text extraction failed for this file type.';
        }

        // Save file info to database
        const [result] = await dbPool.execute(`
            INSERT INTO uploaded_files 
            (user_id, original_name, file_path, file_size, mime_type, extracted_text, upload_status) 
            VALUES (?, ?, ?, ?, ?, ?, 'completed')
        `, [userId, req.file.originalname, filePath, req.file.size, req.file.mimetype, extractedText]);

        res.json({
            message: 'File uploaded successfully',
            file: {
                id: result.insertId,
                name: req.file.originalname,
                size: req.file.size,
                type: req.file.mimetype,
                textLength: extractedText.length,
                preview: extractedText.substring(0, 200) + (extractedText.length > 200 ? '...' : '')
            }
        });
    } catch (error) {
        console.error('File upload error:', error);
        stats.errorCount++;
        res.status(500).json({ error: 'File upload failed', message: error.message });
    }
});

app.get('/api/files', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const [files] = await dbPool.execute(`
            SELECT id, original_name, file_size, mime_type, upload_status, created_at,
                   SUBSTRING(extracted_text, 1, 200) as preview
            FROM uploaded_files 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT 50
        `, [userId]);

        res.json({ files });
    } catch (error) {
        console.error('Files fetch error:', error);
        stats.errorCount++;
        res.status(500).json({ error: 'Failed to fetch files' });
    }
});

app.delete('/api/files/:fileId', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { fileId } = req.params;

        const [files] = await dbPool.execute(
            'SELECT file_path FROM uploaded_files WHERE id = ? AND user_id = ?',
            [fileId, userId]
        );

        if (files.length === 0) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Delete physical file
        const filePath = files[0].file_path;
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        // Delete database record
        await dbPool.execute('DELETE FROM uploaded_files WHERE id = ? AND user_id = ?', [fileId, userId]);

        res.json({ message: 'File deleted successfully' });
    } catch (error) {
        console.error('File deletion error:', error);
        stats.errorCount++;
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

// ================= CHAT ROUTES =================

app.post('/api/chat', requireAuth, chatLimiter, async (req, res) => {
    const startTime = Date.now();
    const userId = req.session.user.id;
    stats.totalRequests++;

    try {
        const { message, provider, options = {}, fileContext = null } = req.body;
        
        if (!message || message.trim().length === 0) {
            return res.status(400).json({ error: 'Message is required', code: 'EMPTY_MESSAGE' });
        }

        let contextualMessage = message;

        // Add file context if provided
        if (fileContext && fileContext.fileId) {
            const [files] = await dbPool.execute(
                'SELECT extracted_text FROM uploaded_files WHERE id = ? AND user_id = ?',
                [fileContext.fileId, userId]
            );

            if (files.length > 0 && files[0].extracted_text) {
                const fileText = files[0].extracted_text;
                contextualMessage = `Context from uploaded file:\n\n${fileText}\n\nUser question: ${message}`;
            }
        }

        // Check cache first
        const cacheKey = `chat:${JSON.stringify({ message: contextualMessage, provider, options })}`;
        const cachedResult = cache.get(cacheKey);
        
        if (cachedResult) {
            stats.cacheHits++;
            return res.json({
                reply: cachedResult.response,
                metadata: {
                    ...cachedResult,
                    cached: true,
                    totalTime: Date.now() - startTime
                }
            });
        }

        // Process with AI
        const aiResult = await processChat(contextualMessage, provider, options);

        // Cache the result
        cache.set(cacheKey, aiResult);

        const totalTime = Date.now() - startTime;

        res.json({
            reply: aiResult.response,
            metadata: {
                provider: aiResult.provider,
                model: aiResult.model,
                responseTime: aiResult.responseTime,
                totalTime,
                cached: false,
                fallbackUsed: aiResult.fallbackUsed || false,
                originalProvider: aiResult.originalProvider,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Chat error:', error);
        stats.errorCount++;
        
        res.status(500).json({
            error: 'Chat request failed',
            message: error.message,
            totalTime: Date.now() - startTime
        });
    }
});

app.post('/api/chat/fast', requireAuth, chatLimiter, async (req, res) => {
    const startTime = Date.now();
    stats.totalRequests++;

    try {
        const { message } = req.body;
        
        if (!message || message.trim().length === 0) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Use fastest available provider with minimal options
        const fastOptions = { maxTokens: 500, temperature: 0.5 };
        const aiResult = await processChat(message, 'openrouter', fastOptions);

        res.json({
            reply: aiResult.response,
            provider: aiResult.provider,
            model: aiResult.model,
            responseTime: aiResult.responseTime,
            totalTime: Date.now() - startTime,
            mode: 'fast'
        });

    } catch (error) {
        console.error('Fast chat error:', error);
        stats.errorCount++;
        res.status(500).json({ error: 'Fast chat failed', message: error.message });
    }
});

// ================= SYSTEM ROUTES =================

app.get('/api/health', async (req, res) => {
    try {
        // Check database connection
        await dbPool.execute('SELECT 1');
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: Math.floor((Date.now() - stats.startTime) / 1000),
            database: 'connected',
            cache: cache.getStats(),
            version: '2.1.0'
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            database: 'disconnected',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/api/stats', (req, res) => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
    
    res.json({
        ...stats,
        uptime: {
            seconds: uptime,
            formatted: formatUptime(uptime)
        },
        cache: cache.getStats(),
        timestamp: new Date().toISOString()
    });
});

app.get('/api/providers/status', async (req, res) => {
    const providerStatus = {};

    // Check OpenRouter
    providerStatus.openrouter = {
        configured: !!process.env.OPENROUTER_API_KEY,
        status: process.env.OPENROUTER_API_KEY ? 'configured' : 'not-configured'
    };

    // Check OpenAI
    providerStatus.openai = {
        configured: !!process.env.OPENAI_API_KEY,
        status: process.env.OPENAI_API_KEY ? 'configured' : 'not-configured'
    };

    // Check DeepSeek
    providerStatus.deepseek = {
        configured: !!process.env.DEEPSEEK_API_KEY,
        status: process.env.DEEPSEEK_API_KEY ? 'configured' : 'not-configured'
    };

    // Check Ollama
    try {
        const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
        const response = await fetch(`${ollamaUrl}/api/tags`, { timeout: 5000 });
        providerStatus.ollama = {
            configured: true,
            status: response.ok ? 'online' : 'offline',
            url: ollamaUrl
        };
    } catch (error) {
        providerStatus.ollama = {
            configured: false,
            status: 'offline',
            error: error.message
        };
    }

    res.json({ providers: providerStatus });
});

app.get('/api/openrouter/models', (req, res) => {
    const models = [
        { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B (Free)', free: true },
        { id: 'mistralai/mixtral-8x7b-instruct:free', name: 'Mixtral 8x7B (Free)', free: true },
        { id: 'meta-llama/llama-3.1-8b-instruct:free', name: 'Llama 3.1 8B (Free)', free: true },
        { id: 'qwen/qwen-2.5-7b-instruct:free', name: 'Qwen 2.5 7B (Free)', free: true },
        { id: 'deepseek/deepseek-coder-6.7b-instruct:free', name: 'DeepSeek Coder (Free)', free: true },
        { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', free: false, premium: true },
        { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus', free: false, premium: true },
        { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', free: false, premium: true },
        { id: 'openai/gpt-4o', name: 'GPT-4o', free: false, premium: true },
        { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', free: false, premium: true },
        { id: 'google/gemini-1.5-pro', name: 'Gemini 1.5 Pro', free: false, premium: true },
        { id: 'google/gemini-1.5-flash', name: 'Gemini 1.5 Flash', free: false, premium: true },
        { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', free: false, premium: true },
        { id: 'meta-llama/llama-3.1-405b-instruct', name: 'Llama 3.1 405B', free: false, premium: true }
    ];
    
    res.json({ models });
});

app.post('/api/cache/clear', (req, res) => {
    const entriesCleared = cache.keys().length;
    cache.flushAll();
    
    res.json({ 
        message: 'Cache cleared successfully', 
        entriesCleared,
        timestamp: new Date().toISOString()
    });
});

// ================= CHAT HISTORY ROUTES =================

app.get('/api/chat/sessions', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const [sessions] = await dbPool.execute(`
            SELECT cs.id, cs.title, cs.created_at, cs.updated_at, 
                   COUNT(cm.id) as message_count, 
                   MAX(cm.created_at) as last_message_at
            FROM chat_sessions cs
            LEFT JOIN chat_messages cm ON cs.id = cm.session_id
            WHERE cs.user_id = ? AND cs.is_active = TRUE
            GROUP BY cs.id, cs.title, cs.created_at, cs.updated_at
            ORDER BY cs.updated_at DESC
            LIMIT 50
        `, [userId]);

        res.json({ sessions });
    } catch (error) {
        console.error('Sessions fetch error:', error);
        stats.errorCount++;
        res.status(500).json({ error: 'Failed to fetch chat sessions' });
    }
});

app.get('/api/chat/sessions/:sessionId/messages', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { sessionId } = req.params;
        
        const [messages] = await dbPool.execute(`
            SELECT id, message_type, content, ai_provider, ai_model, 
                   response_time, created_at, metadata
            FROM chat_messages 
            WHERE session_id = ? AND user_id = ?
            ORDER BY created_at ASC
            LIMIT 100
        `, [sessionId, userId]);

        res.json({ messages });
    } catch (error) {
        console.error('Messages fetch error:', error);
        stats.errorCount++;
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

app.post('/api/chat/sessions', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { title = 'New Chat' } = req.body;
        const sessionId = `session_${userId}_${Date.now()}`;

        await dbPool.execute(
            'INSERT INTO chat_sessions (id, user_id, title) VALUES (?, ?, ?)',
            [sessionId, userId, title]
        );

        res.json({ 
            sessionId, 
            title, 
            message: 'Chat session created successfully' 
        });
    } catch (error) {
        console.error('Session creation error:', error);
        stats.errorCount++;
        res.status(500).json({ error: 'Failed to create chat session' });
    }
});

app.delete('/api/chat/sessions/:sessionId', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { sessionId } = req.params;

        await dbPool.execute(
            'UPDATE chat_sessions SET is_active = FALSE WHERE id = ? AND user_id = ?',
            [sessionId, userId]
        );

        res.json({ message: 'Chat session deleted successfully' });
    } catch (error) {
        console.error('Session deletion error:', error);
        stats.errorCount++;
        res.status(500).json({ error: 'Failed to delete chat session' });
    }
});

// ================= UTILITY FUNCTIONS =================

function formatUptime(seconds) {
    const days = Math.floor(seconds / (24 * 60 * 60));
    const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((seconds % (60 * 60)) / 60);
    const secs = seconds % 60;
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0) parts.push(`${secs}s`);
    
    return parts.join(' ') || '0s';
}

// ================= STATIC FILE SERVING =================

// Root → always check authentication first
app.get('/', (req, res) => {
    if (!req.session?.user) {
        return res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login page → if already logged in, redirect to chatbot
app.get('/login.html', (req, res) => {
    if (req.session?.user) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Register page → if already logged in, redirect to chatbot
app.get('/register.html', (req, res) => {
    if (req.session?.user) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Serve static files (CSS, JS, images, etc.)
app.use(express.static(path.join(__dirname, 'public')));


// ================= ERROR HANDLING =================

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Endpoint not found',
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Global error handler:', error);
    stats.errorCount++;
    
    // Multer error handling
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large (max 10MB)' });
        }
        return res.status(400).json({ error: `Upload error: ${error.message}` });
    }
    
    // File filter errors
    if (error.message === 'Unsupported file type') {
        return res.status(400).json({ error: 'Unsupported file type. Please upload PDF, TXT, DOC, or DOCX files.' });
    }
    
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
        timestamp: new Date().toISOString()
    });
});

// ================= DATABASE INITIALIZATION =================

async function initializeDatabase() {
    if (!dbPool) {
        console.warn('⚠️  Database pool not available, skipping initialization');
        return;
    }

    try {
        console.log('🔄 Checking database tables...');
        
        // Test connection
        await dbPool.execute('SELECT 1');
        console.log('✅ Database connection successful');

        // Check if tables exist
        const [tables] = await dbPool.execute(`
            SELECT TABLE_NAME 
            FROM information_schema.TABLES 
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('users', 'chat_sessions', 'chat_messages', 'uploaded_files')
        `, [dbConfig.database]);

        const existingTables = tables.map(t => t.TABLE_NAME);
        const requiredTables = ['users', 'chat_sessions', 'chat_messages', 'uploaded_files'];
        const missingTables = requiredTables.filter(table => !existingTables.includes(table));

        if (missingTables.length > 0) {
            console.log('⚠️  Missing tables:', missingTables.join(', '));
            console.log('🔧 Please run the database initialization script:');
            console.log('   node init-database.js');
        } else {
            console.log('✅ All required database tables exist');
        }

    } catch (error) {
        console.error('❌ Database initialization check failed:', error.message);
        console.log('🔧 Please ensure MySQL is running and database is configured');
    }
}

// ================= SERVER STARTUP =================

async function startServer() {
    try {
        // Initialize database
        await initializeDatabase();
        
        // Start the server
        app.listen(PORT, () => {
            console.log('\n🚀 Multi-AI Chatbot Server Started!');
            console.log('=======================================');
            console.log(`📍 Server URL: http://localhost:${PORT}`);
            console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log('📊 API Endpoints:');
            console.log('   • POST /api/auth/register - User registration');
            console.log('   • POST /api/auth/login - User login');
            console.log('   • POST /api/chat - Main chat endpoint');
            console.log('   • POST /api/chat/fast - Fast responses');
            console.log('   • POST /api/files/upload - File upload');
            console.log('   • GET  /api/health - Health check');
            console.log('   • GET  /api/stats - Server statistics');
            
            console.log('\n🤖 Configured AI Providers:');
            console.log(`   • OpenRouter: ${process.env.OPENROUTER_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
            console.log(`   • OpenAI: ${process.env.OPENAI_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
            console.log(`   • DeepSeek: ${process.env.DEEPSEEK_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
            console.log(`   • Ollama: ${process.env.OLLAMA_URL || 'http://localhost:11434'}`);
            
            console.log('\n💾 Database:');
            console.log(`   • Host: ${dbConfig.host}:${dbConfig.port}`);
            console.log(`   • Database: ${dbConfig.database}`);
            console.log(`   • SSL: ${dbConfig.ssl ? 'Enabled' : 'Disabled'}`);
            
            console.log('\n🔧 Cache & Session:');
            console.log(`   • Cache TTL: ${process.env.CACHE_TTL || 300} seconds`);
            console.log(`   • Session Store: MySQL`);
            
            console.log('\n📁 File Upload:');
            console.log('   • Max Size: 10MB');
            console.log('   • Supported: PDF, TXT, DOC, DOCX');
            console.log('   • Text Extraction: Enabled');
            
            console.log('\n=======================================');
            console.log('🎉 Ready to serve AI-powered conversations!');
        });

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// ================= GRACEFUL SHUTDOWN =================

process.on('SIGTERM', async () => {
    console.log('🔄 Received SIGTERM, shutting down gracefully...');
    
    if (dbPool) {
        await dbPool.end();
        console.log('📝 Database connections closed');
    }
    
    console.log('✅ Shutdown complete');
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('\n🔄 Received SIGINT, shutting down gracefully...');
    
    if (dbPool) {
        await dbPool.end();
        console.log('📝 Database connections closed');
    }
    
    console.log('✅ Shutdown complete');
    process.exit(0);
});

// Start the server
startServer();