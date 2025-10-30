import { Database } from './database.types';

export type Tables = Database['public']['Tables'];

export type TableRow<T extends keyof Tables> = Tables[T]['Row'];
export type TableInsert<T extends keyof Tables> = Tables[T]['Insert'];
export type TableUpdate<T extends keyof Tables> = Tables[T]['Update'];

export type Profile = TableRow<'profiles'>;
export type Message = TableRow<'messages'>;
export type Chat = TableRow<'chats'>;

export type MessageInsert = TableInsert<'messages'>;
export type ProfileInsert = TableInsert<'profiles'>;
export type ChatInsert = TableInsert<'chats'>;

export type DatabaseMessage = Database['public']['Tables']['messages'];
export type DatabaseProfile = Database['public']['Tables']['profiles'];
export type DatabaseChat = Database['public']['Tables']['chats'];