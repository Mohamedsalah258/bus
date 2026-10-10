-- BL-19: news and announcements (the old homepage's «جديد الأخبار»).
CREATE TABLE news_posts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK (kind IN ('NEWS','ALERT')),
 title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
 body text NOT NULL CHECK (char_length(body) BETWEEN 3 AND 10000),
 route_id uuid REFERENCES routes(id),
 pinned boolean NOT NULL DEFAULT false,
 published_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz CHECK (expires_at IS NULL OR expires_at > published_at),
 active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX news_posts_visible ON news_posts(published_at DESC) WHERE active;
