import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { type Database } from '../lib/database.types';

import { 
  ArrowLeft, 
  Send, 
  Image as ImageIcon, 
  User as UserIcon,
  Loader2,
  CheckCheck,
  Download,
  X,
  Share,
  Search,
  Check,
  Trash2,
  MoreVertical
} from 'lucide-react';

type Tables = Database['public']['Tables'];
type Message = Tables['messages']['Row'];
type MessageInsert = Tables['messages']['Insert'];
type Chat = Tables['chats']['Row'];
type Profile = Tables['profiles']['Row'];

interface ChatProps {
  chatId: string;
  otherUser: Profile;
  onBack: () => void;
}

interface MediaPreview {
  url: string;
  type: 'image' | 'video';
  messageId: string;
  senderName: string;
  timestamp: string;
}

interface ShareData {
  mediaUrl: string;
  mediaType: 'image' | 'video';
  messageId: string;
  messageContent?: string;
}

interface RecentChat {
  id: string;
  other_user: Profile;
  last_message?: string;
  last_message_time?: string;
  unread_count: number;
}

interface MessageMenu {
  isOpen: boolean;
  messageId: string;
  position: { x: number; y: number };
  isOwnMessage: boolean;
}

// Add interface for unread messages tracking
interface UnreadMessages {
  [chatId: string]: number;
}

export const Chat = ({ chatId, otherUser: initialOtherUser, onBack }: ChatProps) => {
  const { profile } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [otherUser, setOtherUser] = useState<Profile>(initialOtherUser);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null);
  const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
  const [shareModal, setShareModal] = useState<{ isOpen: boolean; data: ShareData | null }>({ isOpen: false, data: null });
  const [selectedChats, setSelectedChats] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [messageMenu, setMessageMenu] = useState<MessageMenu | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; messageId: string; isOwnMessage: boolean } | null>(null);
  const [unreadMessages, setUnreadMessages] = useState<UnreadMessages>({});
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const messageMenuRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  
  // Online status tracking with minimized state detection
  const onlineStatusRef = useRef({
    isOnline: false,
    lastHeartbeat: 0,
    tabCount: 0,
    heartbeatInterval: null as NodeJS.Timeout | null,
    lastVisibilityChange: Date.now(),
    isMinimized: false,
    minimizeTimeout: null as NodeJS.Timeout | null
  });

  // Profile Picture Modal State
  const [profilePictureModal, setProfilePictureModal] = useState<{ 
    isOpen: boolean; 
    imageUrl: string; 
    userName: string;
    isOnline: boolean;
    lastSeen: string | null;
  }>({ 
    isOpen: false, 
    imageUrl: '', 
    userName: '',
    isOnline: false,
    lastSeen: null
  });

  // Utility functions
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatLastSeen = (lastSeen: string | null, isOnline: boolean = false) => {
    // If user is online, don't show last seen
    if (isOnline) return 'Online';

    if (!lastSeen) return 'Offline';

    const lastSeenDate = new Date(lastSeen);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - lastSeenDate.getTime()) / (1000 * 60));

    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes} min ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)} hours ago`;

    return lastSeenDate.toLocaleDateString();
  };

  const formatMessageTime = (timestamp: string) => {
    if (!timestamp) return '';

    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

    if (diffInHours < 1) {
      const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
      return diffInMinutes < 1 ? 'Just now' : `${diffInMinutes}m ago`;
    }
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInHours < 168) return `${Math.floor(diffInHours / 24)}d ago`;

    return date.toLocaleDateString();
  };

  // ========== ENHANCED ONLINE STATUS SYSTEM ==========

  // Update online status in database
  const updateOnlineStatus = useCallback(async (isOnline: boolean) => {
    if (!profile?.id) return;
    
    try {
      const updateData = {
        is_online: isOnline,
        last_seen: isOnline ? null : new Date().toISOString(),
        last_heartbeat: isOnline ? new Date().toISOString() : null
      };

      const { error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', profile.id);

      if (error) {
        console.error('Error updating online status:', error);
      } else {
        console.log(`✅ Status updated: ${isOnline ? 'Online' : 'Offline'}`);
        onlineStatusRef.current.isOnline = isOnline;
      }
    } catch (err) {
      console.error('Error updating online status:', err);
    }
  }, [profile?.id]);

  // Enhanced heartbeat system with reconnection and status verification
  const startHeartbeat = useCallback(() => {
    if (onlineStatusRef.current.heartbeatInterval) {
      clearInterval(onlineStatusRef.current.heartbeatInterval);
    }

    // Initial heartbeat
    const sendHeartbeat = async (isInitial = false) => {
      if (!profile?.id || (!isInitial && !onlineStatusRef.current.isOnline)) return;

      try {
        // First verify we're actually online
        const { data: currentStatus } = await supabase
          .from('profiles')
          .select('is_online, last_heartbeat')
          .eq('id', profile.id)
          .single();

        // If we think we're online but database says offline, sync up
        if (onlineStatusRef.current.isOnline && currentStatus && !currentStatus.is_online) {
          console.log('🔄 Detected offline state in DB, re-establishing online status');
          await updateOnlineStatus(true);
        }

        // Send heartbeat
        await supabase
          .from('profiles')
          .update({ 
            last_heartbeat: new Date().toISOString(),
            is_online: true
          })
          .eq('id', profile.id);
        
        onlineStatusRef.current.lastHeartbeat = Date.now();
        console.log('💓 Heartbeat sent', isInitial ? '(initial)' : '');

      } catch (err) {
        console.error('Error in heartbeat:', err);
        // If this was the initial heartbeat, try to go offline
        if (isInitial) {
          try {
            await updateOnlineStatus(false);
          } catch (offlineErr) {
            console.error('Error going offline:', offlineErr);
          }
        }
      }
    };

    // Send initial heartbeat
    sendHeartbeat(true);

    // Set up periodic heartbeat
    onlineStatusRef.current.heartbeatInterval = setInterval(async () => {
      await sendHeartbeat();
      
      // Check if we've been minimized too long
      if (onlineStatusRef.current.isMinimized && 
          Date.now() - onlineStatusRef.current.lastVisibilityChange >= 30000) {
        console.log('⏰ Been minimized for over 30 seconds, going offline');
        await updateOnlineStatus(false);
      }
    }, 20000); // Every 20 seconds

  }, [profile?.id, updateOnlineStatus]);

  // Check if user should be marked offline (no heartbeat for 30+ seconds)
  const checkHeartbeatStatus = useCallback(async () => {
    if (!profile?.id) return;

    try {
      const { data } = await supabase
        .from('profiles')
        .select('last_heartbeat, is_online')
        .eq('id', profile.id)
        .single();

      if (data && data.last_heartbeat) {
        const lastHeartbeat = new Date(data.last_heartbeat).getTime();
        const now = Date.now();
        const timeSinceLastHeartbeat = now - lastHeartbeat;

        // If no heartbeat for 35 seconds, mark as offline
        if (timeSinceLastHeartbeat > 35000 && data.is_online) {
          console.log('🔄 Auto-marking offline due to missing heartbeat');
          await updateOnlineStatus(false);
        }
      }
    } catch (err) {
      console.error('Error checking heartbeat status:', err);
    }
  }, [profile?.id, updateOnlineStatus]);

  // Multi-tab coordination using localStorage
  const setupMultiTabCoordination = useCallback(() => {
    const tabId = Math.random().toString(36).substr(2, 9);
    
    // Update tab count when this tab starts
    const updateTabCount = (increment: boolean) => {
      try {
        const tabs = JSON.parse(localStorage.getItem('active_tabs') || '{}');
        
        if (increment) {
          tabs[tabId] = Date.now();
        } else {
          delete tabs[tabId];
        }
        
        localStorage.setItem('active_tabs', JSON.stringify(tabs));
        onlineStatusRef.current.tabCount = Object.keys(tabs).length;
        
        console.log(`📑 Active tabs: ${onlineStatusRef.current.tabCount}`);
        
        // If this is the first tab, mark online
        if (increment && onlineStatusRef.current.tabCount === 1) {
          updateOnlineStatus(true);
          startHeartbeat();
        }
        // If this was the last tab, mark offline
        else if (!increment && onlineStatusRef.current.tabCount === 0) {
          updateOnlineStatus(false);
          if (onlineStatusRef.current.heartbeatInterval) {
            clearInterval(onlineStatusRef.current.heartbeatInterval);
          }
        }
      } catch (err) {
        console.error('Error updating tab count:', err);
      }
    };

    // Listen for storage events from other tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'active_tabs' && e.newValue) {
        try {
          const tabs = JSON.parse(e.newValue);
          onlineStatusRef.current.tabCount = Object.keys(tabs).length;
          console.log(`📑 Tab count updated: ${onlineStatusRef.current.tabCount}`);
        } catch (err) {
          console.error('Error parsing tab count:', err);
        }
      }
    };

    // Initialize
    updateTabCount(true);
    window.addEventListener('storage', handleStorageChange);

    // Cleanup
    return () => {
      updateTabCount(false);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [updateOnlineStatus, startHeartbeat]);

  // Enhanced user status polling with heartbeat check
  const setupUserStatusPolling = useCallback(() => {
    const pollUserStatus = async () => {
      if (!mountedRef.current || !initialOtherUser.id) return;
      
      try {
        const { data: userData, error } = await supabase
          .from('profiles')
          .select<'*', Profile>('*')
          .eq('id', initialOtherUser.id)
          .single();

        if (!error && userData && mountedRef.current) {
          setOtherUser(prev => {
            // Only update if something actually changed
            if (prev.is_online === userData.is_online && prev.last_seen === userData.last_seen) {
              return prev;
            }
            
            console.log('🟢 User status update:', {
              name: userData.name,
              is_online: userData.is_online,
              last_seen: userData.last_seen
            });
            
            return {
              ...prev,
              is_online: userData.is_online,
              last_seen: userData.last_seen
            };
          });
        }
      } catch (error) {
        console.error('Error in user status polling:', error);
      }
    };

    // Poll immediately and then every 25 seconds
    pollUserStatus();
    const interval = setInterval(pollUserStatus, 25000);
    return () => clearInterval(interval);
  }, [initialOtherUser.id]);

  // Check own heartbeat status periodically
  const setupHeartbeatMonitor = useCallback(() => {
    const interval = setInterval(() => {
      checkHeartbeatStatus();
    }, 30000); // Check every 30 seconds
    
    return () => clearInterval(interval);
  }, [checkHeartbeatStatus]);

  // Handle profile picture click
  const handleProfilePictureClick = () => {
    setProfilePictureModal({
      isOpen: true,
      imageUrl: otherUser.profile_picture_url || '',
      userName: otherUser.name,
      isOnline: otherUser.is_online,
      lastSeen: otherUser.last_seen
    });
  };

  // Download media function
  const downloadMedia = async (mediaUrl: string, fileName: string) => {
    try {
      const response = await fetch(mediaUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading media:', error);
      alert('Failed to download. Please try again.');
    }
  };

  // Load unread messages from localStorage
  const loadUnreadMessages = useCallback((): UnreadMessages => {
    if (typeof window === 'undefined') return {};
    try {
      const stored = localStorage.getItem('unread_messages');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }, []);

  // Save unread messages to localStorage
  const saveUnreadMessages = useCallback((unread: UnreadMessages) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('unread_messages', JSON.stringify(unread));
    } catch (error) {
      console.error('Error saving unread messages:', error);
    }
  }, []);

  // Mark messages as read for current chat
  const markMessagesAsRead = useCallback(async () => {
    if (!profile?.id || !chatId) return;

    try {
      // Update local state
      setUnreadMessages(prev => {
        const updated = { ...prev };
        if (updated[chatId]) {
          delete updated[chatId];
          saveUnreadMessages(updated);
        }
        return updated;
      });

      // Also update recent chats to reflect the change
      setRecentChats(prev => prev.map(chat => 
        chat.id === chatId ? { ...chat, unread_count: 0 } : chat
      ));

    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  }, [chatId, profile?.id, saveUnreadMessages]);

  // Increment unread count for a chat
  const incrementUnreadCount = useCallback(
    (targetChatId: string, message?: Message) => {
      // 🧩 Safety checks
      if (!targetChatId || !profile?.id) return;
      if (message && message.sender_id === profile.id) return; // Don't increment for own messages

      setUnreadMessages(prev => {
        const updated = {
          ...prev,
          [targetChatId]: (prev[targetChatId] || 0) + 1,
        };

        saveUnreadMessages(updated);

        // ✅ Safely update recent chats
        setRecentChats(prev =>
          prev.map(chat =>
            chat.id === targetChatId
              ? { ...chat, unread_count: updated[targetChatId] ?? 0 }
              : chat
          )
        );

        return updated;
      });
    },
    [profile?.id, saveUnreadMessages]
  );

  // Fetch recent chats with last messages and unread counts - FIXED VERSION
  const fetchRecentChats = useCallback(async () => {
    if (!profile) {
      console.log('❌ No profile found');
      return;
    }

    try {
      setIsLoadingChats(true);
      console.log('🔍 Fetching recent chats for user:', profile.id);

      const { data: chats, error } = await supabase
        .from('chats')
        .select<'*', Chat>('*')
        .or(`user1_id.eq.${profile.id},user2_id.eq.${profile.id}`)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('❌ Error fetching chats:', error);
        return;
      }

      console.log('📱 Raw chats data:', chats);

      if (chats && chats.length > 0) {
        const recentChatsWithDetails: RecentChat[] = [];

        for (const chat of chats) {
          const otherUserId = chat.user1_id === profile.id ? chat.user2_id : chat.user1_id;
          console.log(`👤 Processing chat ${chat.id} with other user:`, otherUserId);
          
          const { data: userData, error: userError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', otherUserId)
            .single();

          if (userError) {
            console.error(`❌ Error fetching user profile for ${otherUserId}:`, userError);
            continue;
          }

          console.log(`✅ User profile found:`, userData);

          const { data: lastMessage } = await supabase
            .from('messages')
            .select<'*', Message>('*')
            .eq('chat_id', chat.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          console.log(`💬 Chat ${chat.id} last message:`, lastMessage);

          if (userData) {
            let lastMessageText = 'No messages yet';
            if (lastMessage) {
              if (lastMessage.content) {
                lastMessageText = lastMessage.content;
              } else if (lastMessage.media_url) {
                lastMessageText = lastMessage.media_type === 'image' ? '📷 Photo' : '🎥 Video';
              }
            }

            // Get unread count from our state
            const unreadCount = unreadMessages[chat.id] || 0;

            recentChatsWithDetails.push({
              id: chat.id,
              other_user: userData,
              last_message: lastMessageText,
              last_message_time: lastMessage?.created_at,
              unread_count: unreadCount
            });
          } else {
            console.log(`❌ No user data for chat ${chat.id}`);
          }
        }

        console.log('✅ FINAL Processed recent chats:', recentChatsWithDetails);
        setRecentChats(recentChatsWithDetails);
      } else {
        console.log('ℹ️ No chats found for user');
        setRecentChats([]);
      }
    } catch (error) {
      console.error('❌ Error fetching recent chats:', error);
    } finally {
      setIsLoadingChats(false);
    }
  }, [profile, unreadMessages]);

  // Fetch initial data - FIXED VERSION
  const fetchInitialData = useCallback(async () => {
    try {
      setIsLoading(true);
      
      const { data: messagesData, error: messagesError } = await supabase
        .from('messages')
        .select<'*', Message>('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

      if (messagesError) throw messagesError;
      
      const { data: userData, error: userError } = await supabase
        .from('profiles')
        .select<'*', Profile>('*')
        .eq('id', initialOtherUser.id)
        .single();

      if (userError) console.error('Error fetching user data:', userError);

      if (mountedRef.current) {
        setMessages(messagesData || []);
        setOtherUser(userData || initialOtherUser);
        
        // Mark messages as read when opening chat
        markMessagesAsRead();
      }
    } catch (error) {
      console.error('Error fetching initial data:', error);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [chatId, initialOtherUser, markMessagesAsRead]);

  // Real-time subscription - FIXED VERSION with proper unread tracking
  const setupRealtimeSubscription = useCallback(async () => {
    if (!mountedRef.current || !profile?.id) return;

    try {
      setConnectionStatus('connecting');
      console.log('🔄 Setting up real-time for chat:', chatId);

      // Clean up previous channel
      if (messagesChannelRef.current) {
        await messagesChannelRef.current.unsubscribe();
        messagesChannelRef.current = null;
      }

      // Create simple channel without complex config
      const channel = supabase.channel(`chat_${chatId}`);

      // Presence sync - update other user's online state when presence changes
      channel.on('presence', { event: 'sync' }, () => {
        try {
          const state = channel.presenceState() as Record<string, unknown>;
          const otherOnline = Object.values(state).some((ps) => {
            if (!ps || !Array.isArray(ps)) return false;
            const first = (ps as Array<Record<string, unknown>>)[0];
            return typeof first?.user_id === 'string' && first.user_id === initialOtherUser.id;
          });
          setOtherUser(prev => ({ ...prev, is_online: otherOnline }));
        } catch (err) {
          console.debug('presence sync error', err);
        }
      });

      // INSERT events - for new messages
      channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          console.log('📨 REAL-TIME: New message received', payload.new);
          const newMessage = payload.new as Message;

          setMessages(prev => {
            // Prevent duplicates from optimistic updates or subscription race conditions
            if (prev.some(msg => msg.id === newMessage.id)) {
              console.log('⚠️ Message already exists, skipping');
              return prev;
            }

            // Increment unread count if this is not the current active chat
            // Check if user is currently viewing this chat
            const isViewingThisChat = window.location.pathname.includes(`/chat/${chatId}`);
            if (!isViewingThisChat && newMessage.sender_id !== profile?.id) {
              console.log('🔴 Incrementing unread count for chat:', chatId);
              incrementUnreadCount(chatId, newMessage);
            }

            return [...prev, newMessage];
          });
        }
      );

      // DELETE events - for deleted messages
      channel.on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          console.log('🗑️ REAL-TIME: Message deleted', payload.old);
          const deletedMessageId = payload.old.id;
          
          setMessages(prev => prev.filter(msg => msg.id !== deletedMessageId));
        }
      );

      // Subscribe
      channel.subscribe(async (status) => {
        console.log('🔌 Real-time status:', status);
        
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
          console.log('✅ Real-time connected for chat:', chatId);
          try {
            // Track presence for this user in the chat channel
            await channel.track({ user_id: profile.id, typing: false, online_at: new Date().toISOString() });
          } catch (err) {
            console.error('Error tracking presence on channel:', err);
          }
        } else {
          setConnectionStatus('disconnected');
          console.log('❌ Real-time disconnected:', status);
        }
      });

      messagesChannelRef.current = channel;

    } catch (error) {
      console.error('❌ Error setting up real-time:', error);
      setConnectionStatus('disconnected');
    }
  }, [chatId, profile?.id, incrementUnreadCount, initialOtherUser.id]);

  // ========== ENHANCED EFFECTS FOR ONLINE STATUS ==========

  useEffect(() => {
    mountedRef.current = true;
    let reconnectTimeout: NodeJS.Timeout;
    let initializationAttempts = 0;
    const maxAttempts = 3;
    
    const initializeChat = async () => {
      try {
        await fetchInitialData();
        await setupRealtimeSubscription();
        initializationAttempts = 0;
      } catch (error) {
        console.error('Error initializing chat:', error);
        initializationAttempts++;
        
        if (initializationAttempts < maxAttempts && mountedRef.current) {
          const delay = Math.min(1000 * Math.pow(2, initializationAttempts), 10000);
          reconnectTimeout = setTimeout(initializeChat, delay);
        } else {
          setConnectionStatus('disconnected');
        }
      }
    };

    initializeChat();
    const statusInterval = setupUserStatusPolling();
    const heartbeatMonitor = setupHeartbeatMonitor();
    const multiTabCleanup = setupMultiTabCoordination();

    return () => {
      // Clear mounted flag first to prevent any new operations
      mountedRef.current = false;

      // Clear websocket subscription
      if (messagesChannelRef.current) {
        messagesChannelRef.current.unsubscribe();
      }

      // Clear all intervals and timeouts
      clearInterval(statusInterval);
      if (heartbeatMonitor) clearInterval(heartbeatMonitor);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (onlineStatusRef.current.heartbeatInterval) {
        clearInterval(onlineStatusRef.current.heartbeatInterval);
      }
      if (onlineStatusRef.current.minimizeTimeout) {
        clearTimeout(onlineStatusRef.current.minimizeTimeout);
      }

      // Mark user as offline if this was the last tab
      const cleanupAndGoOffline = async () => {
        try {
          // Call the cleanup for multi-tab coordination
          multiTabCleanup();

          // If this was the last tab, mark user as offline
          const tabs = JSON.parse(localStorage.getItem('active_tabs') || '{}');
          const activeTabs = Object.keys(tabs).length;
          
          if (activeTabs === 0 && profile?.id) {
            await supabase
              .from('profiles')
              .update({
                is_online: false,
                last_seen: new Date().toISOString(),
                last_heartbeat: null
              })
              .eq('id', profile.id);
            
            console.log('👋 User went offline (last tab closed)');
          }
        } catch (err) {
          console.error('Error during cleanup:', err);
        }
      };

      // Execute cleanup
      cleanupAndGoOffline();
    };
  }, [fetchInitialData, setupRealtimeSubscription, setupUserStatusPolling, setupHeartbeatMonitor, setupMultiTabCoordination]);

  // Enhanced visibility and unload handlers
  useEffect(() => {
    if (!profile?.id) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Clear any pending minimize timeout
        if (onlineStatusRef.current.minimizeTimeout) {
          clearTimeout(onlineStatusRef.current.minimizeTimeout);
          onlineStatusRef.current.minimizeTimeout = null;
        }
        
        // Tab became visible - mark online if we have active tabs
        if (onlineStatusRef.current.tabCount > 0) {
          onlineStatusRef.current.isMinimized = false;
          onlineStatusRef.current.lastVisibilityChange = Date.now();
          updateOnlineStatus(true);
          startHeartbeat();
        }
      } else {
        // Tab became hidden - start minimize timeout
        onlineStatusRef.current.lastVisibilityChange = Date.now();
        
        // Clear any existing timeout
        if (onlineStatusRef.current.minimizeTimeout) {
          clearTimeout(onlineStatusRef.current.minimizeTimeout);
        }
        
        // Set new timeout for 30 seconds
        onlineStatusRef.current.minimizeTimeout = setTimeout(() => {
          onlineStatusRef.current.isMinimized = true;
          if (Date.now() - onlineStatusRef.current.lastVisibilityChange >= 30000) {
            updateOnlineStatus(false);
          }
        }, 30000);
        
        console.log('📱 Tab hidden, will mark as offline in 30 seconds if still minimized');
      }
    };

    const handleBeforeUnload = () => {
      // Clean up this tab's presence
      try {
        const tabs = JSON.parse(localStorage.getItem('active_tabs') || '{}');
        Object.keys(tabs).forEach(tabKey => {
          if (tabs[tabKey] && Date.now() - tabs[tabKey] > 60000) {
            delete tabs[tabKey]; // Clean up old tabs
          }
        });
        localStorage.setItem('active_tabs', JSON.stringify(tabs));
      } catch (err) {
        console.error('Error cleaning up tabs:', err);
      }
    };

    const handleWindowFocus = () => {
      // Window gained focus - ensure we're marked online
      if (onlineStatusRef.current.tabCount > 0 && !onlineStatusRef.current.isOnline) {
        updateOnlineStatus(true);
        startHeartbeat();
      }
    };

    const handleWindowBlur = () => {
      // Window lost focus - continue heartbeat but don't change status
      console.log('🔍 Window blurred, maintaining status');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [profile?.id, updateOnlineStatus, startHeartbeat]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (messages.length > 0) {
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [messages]);

  // Reconnection logic
  useEffect(() => {
    if (connectionStatus === 'disconnected') {
      const timer = setTimeout(() => {
        if (mountedRef.current) {
          setupRealtimeSubscription();
        }
      }, 3000);
      
      return () => clearTimeout(timer);
    }
  }, [connectionStatus, setupRealtimeSubscription]);

  // Close modals when pressing Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMediaPreview(null);
        setShareModal({ isOpen: false, data: null });
        setMessageMenu(null);
        setDeleteModal(null);
        setProfilePictureModal(prev => ({ ...prev, isOpen: false }));
      }
    };

    if (mediaPreview || shareModal.isOpen || messageMenu || deleteModal || profilePictureModal.isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [mediaPreview, shareModal.isOpen, messageMenu, deleteModal, profilePictureModal.isOpen]);

  // Close message menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (messageMenuRef.current && !messageMenuRef.current.contains(event.target as Node)) {
        setMessageMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cross-tab synchronization for deletes (fallback when real-time fails)
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key && event.key.startsWith('delete_') && event.newValue) {
        try {
          const deletion = JSON.parse(event.newValue);
          if (deletion.chatId === chatId) {
            console.log('🔄 Cross-tab sync: Removing deleted message', deletion.messageId);
            setMessages(prev => prev.filter(msg => msg.id !== deletion.messageId));
          }
        } catch (error) {
          console.error('Error processing cross-tab sync:', error);
        }
      }
    };

    const handleCustomEvent = (event: Event) => {
      const customEvent = event as CustomEvent;
      const deletion = customEvent.detail;
      if (deletion.chatId === chatId) {
        console.log('🔄 Custom event sync: Removing deleted message', deletion.messageId);
        setMessages(prev => prev.filter(msg => msg.id !== deletion.messageId));
      }
    };

    // Listen for storage events (other tabs)
    window.addEventListener('storage', handleStorageChange);
    
    // Listen for custom events (same origin)
    window.addEventListener('messageDeleted', handleCustomEvent as EventListener);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('messageDeleted', handleCustomEvent as EventListener);
    };
  }, [chatId]);

  // Focus search input when share modal opens
  useEffect(() => {
    if (shareModal.isOpen && searchInputRef.current) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    }
  }, [shareModal.isOpen]);

  // Fetch recent chats when share modal opens
  useEffect(() => {
    if (shareModal.isOpen) {
      console.log('🔄 Share modal opened, fetching recent chats...');
      fetchRecentChats();
      setSearchQuery('');
      setSelectedChats([]);
    }
  }, [shareModal.isOpen, fetchRecentChats]);

  // Initialize unread messages on component mount
  useEffect(() => {
    setUnreadMessages(loadUnreadMessages());
  }, [loadUnreadMessages]);

  // Check if buckets exist with better error handling
  const checkBucketExists = async (bucketName: string): Promise<boolean> => {
    try {
      const result = await supabase.storage.from(bucketName).list('', { limit: 1 });
      if (result.error) {
        if (result.error.message.includes('Bucket not found')) {
          console.error(`Bucket "${bucketName}" not found`);
          return false;
        }
        throw new Error(`Storage error: ${result.error.message}`);
      }
      return true;
    } catch (err: unknown) {
      if (err instanceof Error) {
        console.error('Storage error:', err.message);
      } else {
        console.error('Unknown storage error');
      }
      return false;
    }
  };

  // File upload handler - FIXED VERSION
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile || uploading) return;

    const maxSize = 50 * 1024 * 1024; // Increased to 50MB for videos
    if (file.size > maxSize) {
      alert('File size too large. Please select a file smaller than 50MB.');
      return;
    }

    setUploading(true);

    try {
      const fileExt = file.name.split('.').pop()?.toLowerCase();
      const fileName = `${profile.id}-${Date.now()}.${fileExt}`;
      const isVideo = file.type.startsWith('video/');
      const bucket = isVideo ? 'videos' : 'images';

      const bucketExists = await checkBucketExists(bucket);
      if (!bucketExists) {
        throw new Error(`The ${bucket} storage bucket does not exist.`);
      }

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(fileName);

      const tempId = `temp-${Date.now()}`;
      const optimisticMessage: Message = {
        id: tempId,
        chat_id: chatId,
        sender_id: profile.id,
        content: null,
        created_at: new Date().toISOString(),
        media_url: publicUrl,
        media_type: isVideo ? 'video' : 'image'
      };

      // Add optimistic message
      setMessages(prev => [...prev, optimisticMessage]);

      const { data, error: messageError } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          sender_id: profile.id,
          media_url: publicUrl,
          media_type: isVideo ? 'video' : 'image',
          content: null
        } satisfies MessageInsert)
        .select()
        .single();

      if (messageError) {
        setMessages(prev => prev.filter(msg => msg.id !== tempId));
        throw messageError;
      }

      // Replace temporary message with real one
      if (data) {
        setMessages(prev => prev.map(msg => 
          msg.id === tempId ? data : msg
        ));
      }

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error('Error uploading file:', errorMessage);
      alert('Failed to upload file. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !profile || uploading) return;

    const messageContent = newMessage.trim();
    setNewMessage('');

    // Generate a temporary ID that we can track
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: Message = {
      id: tempId,
      chat_id: chatId,
      sender_id: profile.id,
      content: messageContent,
      created_at: new Date().toISOString(),
      media_url: null,
      media_type: null
    };

    // Add optimistic message to UI immediately
    setMessages(prev => [...prev, optimisticMessage]);

    try {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          sender_id: profile.id,
          content: messageContent,
          media_url: null,
          media_type: null
        } satisfies MessageInsert)
        .select() // Get the actual message back with real ID
        .single();

      if (error) throw error;

      // Replace the temporary message with the real one from database
      if (data) {
        setMessages(prev => prev.map(msg => 
          msg.id === tempId ? data : msg
        ));
        console.log('✅ Message sent and replaced temporary message');
      }

    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error('Unknown error occurred');
      // Remove the optimistic message if sending failed
      setMessages(prev => prev.filter(msg => msg.id !== tempId));
      setNewMessage(messageContent);
      console.error('Error sending message:', errorObj.message);
    }
  };

  // Handle media preview
  const handleMediaClick = (message: Message) => {
    if (!message.media_url || !message.media_type) return;

    const senderName = message.sender_id === profile?.id ? 'You' : otherUser.name;
    
    setMediaPreview({
      url: message.media_url,
      type: message.media_type as 'image' | 'video',
      messageId: message.id,
      senderName,
      timestamp: message.created_at
    });
  };

  // Handle share functionality - FIXED for videos and text messages
  const handleShare = (mediaUrl: string | null, mediaType: 'image' | 'video' | null, messageId: string, messageContent?: string) => {
    setShareModal({
      isOpen: true,
      data: { 
        mediaUrl: mediaUrl || '', 
        mediaType: mediaType || 'image', 
        messageId,
        messageContent 
      }
    });
    setMediaPreview(null);
  };

  // Handle chat selection for sharing
  const toggleChatSelection = (targetChatId: string) => {
    setSelectedChats(prev => 
      prev.includes(targetChatId) 
        ? prev.filter(id => id !== targetChatId)
        : [...prev, targetChatId]
    );
  };

  const forwardMedia = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (!shareModal.data || selectedChats.length === 0 || !profile) {
      console.warn("⚠️ Missing required data for forwarding:", {
        shareModal: shareModal.data,
        selectedChats,
        profile,
      });
      return;
    }

    console.log("🚀 Starting forwardMedia with data:", {
      shareModal: shareModal.data,
      selectedChats,
      sender: profile.id,
    });

    try {
      let successCount = 0;
      let failCount = 0;

      for (const targetChatId of selectedChats) {
        const messagePayload = {
          chat_id: targetChatId,
          sender_id: profile.id,
          media_url: shareModal.data.mediaUrl || null,
          media_type: shareModal.data.mediaType || null,
          content: shareModal.data.messageContent || null,
        };

        console.log(`📝 Inserting message into chat ${targetChatId}:`, messagePayload);

        const { data, error } = await supabase.from("messages").insert(messagePayload).select();

        if (error) {
          console.error(`❌ Supabase insert error for chat ${targetChatId}:`, error);
          failCount++;
        } else {
          console.log(`✅ Inserted message successfully:`, data);
          successCount++;
          incrementUnreadCount(targetChatId);
        }
      }

      if (successCount > 0) {
        alert(`✅ Forwarded to ${successCount} chat(s) successfully!`);
      }
      if (failCount > 0) {
        alert(`⚠️ Failed to forward to ${failCount} chat(s). Check console for details.`);
      }

    } catch (error) {
      console.error("🚨 Fatal error in forwardMedia():", error);
      alert("Failed to forward message. Please try again.");
    } finally {
      setTimeout(() => {
        setShareModal({ isOpen: false, data: null });
        setSelectedChats([]);
      }, 100);
    }
  };

  // Handle message menu
  const handleMessageMenu = (messageId: string, isOwnMessage: boolean, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuWidth = 150; // Approximate menu width
    const menuHeight = 100; // Approximate menu height
    
    // Calculate position based on message side
    let x = event.clientX;
    let y = event.clientY;
    
    // Adjust for right-side messages (own messages)
    if (isOwnMessage) {
      x = Math.min(x, viewportWidth - menuWidth - 10); // Keep 10px from right edge
    } else {
      // For left-side messages, ensure menu doesn't go off-screen on left
      x = Math.max(x, menuWidth + 10); // Keep 10px from left edge
    }
    
    // Ensure menu doesn't go off-screen vertically
    y = Math.min(y, viewportHeight - menuHeight - 10);
    
    setMessageMenu({
      isOpen: true,
      messageId,
      position: { x, y },
      isOwnMessage
    });
  };

  // Handle delete message - WITH REAL-TIME FALLBACK
  const handleDeleteMessage = async (deleteForEveryone: boolean = false) => {
    if (!deleteModal || !profile) return;

    const messageToDelete = messages.find(msg => msg.id === deleteModal.messageId);
    if (!messageToDelete) return;

    try {
      console.log(`🗑️ Deleting message: ${deleteModal.messageId}, forEveryone: ${deleteForEveryone}`);

      if (deleteForEveryone) {
        // Delete media from storage if exists
        if (messageToDelete.media_url) {
          try {
            const bucket = messageToDelete.media_type === 'video' ? 'videos' : 'images';
            const fileName = messageToDelete.media_url.split('/').pop();
            if (fileName) {
              await supabase.storage.from(bucket).remove([fileName]);
            }
          } catch (storageError) {
            console.error('Error deleting media:', storageError);
          }
        }

        // Delete from database
        const { error } = await supabase
          .from('messages')
          .delete()
          .eq('id', deleteModal.messageId);

        if (error) throw error;

        console.log('✅ Message deleted from database');

        // MANUAL FALLBACK: Since real-time might not work, we'll implement a manual system
        // Store deletion info in localStorage so other tabs can sync
        const deletionEvent = {
          type: 'MESSAGE_DELETED',
          chatId,
          messageId: deleteModal.messageId,
          timestamp: Date.now()
        };
        localStorage.setItem(`delete_${deleteModal.messageId}`, JSON.stringify(deletionEvent));
        
        // Also trigger a custom event for other tabs
        window.dispatchEvent(new CustomEvent('messageDeleted', {
          detail: deletionEvent
        }));

      } else {
        // Delete for me only - just remove locally
        setMessages(prev => prev.filter(msg => msg.id !== deleteModal.messageId));
      }

      // Remove from local state
      setMessages(prev => prev.filter(msg => msg.id !== deleteModal.messageId));
      setDeleteModal(null);
      setMessageMenu(null);

    } catch (error) {
      console.error('❌ Delete failed:', error);
      alert('Failed to delete message. Please try again.');
    }
  };

  const getMessageStatus = (message: Message) => {
    if (message.id.startsWith('temp-')) {
      return <Loader2 className="w-3 h-3 animate-spin" />;
    }
    
    return message.sender_id === profile?.id ? <CheckCheck className="w-3 h-3" /> : null;
  };

  // Update the filteredChats calculation - FIXED VERSION
  const filteredChats = recentChats.filter(chat => {
    if (!searchQuery.trim()) {
      return true;
    }
    
    const searchLower = searchQuery.toLowerCase().trim();
    const nameMatch = chat.other_user.name?.toLowerCase().includes(searchLower);
    const mobileMatch = chat.other_user.mobile_number?.includes(searchQuery);
    
    const shouldInclude = nameMatch || mobileMatch;
    console.log(`🔍 Chat ${chat.other_user.name}: nameMatch=${nameMatch}, mobileMatch=${mobileMatch}, include=${shouldInclude}`);
    
    return shouldInclude;
  });

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  // Profile Picture Modal Component
  const ProfilePictureModal = () => {
    if (!profilePictureModal.isOpen) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-95 z-50 flex items-center justify-center p-4">
        <div className="relative max-w-4xl max-h-full w-full h-full flex flex-col items-center justify-center">
          {/* Close Button */}
          <button
            onClick={() => setProfilePictureModal(prev => ({ ...prev, isOpen: false }))}
            className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors bg-black bg-opacity-50 rounded-full p-3 z-50"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Profile Picture */}
          <div className="flex-1 flex items-center justify-center p-8">
            {profilePictureModal.imageUrl ? (
              <img
                src={profilePictureModal.imageUrl}
                alt={profilePictureModal.userName}
                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              />
            ) : (
              <div className="w-64 h-64 bg-gradient-to-br from-teal-500 to-teal-700 rounded-full flex items-center justify-center shadow-2xl">
                <UserIcon className="w-32 h-32 text-white" />
              </div>
            )}
          </div>

          {/* User Info */}
          <div className="w-full max-w-md bg-black bg-opacity-50 rounded-lg p-6 mt-4 text-white">
            <h2 className="text-2xl font-bold text-center mb-2">
              {profilePictureModal.userName}
            </h2>
            <div className="flex items-center justify-center gap-2 text-sm">
              <div className={`w-3 h-3 rounded-full ${
                profilePictureModal.isOnline ? 'bg-green-400' : 'bg-gray-400'
              }`} />
              <span>
                {formatLastSeen(profilePictureModal.lastSeen, profilePictureModal.isOnline)}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Media Preview Modal
  const MediaPreviewModal = () => {
    if (!mediaPreview) return null;

    const fileName = mediaPreview.url.split('/').pop() || 'media';
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4">
        <div className="relative max-w-4xl max-h-full w-full h-full flex items-center justify-center">
          {/* Header with controls */}
          <div className="absolute top-4 left-4 right-4 flex justify-between items-center z-10">
            <button
              onClick={() => setMediaPreview(null)}
              className="text-white hover:text-gray-300 transition-colors bg-black bg-opacity-50 rounded-full p-2"
            >
              <X className="w-6 h-6" />
            </button>
            
            <div className="flex gap-2">
              <button
                onClick={() => downloadMedia(mediaPreview.url, fileName)}
                className="text-white hover:text-gray-300 transition-colors bg-black bg-opacity-50 rounded-full p-2"
                title="Download"
              >
                <Download className="w-6 h-6" />
              </button>

              <button
                onClick={() => handleShare(mediaPreview.url, mediaPreview.type, mediaPreview.messageId)}
                className="text-white hover:text-gray-300 transition-colors bg-black bg-opacity-50 rounded-full p-2"
                title="Share"
              >
                <Share className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Media content */}
          <div className="flex-1 flex items-center justify-center">
            {mediaPreview.type === 'image' ? (
              <img
                src={mediaPreview.url}
                alt="Preview"
                className="max-w-full max-h-full object-contain rounded-lg"
              />
            ) : (
              <video
                src={mediaPreview.url}
                controls
                autoPlay
                className="max-w-full max-h-full object-contain rounded-lg"
              >
                Your browser does not support the video tag.
              </video>
            )}
          </div>

          {/* Footer with info */}
          <div className="absolute bottom-4 left-4 right-4 text-white text-sm">
            <div className="bg-black bg-opacity-50 rounded-lg p-3">
              <p>From: {mediaPreview.senderName}</p>
              <p>Time: {formatTime(mediaPreview.timestamp)}</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Message Menu Component
  const MessageMenuModal = () => {
    if (!messageMenu) return null;

    return (
      <div 
        ref={messageMenuRef}
        className="fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-32"
        style={{
          left: messageMenu.position.x,
          top: messageMenu.position.y,
        }}
      >
        <button
          onClick={() => {
            const message = messages.find(msg => msg.id === messageMenu.messageId);
            if (message) {
              handleShare(message.media_url, message.media_type, message.id, message.content || undefined);
            }
            setMessageMenu(null);
          }}
          className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
        >
          <Share className="w-4 h-4" />
          Forward
        </button>
        {/* Always show Delete in the menu. For incoming messages this will act as "Delete for me" (isOwnMessage=false).
            For own messages it will surface the same Delete action and the DeleteModal will show "Delete for Everyone" option. */}
        <button
          onClick={() => {
            setDeleteModal({
              isOpen: true,
              messageId: messageMenu.messageId,
              isOwnMessage: messageMenu.isOwnMessage
            });
            setMessageMenu(null);
          }}
          className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${messageMenu.isOwnMessage ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'}`}
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </button>
      </div>
    );
  };

  // Delete Confirmation Modal
  const DeleteModal = () => {
    if (!deleteModal) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-md p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Delete Message
          </h3>
          <p className="text-gray-600 mb-6">
            Are you sure you want to delete this message? This action cannot be undone.
          </p>
          
          <div className="space-y-3">
            {deleteModal.isOwnMessage && (
              <button
                onClick={() => handleDeleteMessage(true)}
                className="w-full bg-red-500 text-white py-3 rounded-lg font-semibold hover:bg-red-600 transition-colors"
              >
                Delete for Everyone
              </button>
            )}
            <button
              onClick={() => handleDeleteMessage(false)}
              className="w-full bg-gray-500 text-white py-3 rounded-lg font-semibold hover:bg-gray-600 transition-colors"
            >
              {deleteModal.isOwnMessage ? 'Delete for Me' : 'Delete'}
            </button>
            <button
              onClick={() => setDeleteModal(null)}
              className="w-full border border-gray-300 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Share Modal - UPDATED with better click outside handling
  const ShareModal = () => {
    if (!shareModal.isOpen || !shareModal.data) return null;

    const allChatsAreCurrent = recentChats.length > 0 && filteredChats.length === 0 && 
      recentChats.every(chat => chat.id === chatId);

    // Handle click outside to close modal
    const handleBackdropClick = (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        setShareModal({ isOpen: false, data: null });
        setSelectedChats([]);
      }
    };

    return (
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
        onClick={handleBackdropClick}
      >
        <div 
          className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Forward to</h3>
              <p className="text-sm text-gray-500">
                {shareModal.data.messageContent ? 'Forward text message' : 'Forward media'}
              </p>
            </div>
            <button
              onClick={() => {
                setShareModal({ isOpen: false, data: null });
                setSelectedChats([]);
              }}
              className="text-gray-500 hover:text-gray-700"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Preview */}
          {shareModal.data.messageContent && (
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <p className="text-sm text-gray-600 mb-2">Preview:</p>
              <div className="bg-white p-3 rounded-lg border">
                <p className="text-gray-800">{shareModal.data.messageContent}</p>
              </div>
            </div>
          )}

          {/* Search */}
          <div className="p-4 border-b border-gray-200">
            <div className="relative">
              <Search className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search by name or number..."
                value={searchQuery}
                onChange={handleSearchChange}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
              />
            </div>
          </div>

          {/* Recent Chats List */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-3 bg-gray-50 border-b border-gray-200">
              <p className="text-sm font-medium text-gray-600">
                {searchQuery ? 'Search Results' : 'Recent Chats'} ({filteredChats.length})
              </p>
            </div>
            
            {isLoadingChats ? (
              <div className="flex justify-center items-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-teal-500 mr-2" />
                <p className="text-gray-500">Loading chats...</p>
              </div>
            ) : allChatsAreCurrent ? (
              <div className="text-center py-8 text-gray-500">
                <p className="text-lg">No other chats available</p>
                <p className="text-sm mt-1">
                  You only have one active conversation. Start new chats to share media with others.
                </p>
              </div>
            ) : filteredChats.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p className="text-lg">No chats found</p>
                <p className="text-sm mt-1">
                  {searchQuery ? 'Try a different search term' : 'Start a conversation to see chats here'}
                </p>
              </div>
            ) : (
              filteredChats.map(chat => {
                const unreadCount = unreadMessages[chat.id] || 0;
                
                return (
                  <div
                    key={chat.id}
                    className="flex items-center gap-3 p-3 hover:bg-gray-50 border-b border-gray-100 transition-colors cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleChatSelection(chat.id);
                    }}
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <div className="relative">
                        {chat.other_user.profile_picture_url ? (
                          <img
                            src={chat.other_user.profile_picture_url}
                            alt={chat.other_user.name || 'User'}
                            className="w-12 h-12 rounded-full object-cover border border-gray-200"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                            }}
                          />
                        ) : null}
                        {!chat.other_user.profile_picture_url && (
                          <div className="w-12 h-12 rounded-full bg-teal-500 flex items-center justify-center">
                            <UserIcon className="w-6 h-6 text-white" />
                          </div>
                        )}
                        {unreadCount > 0 && (
                          <div className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start">
                          <p className="font-semibold text-gray-900 truncate">
                            {chat.other_user.name || 'Unknown User'}
                          </p>
                          {chat.last_message_time && (
                            <span className="text-xs text-gray-500 whitespace-nowrap ml-2">
                              {formatMessageTime(chat.last_message_time)}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 truncate">
                          {chat.other_user.mobile_number || 'No number'}
                        </p>
                        <p className="text-sm text-gray-400 truncate">
                          {chat.last_message || 'No messages'}
                        </p>
                      </div>
                    </div>
                    
                    <div 
                      className={`w-6 h-6 rounded-full border-2 ${
                        selectedChats.includes(chat.id)
                          ? 'bg-teal-500 border-teal-500'
                          : 'border-gray-300'
                      } flex items-center justify-center transition-colors cursor-pointer`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleChatSelection(chat.id);
                      }}
                    >
                      {selectedChats.includes(chat.id) && (
                        <Check className="w-4 h-4 text-white" />
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-gray-200">
            <button
              onClick={(e) => {
                e.stopPropagation();
                forwardMedia(e);
              }}
              disabled={selectedChats.length === 0}
              className="w-full bg-teal-500 text-white py-3 rounded-lg font-semibold hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              type="button"
            >
              {selectedChats.length === 0 
                ? 'Select chats to forward' 
                : `Forward to ${selectedChats.length} chat${selectedChats.length !== 1 ? 's' : ''}`
              }
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-teal-600" />
          <p className="mt-2 text-gray-600">Loading chat...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-100 flex flex-col">
      {/* Modals */}
      <MediaPreviewModal />
      <ShareModal />
      <MessageMenuModal />
      <DeleteModal />
      <ProfilePictureModal />

      {/* Header */}
      <header className="bg-teal-600 text-white p-4 shadow-lg sticky top-0 z-40">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 hover:bg-teal-700 rounded-lg transition-colors duration-200"
            aria-label="Go back"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="relative flex-shrink-0">
              <button
                onClick={handleProfilePictureClick}
                className="relative focus:outline-none focus:ring-2 focus:ring-white focus:ring-opacity-50 rounded-full"
              >
                {otherUser.profile_picture_url ? (
                  <img
                    src={otherUser.profile_picture_url}
                    alt={otherUser.name}
                    className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-teal-700 flex items-center justify-center shadow-sm cursor-pointer hover:opacity-90 transition-opacity">
                    <UserIcon className="w-6 h-6" />
                  </div>
                )}
                <div 
                  className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${
                    otherUser.is_online ? 'bg-green-400' : 'bg-gray-400'
                  }`}
                  title={otherUser.is_online ? 'Online' : `Last seen ${formatLastSeen(otherUser.last_seen, otherUser.is_online)}`}
                />
              </button>
            </div>
            
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-lg truncate">{otherUser.name}</h2>
              <div className="flex items-center gap-2">
                <p className="text-sm text-teal-100 truncate">
                  {formatLastSeen(otherUser.last_seen, otherUser.is_online)}
                </p>
                <div 
                  // className={`w-2 h-2 rounded-full ${
                  //   connectionStatus === 'connected' ? 'bg-green-400' :
                  //   connectionStatus === 'connecting' ? 'bg-yellow-400' : 'bg-red-400'
                  // }`}
                  title={`Real-time: ${connectionStatus}`}
                />
                <span className="text-xs text-teal-200">
                  {connectionStatus === 'connected' ? '' : 
                  connectionStatus === 'connecting' ? 'Connecting...' : 'Offline'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
        {connectionStatus === 'disconnected' && (
          <div className="text-center py-2">
            <p className="text-xs text-red-600 bg-red-50 py-1 px-3 rounded-full inline-block">
              Connection lost. Reconnecting...
            </p>
          </div>
        )}

        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-500">
              <p className="text-lg">No messages yet</p>
              <p className="text-sm">Start a conversation by sending a message!</p>
            </div>
          </div>
        ) : (
          messages.map((message) => {
            const isMine = message.sender_id === profile?.id;
            
            return (
              <div
                key={message.id}
                className={`flex ${isMine ? 'justify-end' : 'justify-start'} group relative`}
              >
                <div
                  className={`max-w-[85%] sm:max-w-md rounded-2xl p-3 ${
                    isMine
                      ? 'bg-teal-500 text-white rounded-br-none shadow-lg'
                      : 'bg-white text-gray-800 rounded-bl-none shadow-md'
                  } ${message.id.startsWith('temp-') ? 'opacity-70' : ''}`}
                >
                  {/* Message menu button */}
                  <button
                    onClick={(e) => handleMessageMenu(message.id, isMine, e)}
                    className="absolute -top-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-gray-200 hover:bg-gray-300 rounded-full p-1"
                    style={{
                      [isMine ? 'right' : 'left']: '8px'
                    }}
                  >
                    <MoreVertical className="w-3 h-3" />
                  </button>

                  {message.media_url && (
                    <div className="mb-2 rounded-lg overflow-hidden">
                      {message.media_type === 'image' ? (
                        <img
                          src={message.media_url}
                          alt="Shared content"
                          className="max-w-full h-auto rounded-lg cursor-pointer transition-transform duration-200 hover:scale-105"
                          loading="lazy"
                          onClick={() => handleMediaClick(message)}
                        />
                      ) : (
                        <video
                          src={message.media_url}
                          controls
                          className="max-w-full h-auto rounded-lg cursor-pointer"
                          onClick={() => handleMediaClick(message)}
                        >
                          Your browser does not support the video tag.
                        </video>
                      )}
                    </div>
                  )}
                  
                  {message.content && (
                    <p className="break-words leading-relaxed">{message.content}</p>
                  )}
                  
                  <div className={`flex items-center gap-1 mt-1 ${
                    isMine ? 'justify-end' : 'justify-start'
                  }`}>
                    <span className={`text-xs ${isMine ? 'text-teal-100' : 'text-gray-500'}`}>
                      {formatTime(message.created_at)}
                    </span>
                    {isMine && (
                      <span className="flex-shrink-0">
                        {getMessageStatus(message)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <div className="bg-white border-t border-gray-200 p-4 sticky bottom-0 z-40 shadow-lg">
        <form onSubmit={handleSendMessage} className="max-w-6xl mx-auto flex gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="p-3 text-teal-600 hover:bg-teal-50 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Upload image or video"
          >
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageIcon className="w-5 h-5" />}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={handleFileUpload}
            className="hidden"
          />

          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder={uploading ? 'Uploading...' : 'Type a message...'}
            disabled={uploading}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all duration-200 disabled:opacity-50 bg-gray-50"
          />

          <button
            type="submit"
            disabled={!newMessage.trim() || uploading}
            className="p-3 bg-teal-500 text-white rounded-xl hover:bg-teal-600 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
};
