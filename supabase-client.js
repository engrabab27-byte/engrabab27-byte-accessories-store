(function () {
    const config = window.FEDAA_SUPABASE_CONFIG;
    const configured = config
        && /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url)
        && config.anonKey
        && config.anonKey !== "YOUR_SUPABASE_ANON_KEY";

    window.fedaaSupabase = configured && window.supabase
        ? window.supabase.createClient(config.url, config.anonKey)
        : null;
})();
