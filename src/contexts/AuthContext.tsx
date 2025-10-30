import { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, name: string, mobileNumber: string, profilePicture?: File) => Promise<void>;
  signIn: (emailOrMobile: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateOnlineStatus: (isOnline: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user.id);
        updateOnlineStatus(true);

        intervalId = setInterval(() => {
          updateOnlineStatus(true);
        }, 30000);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user.id);
        updateOnlineStatus(true);

        if (intervalId) clearInterval(intervalId);
        intervalId = setInterval(() => {
          updateOnlineStatus(true);
        }, 30000);
      } else {
        setProfile(null);
        setLoading(false);
        if (intervalId) clearInterval(intervalId);
      }
    });

    const handleBeforeUnload = async () => {
      if (user) {
        await updateOnlineStatus(false);
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden && user) {
        updateOnlineStatus(false);
      } else if (!document.hidden && user) {
        updateOnlineStatus(true);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (user) {
        updateOnlineStatus(false);
      }
      if (intervalId) clearInterval(intervalId);
      subscription.unsubscribe();
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const loadProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (
    email: string,
    password: string,
    name: string,
    mobileNumber: string,
    profilePicture?: File
  ) => {
    try {
      // Clean inputs
      email = email.trim();
      password = password.trim();
      name = name.trim();
      mobileNumber = mobileNumber.trim();

      console.log('Attempting signup:', { email, password, name, mobileNumber });

      if (!email || !password || !name || !mobileNumber) {
        throw new Error('All fields are required');
      }

      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters long');
      }

      // Check mobile number uniqueness
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('mobile_number')
        .eq('mobile_number', mobileNumber)
        .maybeSingle();

      if (existingUser) {
        throw new Error('Mobile number already registered');
      }

      // Create account
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      console.log('Signup result:', authData, authError);
      if (authError) throw authError;
      if (!authData.user) throw new Error('Failed to create user');

      // Upload profile picture
      let profilePictureUrl: string | null = null;
      if (profilePicture) {
        const fileExt = profilePicture.name.split('.').pop();
        const fileName = `${authData.user.id}-${Date.now()}.${fileExt}`;
        const { error: uploadError, data: uploadData } = await supabase.storage
          .from('profile-pictures')
          .upload(fileName, profilePicture);

        if (uploadError) throw uploadError; 

        const { data: { publicUrl } } = supabase.storage
          .from('profile-pictures')
          .getPublicUrl(uploadData.path);

        profilePictureUrl = publicUrl;
      }

      // Save profile data
      const { error: profileError } = await supabase.from('profiles').insert({
        id: authData.user.id,
        name,
        email,
        mobile_number: mobileNumber,
        profile_picture_url: profilePictureUrl,
      });

      if (profileError) throw profileError;

      console.log('Profile inserted successfully!');
      await supabase.auth.signOut();
    } catch (error: any) {
      console.error('Signup failed:', error.message || error);
      throw error;
    }
  };


  const signIn = async (emailOrMobile: string, password: string) => {
    let email = emailOrMobile;

    if (!emailOrMobile.includes('@')) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('email')
        .eq('mobile_number', emailOrMobile)
        .maybeSingle();

      if (!profileData) {
        throw new Error('Mobile number not found');
      }
      email = profileData.email;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
  };

  const signOut = async () => {
    if (user) {
      await updateOnlineStatus(false);
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const updateOnlineStatus = async (isOnline: boolean) => {
    if (!user) return;

    await supabase
      .from('profiles')
      .update({
        is_online: isOnline,
        last_seen: new Date().toISOString(),
      })
      .eq('id', user.id);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        signUp,
        signIn,
        signOut,
        updateOnlineStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
