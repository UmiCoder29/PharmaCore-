import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getDataDir } from './paths.js';

dotenv.config();

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

// Polyfill WebSocket for Supabase Realtime in Node.js/Electron main process if needed
if (typeof globalThis.WebSocket === 'undefined') {
    globalThis.WebSocket = WebSocket;
}

const DEFAULT_SUPABASE_URL = process.env.SUPABASE_URL || '';
const DEFAULT_SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';

let _supabaseUrl = DEFAULT_SUPABASE_URL;
let _supabaseAnonKey = DEFAULT_SUPABASE_ANON_KEY;

let _supabaseClient = null;

let _isOnline = false;
let _lastChecked = null;
let _pingInterval = null;

function getDbConfigPath() {
    try {
        return path.join(getDataDir(), 'db-config.json');
    } catch {
        return null;
    }
}

/**
 * Loads dynamic database configuration from persistent storage if exists
 */
export function loadDatabaseConfig() {
    try {
        const configPath = getDbConfigPath();
        if (configPath && fs.existsSync(configPath)) {
            const raw = fs.readFileSync(configPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed.supabaseUrl) _supabaseUrl = parsed.supabaseUrl.trim();
            if (parsed.supabaseAnonKey) _supabaseAnonKey = parsed.supabaseAnonKey.trim();
            console.log('[SupabaseClient] Loaded custom database credentials from db-config.json');
        }
    } catch (e) {
        console.warn('[SupabaseClient] Could not load db-config.json, using environment defaults:', e.message);
    }
    return {
        supabaseUrl: _supabaseUrl,
        supabaseAnonKey: _supabaseAnonKey
    };
}

/**
 * Saves new database configuration to persistent storage and re-initializes clients
 */
export async function saveDatabaseConfig({ supabaseUrl, supabaseAnonKey }) {
    if (supabaseUrl) _supabaseUrl = supabaseUrl.trim();
    if (supabaseAnonKey) _supabaseAnonKey = supabaseAnonKey.trim();

    try {
        const configPath = getDbConfigPath();
        if (configPath) {
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({
                supabaseUrl: _supabaseUrl,
                supabaseAnonKey: _supabaseAnonKey,
                updatedAt: new Date().toISOString()
            }, null, 2), 'utf8');
        }
    } catch (e) {
        console.error('[SupabaseClient] Failed to save db-config.json:', e);
    }

    // Re-initialize clients
    clearSupabase();
    initSupabase();
    return { success: true };
}

/**
 * Tests connection to a given Supabase / PostgreSQL project using Anon key
 */
export async function testDatabaseConnection({ supabaseUrl, supabaseAnonKey }) {
    const testUrl = (supabaseUrl || _supabaseUrl).trim();
    const testAnonKey = (supabaseAnonKey || _supabaseAnonKey).trim();

    if (!testUrl || !testAnonKey) {
        return {
            success: false,
            projectUrl: testUrl,
            latencyMs: 0,
            error: 'Missing Supabase URL or Publishable/Anon Key.'
        };
    }

    const start = Date.now();
    try {
        // Test Anon REST connectivity
        const res = await fetch(`${testUrl}/rest/v1/?apikey=${testAnonKey}`, {
            method: 'HEAD',
            headers: { 'apikey': testAnonKey }
        });
        const latencyMs = Date.now() - start;

        if (!res) throw new Error('Could not reach REST endpoint.');

        return {
            success: true,
            projectUrl: testUrl,
            latencyMs,
            message: `Connected successfully (${latencyMs}ms response time).`
        };
    } catch (err) {
        return {
            success: false,
            projectUrl: testUrl,
            latencyMs: Date.now() - start,
            error: err.message || 'Connection failed.'
        };
    }
}

/**
 * Checks connection to Supabase REST endpoint to determine online status
 */
async function pingSupabase() {
    if (!_supabaseUrl || !_supabaseAnonKey) {
        _isOnline = false;
        _lastChecked = new Date().toISOString();
        return;
    }
    try {
        const response = await fetch(`${_supabaseUrl}/rest/v1/?apikey=${_supabaseAnonKey}`, {
            method: 'HEAD',
            headers: { 'apikey': _supabaseAnonKey }
        });
        _isOnline = !!response; 
        _lastChecked = new Date().toISOString();
    } catch (error) {
        _isOnline = false;
        _lastChecked = new Date().toISOString();
    }
}

export function startPing() {
    if (_pingInterval) {
        clearInterval(_pingInterval);
    }
    pingSupabase();
    _pingInterval = setInterval(pingSupabase, 10000);
}

export function stopPing() {
    if (_pingInterval) {
        clearInterval(_pingInterval);
        _pingInterval = null;
    }
    _isOnline = false;
    _lastChecked = null;
}

export function initSupabase() {
    loadDatabaseConfig();

    if (!_supabaseUrl || !_supabaseAnonKey) {
        console.warn('[SupabaseClient] Warning: SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is not set. Cloud sync will be offline until credentials are provided in .env or settings.');
        return null;
    }

    try {
        console.log('[SupabaseClient] Initializing Supabase client for URL:', _supabaseUrl);
        _supabaseClient = createClient(_supabaseUrl, _supabaseAnonKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        });
        
        startPing();
        console.log('[SupabaseClient] Supabase client initialized.');
        return _supabaseClient;
    } catch (error) {
        console.error('[SupabaseClient] Error initializing client:', error);
        throw error;
    }
}

export function getSupabaseClient() {
    if (!_supabaseClient) {
        return initSupabase();
    }
    return _supabaseClient;
}

export function clearSupabase() {
    _supabaseClient = null;
    stopPing();
}

/**
 * Service role keys are removed from the desktop app for security.
 * Administrative operations are to be handled via Supabase Edge Functions.
 */
export function getAdminClient() {
    return null;
}

export async function setSession(accessToken, refreshToken) {
    const client = getSupabaseClient();
    if (!client) return null;
    try {
        const { data, error } = await client.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
        });
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[SupabaseClient] Error setting session:', error);
        throw error;
    }
}

export async function clearSession() {
    const client = getSupabaseClient();
    if (!client) return;
    try {
        await client.auth.signOut();
    } catch (error) {
        console.error('[SupabaseClient] Error clearing session:', error);
    }
}

export function isOnline() {
    return _isOnline;
}

export function getConnectionStatus() {
    return {
        online: _isOnline,
        lastChecked: _lastChecked,
        supabaseUrl: _supabaseUrl
    };
}
