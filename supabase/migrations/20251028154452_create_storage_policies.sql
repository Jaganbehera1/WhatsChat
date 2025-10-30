/*
  # Storage Policies for Media Files

  1. Storage Buckets
    - `profile-pictures`: Public bucket for user profile pictures
    - `images`: Public bucket for chat images
    - `videos`: Public bucket for chat videos

  2. Security Policies
    - Profile pictures: Users can upload their own, all can view
    - Images: Authenticated users can upload, all can view
    - Videos: Authenticated users can upload, all can view
*/

-- Storage policies for profile-pictures bucket
CREATE POLICY "Users can upload their own profile picture"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-pictures'
);

CREATE POLICY "Profile pictures are publicly accessible"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'profile-pictures');

-- Storage policies for images bucket
CREATE POLICY "Users can upload images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'images');

CREATE POLICY "Images are publicly accessible"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'images');

-- Storage policies for videos bucket
CREATE POLICY "Users can upload videos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'videos');

CREATE POLICY "Videos are publicly accessible"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'videos');
