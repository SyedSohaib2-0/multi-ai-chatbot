// Railway Database Initialization Script
// Place this file in your backend folder as: init-database.js

import mysql from 'mysql2/promise';
import { config } from 'dotenv';
import bcrypt from 'bcrypt';

// Load environment variables
config();

// Railway MySQL connection configuration
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

async function initializeDatabase() {
    let connection;
    
    try {
        console.log('🔄 Connecting to Railway MySQL...');
        console.log('Host:', dbConfig.host);
        console.log('Database:', dbConfig.database);
        
        // Create connection
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to Railway MySQL successfully!');
        
        // Create users table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE,
                last_login TIMESTAMP NULL
            )
        `);
        console.log('✅ Users table created/verified');
        
        // Create chat_sessions table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id VARCHAR(36) PRIMARY KEY,
                user_id INT NOT NULL,
                title VARCHAR(255) DEFAULT 'New Chat',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        console.log('✅ Chat sessions table created/verified');
        
        // Create chat_messages table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                session_id VARCHAR(36) NOT NULL,
                user_id INT NOT NULL,
                message_type ENUM('user', 'assistant') NOT NULL,
                content TEXT NOT NULL,
                ai_provider VARCHAR(50) NULL,
                ai_model VARCHAR(100) NULL,
                response_time INT NULL,
                tokens_used INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                metadata JSON NULL,
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_session_created (session_id, created_at),
                INDEX idx_user_created (user_id, created_at)
            )
        `);
        console.log('✅ Chat messages table created/verified');
        
        // Create uploaded_files table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS uploaded_files (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                original_name VARCHAR(255) NOT NULL,
                file_path VARCHAR(500) NOT NULL,
                file_size INT NOT NULL,
                mime_type VARCHAR(100) NOT NULL,
                extracted_text LONGTEXT NULL,
                upload_status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_user_created (user_id, created_at)
            )
        `);
        console.log('✅ Uploaded files table created/verified');
        
        // Create api_usage table for tracking
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS api_usage (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                provider VARCHAR(50) NOT NULL,
                model VARCHAR(100) NULL,
                tokens_used INT DEFAULT 0,
                request_count INT DEFAULT 1,
                response_time INT NULL,
                cost_estimate DECIMAL(10,6) NULL,
                date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE KEY unique_user_provider_date (user_id, provider, date),
                INDEX idx_date (date),
                INDEX idx_user_date (user_id, date)
            )
        `);
        console.log('✅ API usage tracking table created/verified');
        
        // Create admin user if not exists
        const adminEmail = 'admin@multi-ai-chatbot.com';
        const adminPassword = 'admin123'; // Change this in production!
        
        const [existingAdmin] = await connection.execute(
            'SELECT id FROM users WHERE email = ?',
            [adminEmail]
        );
        
        if (existingAdmin.length === 0) {
            const hashedPassword = await bcrypt.hash(adminPassword, 12);
            await connection.execute(
                'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
                ['Administrator', adminEmail, hashedPassword]
            );
            console.log('✅ Admin user created');
            console.log(`   Email: ${adminEmail}`);
            console.log(`   Password: ${adminPassword}`);
            console.log('   ⚠️  CHANGE THE ADMIN PASSWORD IMMEDIATELY!');
        } else {
            console.log('ℹ️  Admin user already exists');
        }
        
        // Insert some sample data for testing
        console.log('🔄 Setting up sample data...');
        
        // Create sample session
        const sessionId = 'sample-session-' + Date.now();
        const [adminUser] = await connection.execute(
            'SELECT id FROM users WHERE email = ?',
            [adminEmail]
        );
        
        if (adminUser.length > 0) {
            const userId = adminUser[0].id;
            
            await connection.execute(
                'INSERT IGNORE INTO chat_sessions (id, user_id, title) VALUES (?, ?, ?)',
                [sessionId, userId, 'Welcome Chat']
            );
            
            // Sample messages
            await connection.execute(`
                INSERT IGNORE INTO chat_messages 
                (session_id, user_id, message_type, content, ai_provider, ai_model, response_time) 
                VALUES (?, ?, 'user', 'Hello, test message', NULL, NULL, NULL)
            `, [sessionId, userId]);
            
            await connection.execute(`
                INSERT IGNORE INTO chat_messages 
                (session_id, user_id, message_type, content, ai_provider, ai_model, response_time) 
                VALUES (?, ?, 'assistant', 'Hello! Welcome to Multi-AI Chatbot. I can help you with various tasks using different AI models.', 'openrouter', 'mistral-7b-instruct', 1250)
            `, [sessionId, userId]);
        }
        
        console.log('✅ Sample data inserted');
        
        // Show table status
        const [tables] = await connection.execute(`
            SELECT 
                TABLE_NAME,
                TABLE_ROWS,
                DATA_LENGTH,
                INDEX_LENGTH
            FROM information_schema.TABLES 
            WHERE TABLE_SCHEMA = ?
        `, [dbConfig.database]);
        
        console.log('\n📊 Database Status:');
        tables.forEach(table => {
            console.log(`   ${table.TABLE_NAME}: ${table.TABLE_ROWS} rows`);
        });
        
        console.log('\n🎉 Database initialization completed successfully!');
        console.log('🔗 Connection string format for Railway:');
        console.log(`   mysql://${dbConfig.user}:${dbConfig.password}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
        
    } catch (error) {
        console.error('❌ Database initialization failed:', error.message);
        console.error('Stack:', error.stack);
        
        if (error.code === 'ECONNREFUSED') {
            console.log('\n💡 Railway MySQL Setup:');
            console.log('1. Go to your Railway project dashboard');
            console.log('2. Click "Add Service" → "Database" → "MySQL"');
            console.log('3. Wait for MySQL to deploy');
            console.log('4. Copy the environment variables to your .env file');
            console.log('5. Run this script again');
        }
        
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('🔌 Database connection closed');
        }
    }
}

// Auto-run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    initializeDatabase();
}

export default initializeDatabase;