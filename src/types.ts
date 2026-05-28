export type EntryKind = 'photo' | 'video';

export interface BoothEntry {
  id: string;
  kind: EntryKind;
  guestName?: string;
  title: string;
  text: string;
  category: string;
  createdAt: string;
  mediaName?: string;
  mediaUrl?: string;
  mediaType?: 'audio' | 'video' | 'image';
}
