import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import type { AppNotification } from '@/types';

/** Polls the notification inbox and exposes an unread count for the header. */
export function useNotifications(pollMs = 30_000) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  async function load() {
    if (!user) return;
    try {
      const res = await api.get<{ notifications: AppNotification[]; unreadCount: number }>('/notifications', { take: 30 });
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount);
    } catch {
      /* notifications are non-critical */
    }
  }

  useEffect(() => {
    void load();
    if (!user) return;
    const id = window.setInterval(() => void load(), pollMs);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, pollMs]);

  async function markRead(id: string) {
    await api.post(`/notifications/${id}/read`);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
  }

  async function markAllRead() {
    await api.post('/notifications/read-all');
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
  }

  return { notifications, unreadCount, reload: load, markRead, markAllRead };
}
