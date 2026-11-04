-- Workers AI review quota: an atomic daily cap protects the free tier.
CREATE TABLE IF NOT EXISTS review_ai_daily_usage (
 scope TEXT NOT NULL,
 day TEXT NOT NULL,
 used INTEGER NOT NULL DEFAULT 0 CHECK(used >= 0),
 PRIMARY KEY(scope,day)
);
