import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { Search, LogOut, MessageCircle, User as UserIcon } from 'lucide-react';
import { Chat } from '../components/Chat';

type Profile = Database['public']['Tables']['profiles']['Row'];
type ChatWithProfile = {
  chatId: string;
  otherUser: Profile;
  lastMessage?: string;
  updatedAt: string;
};

export const Home = () => {
  const { profile, signOut } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [chats, setChats] = useState<ChatWithProfile[]>([]);
  const [selectedChat, setSelectedChat] = useState<{ chatId: string; otherUser: Profile } | null>(null);
  const [loading, setLoading] = useState(false);

  const loadChats = useCallback(async () => {
    if (!profile) return;

    const { data: chatData } = await supabase
      .from('chats')
      .select('*')
      .or(`user1_id.eq.${profile.id},user2_id.eq.${profile.id}`)
      .order('updated_at', { ascending: false });

    if (chatData) {
      const chatsWithProfiles = await Promise.all(
        chatData.map(async (chat) => {
          const otherUserId = chat.user1_id === profile.id ? chat.user2_id : chat.user1_id;
          const { data: otherUserData } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', otherUserId)
            .maybeSingle();

          const { data: lastMessageData } = await supabase
            .from('messages')
            .select('content, media_type')
            .eq('chat_id', chat.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          let lastMessage = 'No messages yet';
          if (lastMessageData) {
            if (lastMessageData.content) {
              lastMessage = lastMessageData.content;
            } else if (lastMessageData.media_type) {
              lastMessage = lastMessageData.media_type === 'image' ? '📷 Photo' : '🎥 Video';
            }
          }

          return {
            chatId: chat.id,
            otherUser: otherUserData!,
            lastMessage,
            updatedAt: chat.updated_at,
          };
        })
      );

      setChats(chatsWithProfiles.filter(chat => chat.otherUser));
    }
  }, [profile]);

  useEffect(() => {
    if (profile) {
      loadChats();

      const channel = supabase
        .channel('chats_updates')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'chats',
          },
          () => {
            loadChats();
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
          },
          () => {
            loadChats();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [profile, loadChats]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('mobile_number', searchQuery.trim())
      .neq('id', profile?.id || '');

    setSearchResults(data || []);
    setLoading(false);
  }, [searchQuery, profile?.id]);

  const startChat = useCallback(async (otherUser: Profile) => {
    if (!profile) return;

    const user1Id = profile.id < otherUser.id ? profile.id : otherUser.id;
    const user2Id = profile.id < otherUser.id ? otherUser.id : profile.id;

    const { data: existingChat } = await supabase
      .from('chats')
      .select('id')
      .eq('user1_id', user1Id)
      .eq('user2_id', user2Id)
      .maybeSingle();

    if (existingChat) {
      setSelectedChat({ chatId: existingChat.id, otherUser });
    } else {
      const { data: newChat } = await supabase
        .from('chats')
        .insert({ user1_id: user1Id, user2_id: user2Id })
        .select()
        .single();

      if (newChat) {
        setSelectedChat({ chatId: newChat.id, otherUser });
        loadChats();
      }
    }

    setSearchQuery('');
    setSearchResults([]);
  }, [profile, loadChats]);

  const handleSignOut = useCallback(async () => {
    await signOut();
  }, [signOut]);

  const handleBackFromChat = useCallback(() => {
    setSelectedChat(null);
    loadChats();
  }, [loadChats]);

  if (selectedChat) {
    return <Chat chatId={selectedChat.chatId} otherUser={selectedChat.otherUser} onBack={handleBackFromChat} />;
  }

  return (
    <div className="h-screen bg-gray-100 flex flex-col">
      <header className="bg-teal-600 text-white p-4 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {profile?.profile_picture_url ? (
              <img
                src={profile.profile_picture_url}
                alt={profile.name}
                className="w-10 h-10 rounded-full object-cover border-2 border-white"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-teal-700 flex items-center justify-center">
                <UserIcon className="w-6 h-6" />
              </div>
            )}
            <div>
              <h2 className="font-semibold">{profile?.name}</h2>
              <p className="text-xs text-teal-100">{profile?.mobile_number}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 px-4 py-2 bg-teal-700 rounded-lg hover:bg-teal-800 transition"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto w-full flex-1 flex flex-col p-2 sm:p-4">
        <div className="bg-white rounded-lg shadow-md p-3 sm:p-4 mb-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search by mobile number..."
                className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={loading}
              className="px-6 py-3 bg-teal-500 text-white rounded-lg font-semibold hover:bg-teal-600 transition disabled:opacity-50"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="mt-4 space-y-2 max-h-64 overflow-y-auto">
              {searchResults.map((user) => (
                <div
                  key={user.id}
                  onClick={() => startChat(user)}
                  className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg cursor-pointer transition"
                >
                  {user.profile_picture_url ? (
                    <img
                      src={user.profile_picture_url}
                      alt={user.name}
                      className="w-12 h-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center">
                      <UserIcon className="w-6 h-6 text-gray-600" />
                    </div>
                  )}
                  <div>
                    <p className="font-semibold text-gray-800">{user.name}</p>
                    <p className="text-sm text-gray-500">{user.mobile_number}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-md flex-1 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-200 bg-teal-50">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-teal-600" />
              Chats ({chats.length})
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto">
            {chats.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 p-8">
                <MessageCircle className="w-20 h-20 mb-4" />
                <p className="text-lg font-medium">No chats yet</p>
                <p className="text-sm text-center mt-2">Search for users by mobile number to start chatting</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {chats.map((chat) => (
                  <div
                    key={chat.chatId}
                    onClick={() => setSelectedChat({ chatId: chat.chatId, otherUser: chat.otherUser })}
                    className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4 hover:bg-gray-50 cursor-pointer transition active:bg-gray-100"
                  >
                    <div className="relative flex-shrink-0">
                      {chat.otherUser.profile_picture_url ? (
                        <img
                          src={chat.otherUser.profile_picture_url}
                          alt={chat.otherUser.name}
                          className="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center">
                          <UserIcon className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
                        </div>
                      )}
                      {chat.otherUser.is_online && (
                        <div className="absolute bottom-0 right-0 w-3.5 h-3.5 sm:w-4 sm:h-4 bg-green-500 rounded-full border-2 border-white"></div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="font-semibold text-gray-900 truncate">{chat.otherUser.name}</p>
                        <p className="text-xs text-gray-500 flex-shrink-0 ml-2">
                          {new Date(chat.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <p className="text-sm text-gray-500 truncate">{chat.lastMessage}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
