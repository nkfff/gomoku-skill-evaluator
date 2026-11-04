// Hybrid edition: local-first gameplay plus the existing authenticated online services.
// All keys below are public client configuration; no service-role secret is shipped in the app.
window.GOMOKU_OFFLINE_EDITION = false;
window.GOMOKU_HYBRID_EDITION = true;
window.GOMOKU_API_URL = "https://gomoku-v2-api.1395598907.workers.dev";
window.GOMOKU_SUPABASE_URL = "https://khnlxucuvagtpdbooexa.supabase.co";
window.GOMOKU_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g41tZyis1LySHQyR-dceqw_A84XgPPW";
window.GOMOKU_PVP_API_URL = "https://gomoku-v3-api.1395598907.workers.dev";
// Email verification/password recovery returns to the existing hosted auth callback.
// Users can then open the installed app and sign in; no web page is needed for gameplay.
window.GOMOKU_AUTH_REDIRECT_URL = "https://nkfff.github.io/gomoku-skill-evaluator/v4.0/";
document.documentElement.dataset.edition = "hybrid";
