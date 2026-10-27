import { createRequire } from 'module';
import { getConfig } from './config.js';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

// Polyfill WebSocket for Supabase Realtime in Node.js/Electron main process if needed
if (typeof globalThis.WebSocket === 'undefined') {
    globalThis.WebSocket = WebSocket;
}

let _supabaseUrl = '';
let _supabaseAnonKey = '';

let _supabaseClient = null;

let _isOnline = false;
let _lastChecked = null;
let _pingInterval = null;

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
    const config = getConfig();
    _supabaseUrl = config.supabaseUrl;
    _supabaseAnonKey = config.supabasePublishableKey;

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
