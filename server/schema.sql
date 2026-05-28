CREATE TABLE memories (
  id VARCHAR(80) PRIMARY KEY,
  kind ENUM('photo', 'video') NOT NULL,
  guest_name VARCHAR(255) NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'Memories',
  created_at DATETIME(3) NOT NULL,
  media_name VARCHAR(255) NULL,
  media_url LONGTEXT NULL,
  media_type ENUM('image', 'video', 'audio') NULL,
  created_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_memories_created_at (created_at),
  INDEX idx_memories_kind (kind),
  INDEX idx_memories_category (category)
);
