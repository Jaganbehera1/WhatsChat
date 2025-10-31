export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      messages: {
        Row: {
          chat_id: string;
          content: string | null;
          created_at: string;
          id: string;
          media_type: "image" | "video" | null;
          media_url: string | null;
          sender_id: string;
        };
        Insert: {
          chat_id: string;
          content?: string | null;
          created_at?: string;
          id?: string;
          media_type?: "image" | "video" | null;
          media_url?: string | null;
          sender_id: string;
        };
        Update: {
          chat_id?: string;
          content?: string | null;
          created_at?: string;
          id?: string;
          media_type?: "image" | "video" | null;
          media_url?: string | null;
          sender_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey";
            columns: ["chat_id"];
            referencedRelation: "chats";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_sender_id_fkey";
            columns: ["sender_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      chats: {
        Row: {
          created_at: string;
          id: string;
          updated_at: string;
          user1_id: string;
          user2_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          updated_at?: string;
          user1_id: string;
          user2_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          updated_at?: string;
          user1_id?: string;
          user2_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chats_user1_id_fkey";
            columns: ["user1_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chats_user2_id_fkey";
            columns: ["user2_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          is_online: boolean;
          last_heartbeat: string | null;
          last_seen: string | null;
          mobile_number: string;
          name: string;
          profile_picture_url: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          is_online?: boolean;
          last_heartbeat?: string | null;
          last_seen?: string | null;
          mobile_number: string;
          name: string;
          profile_picture_url?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          is_online?: boolean;
          last_heartbeat?: string | null;
          last_seen?: string | null;
          mobile_number?: string;
          name?: string;
          profile_picture_url?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
