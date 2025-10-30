/*
  # WhatsApp-like Chat Application Schema

  1. New Tables
    - `profiles`
      - `id` (uuid, primary key, references auth.users)
      - `name` (text, user's display name)
      - `email` (text, user's email)
      - `mobile_number` (text, unique, user's mobile number)
      - `profile_picture_url` (text, nullable, URL to profile image)
      - `is_online` (boolean, default false, online status)
      - `last_seen` (timestamptz, nullable, last activity timestamp)
      - `created_at` (timestamptz, default now())
      - `updated_at` (timestamptz, default now())

    - `chats`
      - `id` (uuid, primary key)
      - `user1_id` (uuid, references profiles)
      - `user2_id` (uuid, references profiles)
      - `created_at` (timestamptz, default now())
      - `updated_at` (timestamptz, default now())

    - `messages`
      - `id` (uuid, primary key)
      - `chat_id` (uuid, references chats)
      - `sender_id` (uuid, references profiles)
      - `content` (text, nullable, message text)
      - `media_url` (text, nullable, URL to image/video)
      - `media_type` (text, nullable, 'image' or 'video')
      - `created_at` (timestamptz, default now())

  2. Security
    - Enable RLS on all tables
    - Profiles: Users can read all profiles (for search), update only their own
    - Chats: Users can only access chats they are part of
    - Messages: Users can only access messages from their chats

  3. Important Notes
    - Mobile numbers must be unique to prevent duplicate accounts
    - Chat IDs are created when two users start a conversation
    - Messages support text, images, and videos
    - Online status and last seen are tracked for presence features
*/

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  mobile_number text UNIQUE NOT NULL,
  profile_picture_url text,
  is_online boolean DEFAULT false,
  last_seen timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create chats table
CREATE TABLE IF NOT EXISTS chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user2_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user1_id, user2_id)
);

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content text,
  media_url text,
  media_type text,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_profiles_mobile ON profiles(mobile_number);
CREATE INDEX IF NOT EXISTS idx_chats_user1 ON chats(user1_id);
CREATE INDEX IF NOT EXISTS idx_chats_user2 ON chats(user2_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Chats policies
CREATE POLICY "Users can view their own chats"
  ON chats FOR SELECT
  TO authenticated
  USING (auth.uid() = user1_id OR auth.uid() = user2_id);

CREATE POLICY "Users can create chats"
  ON chats FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user1_id OR auth.uid() = user2_id);

CREATE POLICY "Users can update their own chats"
  ON chats FOR UPDATE
  TO authenticated
  USING (auth.uid() = user1_id OR auth.uid() = user2_id)
  WITH CHECK (auth.uid() = user1_id OR auth.uid() = user2_id);

-- Messages policies
CREATE POLICY "Users can view messages from their chats"
  ON messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = messages.chat_id
      AND (chats.user1_id = auth.uid() OR chats.user2_id = auth.uid())
    )
  );

CREATE POLICY "Users can insert messages in their chats"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = messages.chat_id
      AND (chats.user1_id = auth.uid() OR chats.user2_id = auth.uid())
    )
  );

-- Function to update chat updated_at timestamp
CREATE OR REPLACE FUNCTION update_chat_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chats SET updated_at = now() WHERE id = NEW.chat_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update chat timestamp on new message
CREATE TRIGGER update_chat_on_message
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_chat_timestamp();

-- Function to update profile updated_at timestamp
CREATE OR REPLACE FUNCTION update_profile_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update profile timestamp
CREATE TRIGGER update_profile_on_change
BEFORE UPDATE ON profiles
FOR EACH ROW
EXECUTE FUNCTION update_profile_timestamp();
